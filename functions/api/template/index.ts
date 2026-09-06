import { guard, json, type Env } from '../../_lib/auth'
import {
  VERSI_GRAPH as VERSI,
  ambilDaftarTemplateMeta,
  punyaVariabel,
  samarkanAngka,
  type KomponenMeta,
  type RespMetaGagal,
  type TemplateMeta,
} from '../../_lib/template-meta'

const PANJANG_JUDUL_MIN = 3
const PANJANG_JUDUL_MAKS = 60
const PANJANG_RINGKAS_MAKS = 120
const PANJANG_ISI_MIN = 30
const PANJANG_ISI_MAKS = 1024
const PANJANG_FOOTER_MAKS = 60
const PANJANG_TOMBOL_MAKS = 25

interface RingkasanTemplate {
  id: string
  nama: string
  /** Judul yang ditulis staf. Kosong untuk template yang dibuat di WhatsApp Manager. */
  judul: string
  ringkas: string
  berlaku_sampai: string | null
  status: string
  kategori: string
  bahasa: string
  isi: string
  footer: string
  tombol: { tipe: 'situs' | 'balasan'; teks: string; url: string } | null
  // Template ber-header gambar DITOLAK Meta kalau dikirim tanpa parameter
  // gambar. Layar broadcast perlu tahu ini supaya bisa mewajibkan gambarnya,
  // bukan membiarkan staf menembak lalu gagal seluruhnya.
  punya_gambar: boolean
  // Template ber-`{{1}}` gagal 100% di jalur broadcast ini: parameter isian
  // tidak pernah dikirim. Ditandai supaya layar Kirim Pesan tidak menawarkannya.
  punya_variabel: boolean
}

interface BarisPromoMeta {
  template: string
  judul: string
  ringkas: string
  berlaku_sampai: string | null
}

function ringkas(t: TemplateMeta, meta: Map<string, BarisPromoMeta>): RingkasanTemplate {
  const komponen = t.components ?? []
  const jenis = (k: KomponenMeta) => (k.type ?? '').toUpperCase()
  const body = komponen.find((k) => jenis(k) === 'BODY')
  const header = komponen.find((k) => jenis(k) === 'HEADER')
  const footer = komponen.find((k) => jenis(k) === 'FOOTER')
  const tombolPertama = komponen.find((k) => jenis(k) === 'BUTTONS')?.buttons?.[0]
  const tercatat = meta.get(t.name ?? '')

  return {
    id: t.id ?? '',
    nama: t.name ?? '',
    judul: tercatat?.judul ?? '',
    ringkas: tercatat?.ringkas ?? '',
    berlaku_sampai: tercatat?.berlaku_sampai ?? null,
    status: t.status ?? '',
    kategori: t.category ?? '',
    bahasa: t.language ?? '',
    isi: body?.text ?? '',
    footer: footer?.text ?? '',
    tombol: tombolPertama
      ? {
          tipe: (tombolPertama.type ?? '').toUpperCase() === 'URL' ? 'situs' : 'balasan',
          teks: tombolPertama.text ?? '',
          url: tombolPertama.url ?? '',
        }
      : null,
    punya_gambar: (header?.format ?? '').toUpperCase() === 'IMAGE',
    punya_variabel: punyaVariabel(t),
  }
}

