import { guard, json, type Env } from '../../_lib/auth'

const LIMIT_DEFAULT = 50
const LIMIT_MAKS = 200
const JENDELA_MS = 24 * 60 * 60 * 1000

interface BarisPercakapan {
  nomor: string
  nama: string | null
  status_agent: string
  terakhir_pesan_pada: string | null
  terakhir_pesan_masuk: string | null
  cuplikan: string | null
  arah_terakhir: string | null
}

/**
 * Staf mengetik nomor seperti di HP (`0812…`, `+62 812…`, pakai spasi/strip),
 * sedangkan kolom `nomor` menyimpan wa_id (`62812…`). Tanpa normalisasi ini
 * pencarian nomor selalu nihil untuk cara mengetik yang paling umum dipakai.
 */
function normalkanCari(mentah: string): { nomor: string; nama: string } {
  const nama = mentah.trim()
  const digit = nama.replace(/\D/g, '')
  if (digit === '') return { nomor: '', nama }
  if (digit.startsWith('0')) return { nomor: `62${digit.slice(1)}`, nama }
  if (digit.startsWith('62')) return { nomor: digit, nama }
  if (digit.startsWith('8')) return { nomor: `62${digit}`, nama }
  return { nomor: digit, nama }
}

// Dipakai halaman Inbox. Middleware sudah menjaga /api/percakapan, tapi guard
// tetap dipanggil di sini supaya endpoint aman kalau diakses langsung.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limitMentah = Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT)
  const limit = Number.isFinite(limitMentah) && limitMentah > 0 ? Math.min(limitMentah, LIMIT_MAKS) : LIMIT_DEFAULT
  const offsetMentah = Number(url.searchParams.get('offset') ?? 0)
  const offset = Number.isFinite(offsetMentah) && offsetMentah >= 0 ? Math.floor(offsetMentah) : 0
  const cariMentah = url.searchParams.get('cari') ?? ''
  const { nomor: nomorCari, nama: namaCari } = normalkanCari(cariMentah)
  // Kalau nomor hasil normalisasi kosong (input murni huruf tanpa digit),
  // klausa LIKE nomor dibuat mustahil cocok -- ' ' tidak pernah ada di wa_id --
  // supaya pencarian nama tidak diam-diam ikut mencocokkan semua nomor.
  const nomorUntukLike = nomorCari === '' ? ' ' : nomorCari

  const whereKlausa = `(? = '' OR p.nomor LIKE '%' || ? || '%' OR k.nama LIKE '%' || ? || '%')`

  // Satu query: cuplikan pesan terakhir diambil lewat subquery terkorelasi,
  // bukan query terpisah per baris di sisi aplikasi.
  const hasilQuery = await env.DB.prepare(
    `SELECT
       p.nomor AS nomor,
       k.nama AS nama,
       p.status_agent AS status_agent,
       p.terakhir_pesan_pada AS terakhir_pesan_pada,
       k.terakhir_pesan_masuk AS terakhir_pesan_masuk,
       (
         SELECT substr(pc.teks, 1, 120)
         FROM pesan_chat pc
         WHERE pc.nomor = p.nomor
         ORDER BY pc.waktu DESC, pc.id DESC
         LIMIT 1
       ) AS cuplikan,
       (
         SELECT pc.arah
         FROM pesan_chat pc
         WHERE pc.nomor = p.nomor
         ORDER BY pc.waktu DESC, pc.id DESC
         LIMIT 1
       ) AS arah_terakhir
     FROM percakapan p
     LEFT JOIN kontak k ON k.nomor = p.nomor
     WHERE ${whereKlausa}
     ORDER BY p.terakhir_pesan_pada DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(namaCari, nomorUntukLike, namaCari, limit, offset)
    .all<BarisPercakapan>()

  const totalBaris = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM percakapan p
     LEFT JOIN kontak k ON k.nomor = p.nomor
     WHERE ${whereKlausa}`,
  )
    .bind(namaCari, nomorUntukLike, namaCari)
    .first<{ total: number }>()

  const sekarang = Date.now()
  const daftar = (hasilQuery.results ?? []).map((baris) => {
    const masuk = baris.terakhir_pesan_masuk ? new Date(baris.terakhir_pesan_masuk).getTime() : null
    // Percakapan yang diambil alih staf membuat AI agent DIAM. Kalau pesan
    // terakhir datang dari tamu (arah masuk) dan belum dibalas manusia,
    // tamu itu sedang menunggu tanpa ada siapa pun yang menjawab -- inilah
    // satu-satunya keadaan yang benar-benar mendesak di layar ini.
    const menunggu_dibalas = baris.arah_terakhir === 'masuk' && baris.status_agent === 'diambil_alih'
    return {
      nomor: baris.nomor,
      nama: baris.nama,
      status_agent: baris.status_agent,
      terakhir_pesan_pada: baris.terakhir_pesan_pada,
      cuplikan: baris.cuplikan,
      arah_terakhir: baris.arah_terakhir,
      menunggu_dibalas,
      dalam_jendela: masuk !== null && sekarang - masuk < JENDELA_MS,
    }
  })

  return json({ percakapan: daftar, total: totalBaris?.total ?? 0 })
}
