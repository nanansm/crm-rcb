import { guard, json, type Env } from '../../_lib/auth'
import { targetSegmen } from '../../_lib/kuota'
import { jalankanBroadcast } from '../../_lib/n8n'
import {
  ambilDaftarTemplateMeta,
  punyaHeaderGambar,
  punyaVariabel,
} from '../../_lib/template-meta'
import { nomorUji } from '../../_lib/uji'

interface BarisCampaign {
  id: number
  status: string
  template: string
  target: number
  terkirim: number
  gagal: number
  tertahan: number
  mulai: string
  aktif: number | null
  gambar_url: string | null
  daftar_id: string | null
}

interface BodyCampaignBaru {
  template?: unknown
  tag_ids?: unknown
  maks?: unknown
  gambar_url?: unknown
  daftar_id?: unknown
}

/**
 * Meta menolak http biasa dan hanya mengambil gambar dari URL publik.
 * Gagal di sini jauh lebih murah daripada gagal di tengah kiriman ke ratusan tamu.
 */
function bacaGambarUrl(nilai: unknown): { ok: true; url: string | null } | { ok: false; alasan: string } {
  if (nilai === undefined || nilai === null || nilai === '') return { ok: true, url: null }
  if (typeof nilai !== 'string') return { ok: false, alasan: 'gambar_url_tidak_valid' }
  let url: URL
  try {
    url = new URL(nilai)
  } catch {
    return { ok: false, alasan: 'gambar_url_tidak_valid' }
  }
  if (url.protocol !== 'https:') return { ok: false, alasan: 'gambar_url_wajib_https' }
  return { ok: true, url: url.toString() }
}

type HasilPeriksa =
  | { ok: true; bahasa: string }
  | { ok: false; alasan: string; status: number }

/**
 * Pastikan template yang dipilih staf masih benar-benar bisa dikirim, dan
 * ambil kode bahasanya. Bahasa TIDAK boleh ditebak: template dibuat dari CRM
 * memakai 'id', tapi template bawaan WABA (hello_world dan kawan-kawan)
 * memakai en_US, dan salah kode bahasa membuat Meta menolak setiap nomor.
 */
async function periksaTemplate(
  env: Env,
  nama: string,
  gambarUrl: string | null,
): Promise<HasilPeriksa> {
  // Lokal/dev sengaja tidak punya kredensial Meta. Pemeriksaan dilewati dan
  // bahasa jatuh ke 'id' -- satu-satunya bahasa yang dipakai template buatan CRM.
  if (!env.META_TOKEN || !env.META_WABA_ID) return { ok: true, bahasa: 'id' }

  const daftar = await ambilDaftarTemplateMeta(env)
  if (!daftar.ok) return { ok: false, alasan: daftar.pesan, status: daftar.status }

  const cocok = daftar.data.filter((t) => t.name === nama)
  if (cocok.length === 0) return { ok: false, alasan: 'template_tidak_ditemukan', status: 400 }

  const siap = cocok.find((t) => t.status === 'APPROVED')
  if (!siap) return { ok: false, alasan: 'template_belum_disetujui', status: 400 }

  if (punyaVariabel(siap)) return { ok: false, alasan: 'template_pakai_variabel', status: 400 }

  const butuhGambar = punyaHeaderGambar(siap)
  if (butuhGambar && !gambarUrl) return { ok: false, alasan: 'template_wajib_gambar', status: 400 }
  if (!butuhGambar && gambarUrl) {
    return { ok: false, alasan: 'template_tidak_pakai_gambar', status: 400 }
  }

  return { ok: true, bahasa: siap.language ?? 'id' }
}