/** Judul dan keterangan yang ditulis staf, dipetakan per nama template Meta. */
async function ambilPromoMeta(env: Env): Promise<Map<string, BarisPromoMeta>> {
  const peta = new Map<string, BarisPromoMeta>()
  try {
    const hasil = await env.DB.prepare(
      'SELECT template, judul, ringkas, berlaku_sampai FROM promo_meta',
    ).all<BarisPromoMeta>()
    for (const baris of hasil.results ?? []) peta.set(baris.template, baris)
  } catch {
    // Tabel belum ada di lingkungan yang migrasinya tertinggal. Daftar template
    // tetap disajikan tanpa judul, itu jauh lebih baik daripada layar kosong.
  }
  return peta
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

  const daftar = await ambilDaftarTemplateMeta(env)
  if (!daftar.ok) return json({ error: daftar.pesan }, { status: daftar.status })

  const meta = await ambilPromoMeta(env)
  const disetujui = daftar.data.filter((t) => t.status === 'APPROVED').map((t) => ringkas(t, meta))
  const menunggu = daftar.data.filter((t) => t.status !== 'APPROVED').map((t) => ringkas(t, meta))

  // Sudah disetujui Meta tapi tetap tidak bisa dipakai dari sini: template
  // ber-variabel butuh parameter isian per nomor, dan broadcast massal ini tidak
  // punya isian itu. Dipisah -- bukan disembunyikan -- supaya staf yang membuatnya
  // di WhatsApp Manager tahu kenapa template itu tidak muncul di daftar kirim.
  const template = disetujui.filter((t) => !t.punya_variabel)
  const tak_didukung = disetujui.filter((t) => t.punya_variabel)

  return json({ template, menunggu, tak_didukung })
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

interface KomponenBody {
  type: 'BODY'
  text: string
}

interface KomponenFooter {
  type: 'FOOTER'
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

type KomponenTemplate =
  | KomponenHeaderGambar
  | KomponenBody
  | KomponenFooter
  | KomponenButtons

interface TombolValid {
  tipe: 'situs' | 'balasan'
  teks: string
  url: string
}

interface TemplateValid {
  judul: string
  ringkas: string
  isi: string
  footer: string
  kategori: string
  tombol: TombolValid | null
  berlakuSampai: string | null
  gambarUrl: string
}

/** Tanggal hari ini di zona Asia/Jakarta. Format YYYY-MM-DD boleh dibandingkan sebagai string. */
function hariIniJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

const KATEGORI_SAH = new Set(['MARKETING', 'UTILITY'])

/**
 * Validasi dijalankan sebelum apa pun dikirim ke Meta, dan berhenti di pelanggaran
 * PERTAMA. Yang membaca pesan ini staf hotel, jadi kalimatnya utuh dan tanpa
 * istilah Graph API.
 */
function validasi(body: Record<string, unknown>): TemplateValid | { error: string } {
  const judul = String(body.judul ?? '').trim()
  if (judul.length < PANJANG_JUDUL_MIN) return { error: 'Nama template terlalu pendek.' }
  if (judul.length > PANJANG_JUDUL_MAKS) {
    return { error: `Nama template terlalu panjang, maksimal ${PANJANG_JUDUL_MAKS} huruf.` }
  }

  const ringkasIsian = String(body.ringkas ?? '').trim()
  if (ringkasIsian.length > PANJANG_RINGKAS_MAKS) {
    return { error: `Keterangan singkat maksimal ${PANJANG_RINGKAS_MAKS} huruf.` }
  }

  const isi = String(body.isi ?? '').trim()
  if (isi.length < PANJANG_ISI_MIN) return { error: 'Isi pesan terlalu pendek.' }
  if (isi.length > PANJANG_ISI_MAKS) return { error: 'Isi pesan maksimal 1.024 huruf.' }
  // Meta menolak template yang memakai {{ }} tanpa contoh isian, dan pengiriman
  // broadcast di sini tidak mengirimkan parameter apa pun. Ditutup di sini.
  if (isi.includes('{{') || isi.includes('}}')) {
    return { error: 'Isi pesan tidak boleh memakai tanda {{ }}. Tulis kalimatnya lengkap.' }
  }

  const footer = String(body.footer ?? '').trim()
  if (footer.length > PANJANG_FOOTER_MAKS) {
    return { error: `Footer maksimal ${PANJANG_FOOTER_MAKS} huruf.` }
  }

  const kategori = String(body.kategori ?? '').trim().toUpperCase()
  if (!KATEGORI_SAH.has(kategori)) return { error: 'Jenis template tidak dikenali.' }

  // Tombol boleh tidak ada. Ucapan terima kasih ke tamu lama tidak selalu perlu
  // tombol, dan template tanpa tombol lolos peninjauan lebih cepat.
  const tombolMentah = (body.tombol && typeof body.tombol === 'object' ? body.tombol : null) as {
    tipe?: unknown
    teks?: unknown
    url?: unknown
  } | null

  let tombol: TombolValid | null = null
  if (tombolMentah && String(tombolMentah.teks ?? '').trim() !== '') {
    const tipe =
      tombolMentah.tipe === 'situs' || tombolMentah.tipe === 'balasan' ? tombolMentah.tipe : null
    if (!tipe) return { error: 'Jenis tombol tidak dikenali.' }

    const teks = String(tombolMentah.teks ?? '').trim()
    if (teks.length > PANJANG_TOMBOL_MAKS) {
      return { error: `Tulisan tombol maksimal ${PANJANG_TOMBOL_MAKS} huruf.` }
    }

    const url = String(tombolMentah.url ?? '').trim()
    if (tipe === 'situs') {
      if (!url.startsWith('https://')) return { error: 'Link tombol harus diawali https://' }
      // Meta menolak tombol yang mengarah ke wa.me (error_subcode 2388081).
      if (url.includes('wa.me') || url.includes('api.whatsapp.com')) {
        return {
          error:
            'WhatsApp tidak mengizinkan link wa.me dipakai sebagai tombol. Pakai link website, atau ganti tombolnya jadi tombol balasan cepat.',
        }
      }
    }

    tombol = { tipe, teks, url: tipe === 'situs' ? url : '' }
  }

  const berlakuIsian = String(body.berlaku_sampai ?? '').trim()
  let berlakuSampai: string | null = null
  if (berlakuIsian !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(berlakuIsian) || berlakuIsian < hariIniJakarta()) {
      return { error: 'Masa berlaku tidak boleh tanggal yang sudah lewat.' }
    }
    berlakuSampai = berlakuIsian
  }

  const gambarUrl = String(body.gambar_url ?? '').trim()
  if (gambarUrl !== '') {
    let alamat: URL
    try {
      alamat = new URL(gambarUrl)
    } catch {
      return { error: 'Alamat gambar tidak terbaca. Tempel alamat lengkap yang diawali https://' }
    }
    if (alamat.protocol !== 'https:') return { error: 'Alamat gambar harus diawali https://' }
  }

  return {
    judul,
    ringkas: ringkasIsian,
    isi,
    footer,
    kategori,
    tombol,
    berlakuSampai,
    gambarUrl,
  }
}

/**
 * Nama template Meta: huruf kecil, non-alfanumerik jadi `_`, garis bawah beruntun
 * dipadatkan, dipangkas di ujung, maksimal 60 karakter. Staf tidak pernah mengetik
 * nama ini -- dibuat dari judul yang mereka isi.
 */
function buatDasarNama(judul: string): string {
  let dasar = judul
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (dasar.length > 60) dasar = dasar.slice(0, 60).replace(/_$/, '')
  return dasar || 'template'
}

/** Tambah `_2`, `_3`, ... sampai tidak bentrok nama yang sudah dipakai. */
function namaBebasBentrok(dasar: string, terpakai: Set<string>): string {
  if (!terpakai.has(dasar)) return dasar
  for (let i = 2; i < 1000; i++) {
    const akhiran = `_${i}`
    const kandidat = `${dasar.slice(0, Math.max(1, 60 - akhiran.length))}${akhiran}`
    if (!terpakai.has(kandidat)) return kandidat
  }
  return `${dasar.slice(0, 40)}_${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Ajukan template baru ke Graph API. Urutannya mengikat: nama dicek bentrok dulu,
 * gambar diunggah, template dibuat di Meta, BARU judulnya dicatat di D1. Kalau
 * urutannya dibalik, D1 bisa menyimpan judul untuk template yang ternyata ditolak.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Permintaan tidak terbaca.' }, { status: 400 })
  }

  // Isian diperiksa SEBELUM kredensial: isian ngawur adalah salah staf dan harus
  // dibilang begitu, apa pun keadaan kredensial server.
  const isian = validasi(body)
  if ('error' in isian) return json({ error: isian.error }, { status: 400 })

  // Lokal/dev sengaja tidak punya kredensial Meta -- ini keadaan normal, bukan galat.
  if (!env.META_TOKEN || !env.META_WABA_ID) {
    return json(
      { error: 'meta_belum_dikonfigurasi', meta_belum_dikonfigurasi: true },
      { status: 503 },
    )
  }

  const daftar = await ambilDaftarTemplateMeta(env)
  if (!daftar.ok) return json({ error: daftar.pesan }, { status: daftar.status })

  // Nama dibandingkan ke Meta DAN ke D1: `promo_meta.template` itu PRIMARY KEY,
  // jadi nama yang masih tercatat di D1 tapi templatenya sudah dihapus di Meta
  // akan lolos cek Meta lalu gagal saat disimpan, sesudah template terlanjur dibuat.
  const terpakai = new Set<string>()
  for (const t of daftar.data) if (t.name) terpakai.add(t.name)
  for (const nama of (await ambilPromoMeta(env)).keys()) terpakai.add(nama)
  const namaTemplate = namaBebasBentrok(buatDasarNama(isian.judul), terpakai)

  const komponen: KomponenTemplate[] = []

  // Header gambar diunggah DULU. Kalau unggahannya gagal, template tidak boleh
  // terlanjur diajukan tanpa gambar -- staf akan mengira promonya bergambar.
  if (isian.gambarUrl) {
    const hasilUnggah = await unggahGambarHeader(env, isian.gambarUrl)
    if (!hasilUnggah.ok) return json({ error: hasilUnggah.alasan }, { status: 502 })
    komponen.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [hasilUnggah.handle] },
    })
  }

  komponen.push({ type: 'BODY', text: isian.isi })
  if (isian.footer) komponen.push({ type: 'FOOTER', text: isian.footer })
  if (isian.tombol) {
    komponen.push({
      type: 'BUTTONS',
      buttons:
        isian.tombol.tipe === 'situs'
          ? [{ type: 'URL', text: isian.tombol.teks, url: isian.tombol.url }]
          : [{ type: 'QUICK_REPLY', text: isian.tombol.teks }],
    })
  }

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${VERSI}/${env.META_WABA_ID}/message_templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: namaTemplate,
        language: 'id',
        category: isian.kategori,
        components: komponen,
      }),
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

  await env.DB.prepare(
    'INSERT OR REPLACE INTO promo_meta (template, judul, ringkas, berlaku_sampai) VALUES (?, ?, ?, ?)',
  )
    .bind(namaTemplate, isian.judul, isian.ringkas, isian.berlakuSampai)
    .run()

  const sukses = terurai as { id?: string; status?: string; category?: string } | null
  return json(
    {
      ok: true,
      id: sukses?.id,
      nama: namaTemplate,
      status: sukses?.status,
      kategori: sukses?.category,
    },
    { status: 201 },
  )
}
