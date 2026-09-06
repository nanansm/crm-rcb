import { guard, json, type Env } from '../_lib/auth'

/**
 * Satu angka: berapa tamu sedang menunggu dibalas manusia. Dipanggil terus-menerus
 * dari seluruh halaman untuk menulis badge di judul tab, jadi sengaja dipisah dari
 * `/api/percakapan` (dua query berat + cuplikan pesan per baris) dan dari
 * `/api/dashboard` (memanggil Graph API Meta). Satu COUNT, tanpa panggilan keluar.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  // Percakapan yang diambil alih staf tapi pesan TERAKHIRNYA dari tamu: agent
  // sudah didiamkan, jadi tidak ada siapa pun yang akan menjawab kalau staf tidak
  // membukanya. Pola subquery arah pesan terakhir sama persis dengan
  // percakapan/index.ts dan dashboard.ts -- ketiganya harus menghitung hal yang sama.
  const baris = await env.DB.prepare(
    `SELECT COUNT(*) AS total
       FROM percakapan p
      WHERE p.status_agent = 'diambil_alih'
        AND (
          SELECT pc.arah FROM pesan_chat pc
          WHERE pc.nomor = p.nomor
          ORDER BY pc.waktu DESC, pc.id DESC
          LIMIT 1
        ) = 'masuk'`,
  ).first<{ total: number }>()

  return json({ nunggu_dibalas: baris?.total ?? 0 })
}
