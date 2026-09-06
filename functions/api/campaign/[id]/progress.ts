import { guard, json, type Env } from '../../../_lib/auth'

interface BarisCampaign {
  id: number
  status: string
  template: string
  target: number
  terkirim: number
  gagal: number
  tertahan: number
  aktif: number | null
  mulai: string
}

// Dipakai layar progres staf. Baca-saja, tidak menulis apa pun ke D1.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const idMentah = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : ''
  const id = Number(idMentah)
  if (!Number.isFinite(id)) return json({ error: 'id_tidak_valid' }, { status: 400 })

  const baris = await env.DB.prepare(
    'SELECT id, status, template, target, terkirim, gagal, tertahan, aktif, mulai FROM campaign WHERE id = ?',
  )
    .bind(id)
    .first<BarisCampaign>()

  if (!baris) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  // target 0 berarti belum ada penerima terhitung -- jangan bagi nol.
  const selesai = baris.terkirim + baris.gagal + baris.tertahan
  const persen = baris.target > 0 ? Math.round((selesai / baris.target) * 100) : 0

  return json({
    id: baris.id,
    status: baris.status,
    template: baris.template,
    target: baris.target,
    terkirim: baris.terkirim,
    gagal: baris.gagal,
    tertahan: baris.tertahan,
    aktif: baris.aktif,
    mulai: baris.mulai,
    persen,
  })
}
