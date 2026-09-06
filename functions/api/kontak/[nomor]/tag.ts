import { guard, json, type Env } from '../../../_lib/auth'

interface BarisTag {
  id: number
  nama: string
  warna: string | null
}

interface BodyTag {
  tag_id?: number
}

function ambilNomor(params: Record<string, string | string[]>): string {
  const nomor = params.nomor
  return typeof nomor === 'string' ? nomor : Array.isArray(nomor) ? nomor[0] : ''
}

async function ambilTagKontak(env: Env, nomor: string): Promise<BarisTag[]> {
  const hasil = await env.DB.prepare(
    `SELECT t.id AS id, t.nama AS nama, t.warna AS warna
     FROM tag t
     JOIN kontak_tag kt ON kt.tag_id = t.id
     WHERE kt.kontak_nomor = ?
     ORDER BY t.nama`,
  )
    .bind(nomor)
    .all<BarisTag>()
  return hasil.results ?? []
}

// Pasang satu tag ke kontak. Tag yang sudah terpasang tetap 200 (ON CONFLICT DO NOTHING).
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = ambilNomor(params)
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyTag
  try {
    body = (await request.json()) as BodyTag
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const tagId = Number(body.tag_id)
  if (!Number.isFinite(tagId) || tagId <= 0) return json({ error: 'tag_id_tidak_valid' }, { status: 400 })

  const kontakAda = await env.DB.prepare('SELECT nomor FROM kontak WHERE nomor = ?').bind(nomor).first()
  if (!kontakAda) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  const tagAda = await env.DB.prepare('SELECT id FROM tag WHERE id = ?').bind(tagId).first()
  if (!tagAda) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  await env.DB.prepare('INSERT INTO kontak_tag (kontak_nomor, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .bind(nomor, tagId)
    .run()

  return json({ ok: true, tag: await ambilTagKontak(env, nomor) })
}

// Lepas satu tag dari kontak, `?tag_id=`.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = ambilNomor(params)
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const tagId = Number(url.searchParams.get('tag_id'))
  if (!Number.isFinite(tagId) || tagId <= 0) return json({ error: 'tag_id_tidak_valid' }, { status: 400 })

  const kontakAda = await env.DB.prepare('SELECT nomor FROM kontak WHERE nomor = ?').bind(nomor).first()
  if (!kontakAda) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  const tagAda = await env.DB.prepare('SELECT id FROM tag WHERE id = ?').bind(tagId).first()
  if (!tagAda) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  await env.DB.prepare('DELETE FROM kontak_tag WHERE kontak_nomor = ? AND tag_id = ?')
    .bind(nomor, tagId)
    .run()

  return json({ ok: true, tag: await ambilTagKontak(env, nomor) })
}
