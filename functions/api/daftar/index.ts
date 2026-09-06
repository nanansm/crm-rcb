import { guard, json, type Env } from '../../_lib/auth'
import { norm } from '../../../src/lib/nomor'

// Unggahan dipecah tiga aksi (mulai/tambah/selesai) supaya satu request tidak
// pernah membawa ribuan nomor sekaligus -- Pages Function punya batas CPU dan
// batas ukuran body, dan ekspor reservasi hotel gampang tembus ribuan baris.
// Dua statement D1 per nomor (upsert kontak + tautan daftar) -- 200 nomor =
// 400 statement dalam satu batch. Batas ini juga menjaga jalur non-UI yang
// memanggil endpoint langsung.
const MAKS_NOMOR_PER_PANGGILAN = 200
const PANJANG_NAMA_MIN = 3
const PANJANG_NAMA_MAKS = 60
const PANJANG_KETERANGAN_MAKS = 120

interface BarisDaftar {
  id: string
  nama: string
  keterangan: string
  jumlah: number
  dibuat: string
}

interface BodyDaftar {
  aksi?: unknown
  id?: unknown
  nama?: unknown
  keterangan?: unknown
  nomor?: unknown
}

interface ItemNomor {
  nomor?: unknown
  nama?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  // Hanya daftar siap=1. Daftar yang unggahannya putus di tengah sengaja
  // tidak pernah kelihatan supaya tidak bisa dikirimi separuh.
  const q = await env.DB.prepare(
    `SELECT id, nama, keterangan, jumlah, dibuat
       FROM daftar
      WHERE siap = 1
      ORDER BY dibuat DESC
      LIMIT 100`,
  ).all<BarisDaftar>()

  return json({ daftar: q.results ?? [] })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const id = (new URL(request.url).searchParams.get('id') ?? '').trim()
  if (!id) return json({ error: 'id_wajib' }, { status: 400 })

  // Kontaknya sendiri TIDAK ikut terhapus: tamu yang sudah masuk CRM tetap punya
  // tag, catatan, dan riwayat chat. Yang dibuang cuma keanggotaan daftarnya.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM daftar_kontak WHERE daftar_id = ?').bind(id),
    env.DB.prepare('DELETE FROM daftar WHERE id = ?').bind(id),
  ])

  return json({ ok: true })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const sesi = await guard(request, env)
  if (!sesi.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyDaftar
  try {
    body = await request.json<BodyDaftar>()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const aksi = typeof body.aksi === 'string' ? body.aksi : ''

  if (aksi === 'mulai') {
    const nama = typeof body.nama === 'string' ? body.nama.trim() : ''
    if (nama.length < PANJANG_NAMA_MIN) return json({ error: 'Nama daftar terlalu pendek.' }, { status: 400 })
    if (nama.length > PANJANG_NAMA_MAKS) {
      return json({ error: `Nama daftar maksimal ${PANJANG_NAMA_MAKS} huruf.` }, { status: 400 })
    }

    const keterangan = typeof body.keterangan === 'string' ? body.keterangan.trim() : ''
    if (keterangan.length > PANJANG_KETERANGAN_MAKS) {
      return json({ error: `Keterangan maksimal ${PANJANG_KETERANGAN_MAKS} huruf.` }, { status: 400 })
    }

    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO daftar (id, nama, keterangan, jumlah, siap, dibuat) VALUES (?, ?, ?, 0, 0, ?)')
      .bind(id, nama, keterangan, new Date().toISOString())
      .run()
    return json({ id }, { status: 201 })
  }

  if (aksi === 'tambah') {
    const id = typeof body.id === 'string' ? body.id : ''
    const mentah = Array.isArray(body.nomor) ? (body.nomor as ItemNomor[]) : []
    if (mentah.length > MAKS_NOMOR_PER_PANGGILAN) {
      return json({ error: 'Potongan terlalu besar.' }, { status: 400 })
    }

    const status = await env.DB.prepare('SELECT siap FROM daftar WHERE id = ?')
      .bind(id)
      .first<{ siap: number }>()
    if (!status) return json({ error: 'Daftar tidak ditemukan.' }, { status: 404 })
    if (status.siap === 1) return json({ error: 'Daftar ini sudah dikunci.' }, { status: 400 })

    // Nomor dinormalkan ULANG di sini. Browser sudah menyaring, tapi endpoint ini
    // bisa dipanggil langsung, jadi yang tidak lolos dibuang diam-diam.
    const bersih = new Map<string, string>()
    for (const item of mentah) {
      const n = norm(item?.nomor)
      if (n) bersih.set(n, String(item?.nama ?? '').trim())
    }

    if (bersih.size > 0) {
      const sekarang = new Date().toISOString()
      const perintah: D1PreparedStatement[] = []
      for (const [nomor, nama] of bersih) {
        // Tamu impor ikut masuk tabel kontak supaya punya tag, opt-out, dan
        // riwayat yang sama seperti tamu yang datang dari chat. Nama hanya
        // diisi kalau kontaknya belum punya nama -- data chat lebih dipercaya
        // daripada ejaan di ekspor PMS.
        perintah.push(
          env.DB.prepare(
            `INSERT INTO kontak (nomor, nama, opt_out, dibuat, diperbarui)
             VALUES (?, ?, 0, ?, ?)
             ON CONFLICT(nomor) DO UPDATE SET
               nama = COALESCE(NULLIF(kontak.nama, ''), NULLIF(excluded.nama, '')),
               diperbarui = excluded.diperbarui`,
          ).bind(nomor, nama || null, sekarang, sekarang),
        )
        perintah.push(
          env.DB.prepare('INSERT OR IGNORE INTO daftar_kontak (daftar_id, nomor) VALUES (?, ?)').bind(id, nomor),
        )
      }
      await env.DB.batch(perintah)
    }

    return json({ ok: true, diterima: bersih.size })
  }

  if (aksi === 'selesai') {
    const id = typeof body.id === 'string' ? body.id : ''
    const hitung = await env.DB.prepare('SELECT COUNT(*) AS total FROM daftar_kontak WHERE daftar_id = ?')
      .bind(id)
      .first<{ total: number }>()
    const jumlah = hitung?.total ?? 0

    if (jumlah === 0) {
      // Daftar kosong dibuang, bukan disimpan: baris siap=0 yang menumpuk cuma
      // jadi sampah yang tidak pernah bisa dilihat maupun dihapus staf.
      await env.DB.prepare('DELETE FROM daftar WHERE id = ?').bind(id).run()
      return json({ error: 'Tidak ada satu pun nomor yang bisa dipakai dari file ini.' }, { status: 400 })
    }

    await env.DB.prepare('UPDATE daftar SET jumlah = ?, siap = 1 WHERE id = ?').bind(jumlah, id).run()
    return json({ ok: true, jumlah })
  }

  return json({ error: 'aksi_tidak_dikenal' }, { status: 400 })
}
