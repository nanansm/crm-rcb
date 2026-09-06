import { guard, json, type Env } from '../../_lib/auth'

const POLA_WARNA = /^#[0-9a-fA-F]{6}$/

interface BarisTag {
  id: number
  nama: string
  warna: string | null
  jumlah_kontak: number
}

interface BodyTagBaru {
  nama?: unknown
  warna?: unknown
}

// Dipakai halaman Segmen. Middleware sudah menjaga /api/tag, tapi guard
// tetap dipanggil di sini supaya endpoint aman kalau diakses langsung.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  // Satu query agregat: jumlah_kontak per tag lewat LEFT JOIN + COUNT,
  // bukan query terpisah per tag di sisi aplikasi.
  const hasilQuery = await env.DB.prepare(
    `SELECT
       t.id AS id,
       t.nama AS nama,
       t.warna AS warna,
       COUNT(kt.kontak_nomor) AS jumlah_kontak
     FROM tag t
     LEFT JOIN kontak_tag kt ON kt.tag_id = t.id
     GROUP BY t.id, t.nama, t.warna
     ORDER BY t.nama ASC`,
  ).all<BarisTag>()

  return json({ tag: hasilQuery.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyTagBaru
  try {
    body = await request.json<BodyTagBaru>()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const nama = typeof body.nama === 'string' ? body.nama.trim() : ''
  if (nama === '') return json({ error: 'nama_wajib' }, { status: 400 })

  let warna: string | null = null
  if (body.warna !== undefined && body.warna !== null) {
    if (typeof body.warna !== 'string' || !POLA_WARNA.test(body.warna)) {
      return json({ error: 'warna_tidak_valid' }, { status: 400 })
    }
    warna = body.warna
  }

  try {
    const hasilInsert = await env.DB.prepare('INSERT INTO tag (nama, warna) VALUES (?, ?)')
      .bind(nama, warna)
      .run()
    return json({ id: hasilInsert.meta.last_row_id, nama, warna }, { status: 201 })
  } catch (err) {
    // UNIQUE(nama) bentrok = nama sudah dipakai tag lain, bukan kegagalan server.
    const pesan = err instanceof Error ? err.message : ''
    if (pesan.includes('UNIQUE')) {
      return json({ error: 'nama_sudah_ada' }, { status: 409 })
    }
    throw err
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const idMentah = url.searchParams.get('id')
  const id = Number(idMentah)
  if (!idMentah || !Number.isInteger(id)) {
    return json({ error: 'id_wajib' }, { status: 400 })
  }

  // ON DELETE CASCADE di kontak_tag(tag_id) menghapus relasi kontak sekaligus.
  const hasilHapus = await env.DB.prepare('DELETE FROM tag WHERE id = ?').bind(id).run()
  if (hasilHapus.meta.changes === 0) {
    return json({ error: 'tag_tidak_ditemukan' }, { status: 404 })
  }

  return json({ ok: true })
}
