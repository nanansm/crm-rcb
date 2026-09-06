import { guard, json, type Env } from '../../_lib/auth'
import { targetSegmen } from '../../_lib/kuota'
import { jalankanBroadcast } from '../../_lib/n8n'

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
}

interface BodyCampaignBaru {
  template?: unknown
  tag_ids?: unknown
  maks?: unknown
  gambar_url?: unknown
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

// Middleware sudah menjaga /api/campaign, tapi guard tetap dipanggil di sini
// supaya endpoint aman kalau diakses langsung.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const hasilQuery = await env.DB.prepare(
    `SELECT id, status, template, target, terkirim, gagal, tertahan, mulai, aktif, gambar_url
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
  const maks = typeof body.maks === 'number' ? body.maks : undefined

  const gambar = bacaGambarUrl(body.gambar_url)
  if (!gambar.ok) return json({ error: gambar.alasan }, { status: 400 })

  // Dihitung SEBELUM baris campaign dibuat: target kosong artinya tidak boleh
  // ada campaign baru sama sekali, bukan campaign yang dibuat dengan target 0.
  const segmen = await targetSegmen(env, { tagIds, maks })
  const nomor = segmen.nomor
  if (nomor.length === 0) {
    return json(
      {
        error: 'target_kosong',
        total_cocok: segmen.total_cocok,
        dibuang_opt_out: segmen.dibuang_opt_out,
        dibuang_baru_dibc: segmen.dibuang_baru_dibc,
        dipotong_kuota: segmen.dipotong_kuota,
      },
      { status: 400 },
    )
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
         (status, template, segmen_tag_id, maks, target, terkirim, gagal, tertahan, mulai, aktif, gambar_url)
       VALUES ('berjalan', ?, ?, ?, ?, 0, 0, 0, ?, 1, ?)`,
    )
      .bind(template, segmenTagId, maks ?? 0, nomor.length, mulai, gambar.url)
      .run()
    campaignId = Number(hasilInsert.meta.last_row_id)
  } catch (err) {
    const pesan = err instanceof Error ? err.message : ''
    if (pesan.includes('UNIQUE')) {
      return json({ error: 'masih_ada_yang_jalan' }, { status: 409 })
    }
    throw err
  }

  const hasilBroadcast = await jalankanBroadcast(env, { campaignId, template, nomor, gambarUrl: gambar.url })
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
    { id: campaignId, target: nomor.length, dipotong_kuota: segmen.dipotong_kuota },
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
