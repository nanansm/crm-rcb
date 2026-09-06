import { guard, json, type Env } from '../../_lib/auth'

const VERSI = 'v21.0'
const POLA_NAMA = /^[a-z0-9_]+$/

/** Pesan galat Meta kadang menyertakan angka panjang (ID, kode akun). Disamarkan
 * sebelum tampil ke layar staf atau tersimpan di log. */
function samarkanAngka(pesan: string): string {
  return pesan.replace(/\d{8,}/g, '(angka)')
}

interface KomponenMeta {
  type?: string
  format?: string
  text?: string
}

interface TemplateMeta {
  id?: string
  name?: string
  status?: string
  category?: string
  language?: string
  components?: KomponenMeta[]
}

interface RespMetaTemplates {
  data?: TemplateMeta[]
}

interface RespMetaGagal {
  error?: { message?: string; code?: number }
}

interface RingkasanTemplate {
  id: string
  nama: string
  status: string
  kategori: string
  bahasa: string
  isi: string
  // Template ber-header gambar DITOLAK Meta kalau dikirim tanpa parameter
  // gambar. Layar broadcast perlu tahu ini supaya bisa mewajibkan gambarnya,
  // bukan membiarkan staf menembak lalu gagal seluruhnya.
  punya_gambar: boolean
}

function ringkas(t: TemplateMeta): RingkasanTemplate {
  const komponen = t.components ?? []
  const body = komponen.find((k) => (k.type ?? '').toUpperCase() === 'BODY')
  const header = komponen.find((k) => (k.type ?? '').toUpperCase() === 'HEADER')
  return {
    id: t.id ?? '',
    nama: t.name ?? '',
    status: t.status ?? '',
    kategori: t.category ?? '',
    bahasa: t.language ?? '',
    isi: body?.text ?? '',
    punya_gambar: (header?.format ?? '').toUpperCase() === 'IMAGE',
  }
}

/**
 * Daftar template dari Graph API dipakai staf untuk memilih template broadcast.
 * Cuma template berstatus APPROVED yang aman dipakai kirim -- PAUSED/DISABLED/
 * REJECTED/PENDING masih ikut terdaftar oleh Meta tapi ditolak saat dipakai
 * kirim pesan, jadi keduanya wajib dipisah field supaya UI tidak menawarkan
 * template yang bakal gagal.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  // Lokal/dev sengaja tidak punya kredensial Meta -- ini keadaan normal, bukan galat.
  if (!env.META_TOKEN || !env.META_WABA_ID) {
    return json({ template: [], menunggu: [], meta_belum_dikonfigurasi: true })
  }

  let res: Response
  try {
    res = await fetch(
      `https://graph.facebook.com/${VERSI}/${env.META_WABA_ID}/message_templates?fields=id,name,status,category,language,components&limit=200`,
      {
        headers: { Authorization: `Bearer ${env.META_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    return json({ error: 'gagal_menghubungi_meta' }, { status: 502 })
  }

  const teks = await res.text()
  let terurai: unknown = null
  try {
    terurai = teks ? JSON.parse(teks) : null
  } catch {
    // biarkan null -- ditangani lewat status HTTP di bawah
  }

  if (!res.ok) {
    const err = (terurai as RespMetaGagal | null)?.error
    return json(
      { error: err?.message ? samarkanAngka(err.message) : 'meta_menolak_permintaan' },
      { status: 502 },
    )
  }

  const daftar = (terurai as RespMetaTemplates | null)?.data ?? []
  const template = daftar.filter((t) => t.status === 'APPROVED').map(ringkas)
  const menunggu = daftar.filter((t) => t.status !== 'APPROVED').map(ringkas)

  return json({ template, menunggu })
}

const BATAS_GAMBAR_BYTE = 5 * 1024 * 1024
const JENIS_GAMBAR = new Set(['image/jpeg', 'image/png'])

type HasilUnggah = { ok: true; handle: string } | { ok: false; alasan: string }

/**
 * Meta TIDAK menerima URL gambar saat template dibuat. Yang diterima cuma
 * `header_handle` hasil Resumable Upload API, dan itu dua langkah: minta sesi
 * unggah, lalu kirim byte gambarnya. Staf cuma menempelkan alamat gambar; sisanya
 * dikerjakan di sini supaya mereka tidak perlu menyentuh WhatsApp Manager.
 */