// Middleware sudah menjaga /api/campaign, tapi guard tetap dipanggil di sini
// supaya endpoint aman kalau diakses langsung.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const hasilQuery = await env.DB.prepare(
    `SELECT id, status, template, target, terkirim, gagal, tertahan, mulai, aktif, gambar_url, daftar_id
       FROM campaign
      ORDER BY id DESC
      LIMIT 50`,
  ).all<BarisCampaign>()

  return json({ campaign: hasilQuery.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyCampaignBaru
  try {
    body = await request.json<BodyCampaignBaru>()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const template = typeof body.template === 'string' ? body.template.trim() : ''
  if (template === '') return json({ error: 'template_wajib' }, { status: 400 })

  const tagIds = Array.isArray(body.tag_ids)
    ? body.tag_ids.filter((v): v is number => typeof v === 'number')
    : []
  const maksMentah = typeof body.maks === 'number' ? body.maks : undefined
  const daftarId = typeof body.daftar_id === 'string' && body.daftar_id.trim() !== '' ? body.daftar_id.trim() : null

  const gambar = bacaGambarUrl(body.gambar_url)
  if (!gambar.ok) return json({ error: gambar.alasan }, { status: 400 })

  // Template diperiksa ulang ke Meta TEPAT sebelum kirim, bukan dipercaya dari
  // layar staf. Daftar di layar bisa sudah basi berjam-jam: Meta bisa menjeda
  // template kapan saja, dan bahasa template menentukan payload kirim. Salah di
  // sini artinya seluruh nomor dalam campaign gagal, bukan satu-dua.
  const periksa = await periksaTemplate(env, template, gambar.url)
  if (!periksa.ok) return json({ error: periksa.alasan }, { status: periksa.status })
  const bahasa = periksa.bahasa

  // maks = -1: mode uji. Satu pesan ke nomor tim, tidak ada tamu yang menerima
  // dan tidak ada `terakhir_bc` tamu yang ikut tercoret. Jalur ini sengaja
  // memotong targetSegmen sepenuhnya supaya tidak ada satu pun nomor tamu yang
  // bisa nyelip ke dalam kiriman uji.
  const uji = maksMentah === -1
  // maks = 0 dari layar preset berarti "semua tamu"; targetSegmen membaca 0
  // sebagai batas nol pesan, jadi harus diteruskan sebagai undefined.
  const maks = maksMentah !== undefined && maksMentah > 0 ? maksMentah : undefined

  let nomor: string[]
  let segmen = { total_cocok: 0, dibuang_opt_out: 0, dibuang_baru_dibc: 0, dipotong_kuota: 0 }

  if (uji) {
    const tujuanUji = nomorUji(env)
    if (!tujuanUji) return json({ error: 'nomor_uji_belum_diatur' }, { status: 503 })
    nomor = [tujuanUji]
  } else {
    // Dihitung SEBELUM baris campaign dibuat: target kosong artinya tidak boleh
    // ada campaign baru sama sekali, bukan campaign yang dibuat dengan target 0.
    const hasilSegmen = await targetSegmen(env, { tagIds, maks, daftarId })
    nomor = hasilSegmen.nomor
    segmen = hasilSegmen
    if (nomor.length === 0) {
      return json(
        {
          error: 'target_kosong',
          total_cocok: hasilSegmen.total_cocok,
          dibuang_opt_out: hasilSegmen.dibuang_opt_out,
          dibuang_baru_dibc: hasilSegmen.dibuang_baru_dibc,
          dipotong_kuota: hasilSegmen.dipotong_kuota,
        },
        { status: 400 },
      )
    }
  }

  const mulai = new Date().toISOString()
  // Kolom campaign cuma menampung satu tag (informational) -- filter sebenarnya
  // sudah dieksekusi di targetSegmen lewat kontak_tag yang many-to-many.
  const segmenTagId = tagIds.length === 1 ? tagIds[0] : null

  let campaignId: number
  try {
    // INSERT-nya sendiri yang jadi kunci: indeks unik parsial campaign_aktif_tunggal
    // menolak baris kedua dengan aktif=1, jadi tidak perlu cek-lalu-tulis dua langkah
    // yang rawan race antara dua klik atau dua request beruntun.
    const hasilInsert = await env.DB.prepare(
      `INSERT INTO campaign
         (status, template, segmen_tag_id, maks, target, terkirim, gagal, tertahan, mulai, aktif, gambar_url, daftar_id)
       VALUES ('berjalan', ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?)`,
    )
      .bind(template, segmenTagId, maksMentah ?? 0, nomor.length, mulai, gambar.url, uji ? null : daftarId)
      .run()
    campaignId = Number(hasilInsert.meta.last_row_id)
  } catch (err) {
    const pesan = err instanceof Error ? err.message : ''
    if (pesan.includes('UNIQUE')) {
      return json({ error: 'masih_ada_yang_jalan' }, { status: 409 })
    }
    throw err
  }

  const hasilBroadcast = await jalankanBroadcast(env, {
    campaignId,
    template,
    bahasa,
    nomor,
    gambarUrl: gambar.url,
  })
  if (!hasilBroadcast.ok) {
    // Wajib dilepas di sini: kalau baris ini dibiarkan aktif=1 padahal n8n tidak
    // pernah benar-benar jalan, indeks unik parsial mengunci SELURUH sistem --
    // tidak ada campaign baru yang bisa dibuat sampai baris hantu ini dibereskan manual.
    await env.DB.prepare(`UPDATE campaign SET status = 'gagal', aktif = NULL WHERE id = ?`)
      .bind(campaignId)
      .run()
    return json({ error: hasilBroadcast.pesan }, { status: 502 })
  }

  return json(
    { id: campaignId, target: nomor.length, uji, dipotong_kuota: segmen.dipotong_kuota },
    { status: 201 },
  )
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  // Tidak ada campaign aktif pun tetap 200 -- menghentikan sesuatu yang sudah
  // berhenti bukan kegagalan, jadi tidak perlu dibedakan dari sukses.
  await env.DB.prepare(`UPDATE campaign SET status = 'dihentikan', aktif = NULL WHERE aktif = 1`).run()

  return json({ ok: true })
}
