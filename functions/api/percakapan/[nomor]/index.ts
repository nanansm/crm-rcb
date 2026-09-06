import { guard, json, type Env } from '../../../_lib/auth'

const LIMIT_DEFAULT = 200
const LIMIT_MAKS = 500
const JENDELA_MS = 24 * 60 * 60 * 1000

interface BarisKontak {
  nomor: string
  nama: string | null
  opt_out: number
  terakhir_pesan_masuk: string | null
  status_agent: string | null
  staf_id: number | null
  diambil_pada: string | null
  terakhir_pesan_pada: string | null
}

interface BarisPesan {
  id: number
  arah: string
  pengirim: string
  teks: string | null
  wamid: string | null
  waktu: string
}

// Dipakai halaman detail percakapan (Inbox). Baca-saja, tidak menulis apa pun ke D1.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = typeof params.nomor === 'string' ? params.nomor : Array.isArray(params.nomor) ? params.nomor[0] : ''
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limitMentah = Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT)
  const limit = Number.isFinite(limitMentah) && limitMentah > 0 ? Math.min(limitMentah, LIMIT_MAKS) : LIMIT_DEFAULT

  // Kontak + percakapan digabung lewat LEFT JOIN: baris percakapan boleh belum ada.
  const baris = await env.DB.prepare(
    `SELECT
       k.nomor AS nomor,
       k.nama AS nama,
       k.opt_out AS opt_out,
       k.terakhir_pesan_masuk AS terakhir_pesan_masuk,
       p.status_agent AS status_agent,
       p.staf_id AS staf_id,
       p.diambil_pada AS diambil_pada,
       p.terakhir_pesan_pada AS terakhir_pesan_pada
     FROM kontak k
     LEFT JOIN percakapan p ON p.nomor = k.nomor
     WHERE k.nomor = ?`,
  )
    .bind(nomor)
    .first<BarisKontak>()

  if (!baris) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  // Ambil N pesan terbaru dulu (ORDER DESC + LIMIT), baru dibalik supaya
  // urutan akhir menaik seperti dibaca di layar chat.
  const hasilPesan = await env.DB.prepare(
    `SELECT id, arah, pengirim, teks, wamid, waktu
     FROM pesan_chat
     WHERE nomor = ?
     ORDER BY waktu DESC, id DESC
     LIMIT ?`,
  )
    .bind(nomor, limit)
    .all<BarisPesan>()

  const pesan = (hasilPesan.results ?? []).reverse()

  const masuk = baris.terakhir_pesan_masuk ? new Date(baris.terakhir_pesan_masuk).getTime() : null
  const sekarang = Date.now()
  const dalamJendela = masuk !== null && sekarang - masuk < JENDELA_MS
  const sisaJendelaDetik = dalamJendela ? Math.floor((masuk! + JENDELA_MS - sekarang) / 1000) : 0

  return json({
    kontak: {
      nomor: baris.nomor,
      nama: baris.nama,
      opt_out: baris.opt_out,
      terakhir_pesan_masuk: baris.terakhir_pesan_masuk,
    },
    percakapan: {
      status_agent: baris.status_agent ?? 'aktif',
      staf_id: baris.staf_id,
      diambil_pada: baris.diambil_pada,
      terakhir_pesan_pada: baris.terakhir_pesan_pada,
    },
    dalam_jendela: dalamJendela,
    sisa_jendela_detik: sisaJendelaDetik,
    pesan,
  })
}