async function unggahGambarHeader(env: Env, gambarUrl: string): Promise<HasilUnggah> {
  if (!env.META_APP_ID) return { ok: false, alasan: 'meta_app_id_belum_dipasang' }

  let gambar: Response
  try {
    gambar = await fetch(gambarUrl, { signal: AbortSignal.timeout(15_000) })
  } catch {
    return { ok: false, alasan: 'gambar_tidak_bisa_diambil' }
  }
  if (!gambar.ok) return { ok: false, alasan: 'gambar_tidak_bisa_diambil' }

  const jenis = (gambar.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!JENIS_GAMBAR.has(jenis)) return { ok: false, alasan: 'gambar_wajib_jpg_atau_png' }

  const isi = await gambar.arrayBuffer()
  // Batas Meta untuk gambar header. Ditolak di sini supaya staf tahu alasannya,
  // bukan menerima galat mentah Graph API yang tidak terbaca.
  if (isi.byteLength === 0) return { ok: false, alasan: 'gambar_kosong' }
  if (isi.byteLength > BATAS_GAMBAR_BYTE) return { ok: false, alasan: 'gambar_lebih_dari_5mb' }

  let sesi: Response
  try {
    sesi = await fetch(
      `https://graph.facebook.com/${VERSI}/${env.META_APP_ID}/uploads?file_length=${isi.byteLength}&file_type=${encodeURIComponent(jenis)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.META_TOKEN ?? ''}` },
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch {
    return { ok: false, alasan: 'gagal_menghubungi_meta' }
  }

  const teksSesi = await sesi.text()
  let idSesi = ''
  try {
    idSesi = (JSON.parse(teksSesi) as { id?: string }).id ?? ''
  } catch {
    idSesi = ''
  }
  if (!sesi.ok || !idSesi) return { ok: false, alasan: 'gagal_membuka_sesi_unggah' }

  let unggah: Response
  try {
    unggah = await fetch(`https://graph.facebook.com/${VERSI}/${idSesi}`, {
      method: 'POST',
      headers: {
        // Langkah kedua Resumable Upload memakai skema OAuth, bukan Bearer.
        Authorization: `OAuth ${env.META_TOKEN ?? ''}`,
        file_offset: '0',
        'Content-Type': jenis,
      },
      body: isi,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, alasan: 'gagal_mengunggah_gambar' }
  }

  const teksUnggah = await unggah.text()
  let handle = ''
  try {
    handle = (JSON.parse(teksUnggah) as { h?: string }).h ?? ''
  } catch {
    handle = ''
  }
  if (!unggah.ok || !handle) return { ok: false, alasan: 'gagal_mengunggah_gambar' }

  return { ok: true, handle }
}

interface KomponenHeaderGambar {
  type: 'HEADER'
  format: 'IMAGE'
  example: { header_handle: string[] }
}

interface TombolInput {
  jenis?: string
  teks?: string
  url?: string
}

interface BodyTemplateBaru {
  gambar_url?: string
  nama?: string
  bahasa?: string
  kategori?: string
  isi?: string
  tombol?: TombolInput[]
}

interface KomponenBody {
  type: 'BODY'
  text: string
}

interface TombolMeta {
  type: 'QUICK_REPLY' | 'URL'
  text: string
  url?: string
}

interface KomponenButtons {
  type: 'BUTTONS'
  buttons: TombolMeta[]
}

/** Ajukan template baru ke Graph API. Staf mengisi form di layar web. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyTemplateBaru
  try {
    body = await request.json<BodyTemplateBaru>()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const nama = String(body.nama ?? '').trim()
  const bahasa = String(body.bahasa ?? '').trim()
  const kategori = String(body.kategori ?? '').trim()
  const isi = String(body.isi ?? '').trim()

  if (!nama || !bahasa || !kategori || !isi) {
    return json({ error: 'nama_bahasa_kategori_isi_wajib' }, { status: 400 })
  }

  // Meta menolak nama template selain huruf kecil/angka/garis bawah -- divalidasi
  // di sini dulu supaya staf dapat pesan yang jelas, bukan galat mentah Meta.
  if (!POLA_NAMA.test(nama)) {
    return json({ error: 'nama_hanya_huruf_kecil_angka_garis_bawah' }, { status: 400 })
  }

  const tombolInput = Array.isArray(body.tombol) ? body.tombol : []
  const tombol: TombolMeta[] = []
  for (const t of tombolInput) {
    const jenis = String(t.jenis ?? '').trim()
    const teksTombol = String(t.teks ?? '').trim()
    if (!jenis || !teksTombol) {
      return json({ error: 'tombol_jenis_dan_teks_wajib' }, { status: 400 })
    }

    if (jenis === 'URL') {
      const url = String(t.url ?? '').trim()
      // Meta menolak tombol URL yang mengarah ke wa.me (error_subcode 2388081) --
      // dicegat di sini dulu, staf diarahkan pakai tombol balasan cepat.
      if (!url || /wa\.me/i.test(url)) {
        return json(
          { error: 'tombol_url_wa_me_ditolak_meta_pakai_balasan_cepat' },
          { status: 400 },
        )
      }
      tombol.push({ type: 'URL', text: teksTombol, url })
    } else {
      tombol.push({ type: 'QUICK_REPLY', text: teksTombol })
    }
  }

  // Bentuk alamat gambar diperiksa SEBELUM kredensial: isian ngawur adalah
  // salah staf dan harus dibilang begitu, apa pun keadaan kredensial server.
  const gambarUrl = String(body.gambar_url ?? '').trim()
  let alamatGambar: URL | null = null
  if (gambarUrl !== '') {
    try {
      alamatGambar = new URL(gambarUrl)
    } catch {
      return json({ error: 'gambar_url_tidak_valid' }, { status: 400 })
    }
    if (alamatGambar.protocol !== 'https:') {
      return json({ error: 'gambar_url_wajib_https' }, { status: 400 })
    }
  }

  // Lokal/dev sengaja tidak punya kredensial Meta -- ini keadaan normal, bukan galat.
  if (!env.META_TOKEN || !env.META_WABA_ID) {
    return json(
      { error: 'meta_belum_dikonfigurasi', meta_belum_dikonfigurasi: true },
      { status: 503 },
    )
  }

  const komponen: (KomponenBody | KomponenButtons | KomponenHeaderGambar)[] = []

  // Header gambar diunggah DULU. Kalau unggahannya gagal, template tidak boleh
  // terlanjur diajukan tanpa gambar -- staf akan mengira promonya bergambar.
  if (alamatGambar) {
    const hasilUnggah = await unggahGambarHeader(env, alamatGambar.toString())
    if (!hasilUnggah.ok) {
      return json({ error: hasilUnggah.alasan }, { status: 502 })
    }
    komponen.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [hasilUnggah.handle] },
    })
  }

  komponen.push({ type: 'BODY', text: isi })
  if (tombol.length > 0) komponen.push({ type: 'BUTTONS', buttons: tombol })

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${VERSI}/${env.META_WABA_ID}/message_templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: nama, language: bahasa, category: kategori, components: komponen }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return json({ error: 'gagal_menghubungi_meta' }, { status: 502 })
  }

  const teks = await res.text()
  let terurai: unknown = null
  try {
    terurai = teks ? JSON.parse(teks) : null
  } catch {
    // biarkan null -- ditangani lewat status HTTP di bawah
  }

  if (!res.ok) {
    const err = (terurai as RespMetaGagal | null)?.error
    return json(
      { error: err?.message ? samarkanAngka(err.message) : 'meta_menolak_template' },
      { status: 502 },
    )
  }

  const sukses = terurai as { id?: string; status?: string; category?: string } | null
  return json({ ok: true, id: sukses?.id, status: sukses?.status, kategori: sukses?.category }, { status: 201 })
}
