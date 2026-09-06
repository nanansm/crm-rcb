import { guard, json, type Env } from '../../../_lib/auth'

interface BarisPemegang {
  staf_id: number | null
}

// Staf menekan tombol "Ambil Alih" di Inbox. Begitu status_agent berubah,
// /api/pesan-masuk berhenti meneruskan pesan nomor ini ke agent n8n.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = typeof params.nomor === 'string' ? params.nomor : Array.isArray(params.nomor) ? params.nomor[0] : ''
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const sekarang = new Date().toISOString()

  // Satu pernyataan upsert: kalau baris percakapan belum ada, dibuat langsung
  // sudah "diambil_alih". Kalau sudah ada, klausa WHERE di ON CONFLICT cuma
  // meloloskan update bila baris belum dipegang siapa pun ATAU sudah dipegang
  // staf yang sama (idempoten). Tidak ada celah SELECT-lalu-INSERT yang bisa
  // disusupi permintaan lain di antara dua langkah.
  const hasilTulis = await env.DB.prepare(
    `INSERT INTO percakapan (nomor, status_agent, staf_id, diambil_pada)
     VALUES (?, 'diambil_alih', ?, ?)
     ON CONFLICT(nomor) DO UPDATE SET
       status_agent = 'diambil_alih',
       staf_id = excluded.staf_id,
       diambil_pada = excluded.diambil_pada
     WHERE percakapan.staf_id IS NULL OR percakapan.staf_id = excluded.staf_id`,
  )
    .bind(nomor, hasil.penggunaId, sekarang)
    .run()

  if (hasilTulis.meta.changes === 0) {
    // Gagal karena WHERE di atas menolak: baris sudah dipegang staf lain.
    const pemegang = await env.DB.prepare(`SELECT staf_id FROM percakapan WHERE nomor = ?`)
      .bind(nomor)
      .first<BarisPemegang>()
    return json({ error: 'sudah_dipegang', staf_id: pemegang?.staf_id ?? null }, { status: 409 })
  }

  // Log audit: satu baris per pengambilalihan, ditutup nanti oleh kembalikan.ts.
  // Pengambilalihan ulang oleh staf yang sama tidak menambah baris baru, supaya
  // log tidak dipenuhi duplikat dari klik berulang.
  await env.DB.prepare(
    `INSERT INTO takeover (nomor, staf_id, diambil_pada)
     SELECT ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM takeover
       WHERE nomor = ? AND staf_id = ? AND dikembalikan_pada IS NULL
     )`,
  )
    .bind(nomor, hasil.penggunaId, sekarang, nomor, hasil.penggunaId)
    .run()

  return json({ status_agent: 'diambil_alih', staf_id: hasil.penggunaId, diambil_pada: sekarang })
}
