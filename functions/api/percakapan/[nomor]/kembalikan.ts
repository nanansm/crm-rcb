import { guard, json, type Env } from '../../../_lib/auth'

// Staf menekan tombol "Kembalikan" di Inbox. Boleh dipanggil siapa pun staf
// yang sedang login (bukan cuma yang tadi ambil-alih) — staf yang memegang
// bisa saja habis giliran kerjanya, dan tamu tidak boleh terkunci menunggu
// jawaban cuma karena satu orang itu belum sempat mengembalikan.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = typeof params.nomor === 'string' ? params.nomor : Array.isArray(params.nomor) ? params.nomor[0] : ''
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const sekarang = new Date().toISOString()

  // Kalau baris percakapan belum pernah ada, dia sudah "aktif" secara default
  // (lihat index.ts) — tidak perlu dibuat, UPDATE yang tidak kena baris pun
  // tetap dianggap sukses supaya tombol tidak pernah macet dengan 404.
  await env.DB.prepare(
    `UPDATE percakapan
     SET status_agent = 'aktif', staf_id = NULL, diambil_pada = NULL
     WHERE nomor = ?`,
  )
    .bind(nomor)
    .run()

  // Tutup log takeover yang masih terbuka untuk nomor ini.
  await env.DB.prepare(
    `UPDATE takeover SET dikembalikan_pada = ? WHERE nomor = ? AND dikembalikan_pada IS NULL`,
  )
    .bind(sekarang, nomor)
    .run()

  return json({ status_agent: 'aktif', staf_id: null, diambil_pada: null })
}
