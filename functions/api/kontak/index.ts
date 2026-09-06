import { guard, json, type Env } from '../../_lib/auth'

const LIMIT_DEFAULT = 100
const LIMIT_MAKS = 500
const JENDELA_MS = 24 * 60 * 60 * 1000

interface BarisKontak {
  nomor: string
  nama: string | null
  catatan: string | null
  opt_out: number
  terakhir_pesan_masuk: string | null
}

interface BarisTagKontak {
  kontak_nomor: string
  id: number
  nama: string
  warna: string | null
}

interface RingkasanBaris {
  total: number
}

// Dipakai halaman Kontak & Segmen. Middleware sudah menjaga /api/kontak, tapi
// guard tetap dipanggil di sini supaya endpoint aman kalau diakses langsung.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limitMentah = Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT)
  const limit = Number.isFinite(limitMentah) && limitMentah > 0 ? Math.min(limitMentah, LIMIT_MAKS) : LIMIT_DEFAULT
  const cari = (url.searchParams.get('cari') ?? '').trim()
  const optOutMentah = url.searchParams.get('opt_out')
  const tagIds = url.searchParams
    .getAll('tag')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v))

  const kondisi: string[] = []
  const param: (string | number)[] = []

  if (cari !== '') {
    kondisi.push('(kontak.nomor LIKE ? OR kontak.nama LIKE ?)')
    param.push(`%${cari}%`, `%${cari}%`)
  }

  if (optOutMentah === '1' || optOutMentah === '0') {
    kondisi.push('kontak.opt_out = ?')
    param.push(optOutMentah === '1' ? 1 : 0)
  }

  // Butuh SEMUA tag yang diminta (bukan salah satu), jadi satu EXISTS per tag_id, di-AND-kan.
  for (const tagId of tagIds) {
    kondisi.push('EXISTS (SELECT 1 FROM kontak_tag kt WHERE kt.kontak_nomor = kontak.nomor AND kt.tag_id = ?)')
    param.push(tagId)
  }

  const klausaWhere = kondisi.length > 0 ? `WHERE ${kondisi.join(' AND ')}` : ''

  const hasilTotal = await env.DB.prepare(`SELECT COUNT(*) AS total FROM kontak ${klausaWhere}`)
    .bind(...param)
    .first<RingkasanBaris>()
  const total = hasilTotal?.total ?? 0

  const hasilKontak = await env.DB.prepare(
    `SELECT nomor, nama, catatan, opt_out, terakhir_pesan_masuk
     FROM kontak
     ${klausaWhere}
     ORDER BY (terakhir_pesan_masuk IS NULL) ASC, terakhir_pesan_masuk DESC
     LIMIT ?`,
  )
    .bind(...param, limit)
    .all<BarisKontak>()

  const daftarKontak = hasilKontak.results ?? []

  // Tag diambil terpisah lewat IN (...) supaya tidak JOIN 1:N yang menggandakan
  // baris kontak per tag (satu kontak bisa punya banyak tag).
  const tagPerNomor = new Map<string, { id: number; nama: string; warna: string | null }[]>()
  if (daftarKontak.length > 0) {
    const placeholder = daftarKontak.map(() => '?').join(', ')
    const hasilTag = await env.DB.prepare(
      `SELECT kt.kontak_nomor AS kontak_nomor, t.id AS id, t.nama AS nama, t.warna AS warna
       FROM kontak_tag kt
       JOIN tag t ON t.id = kt.tag_id
       WHERE kt.kontak_nomor IN (${placeholder})`,
    )
      .bind(...daftarKontak.map((k) => k.nomor))
      .all<BarisTagKontak>()

    for (const baris of hasilTag.results ?? []) {
      const daftar = tagPerNomor.get(baris.kontak_nomor) ?? []
      daftar.push({ id: baris.id, nama: baris.nama, warna: baris.warna })
      tagPerNomor.set(baris.kontak_nomor, daftar)
    }
  }

  const sekarang = Date.now()
  const daftar = daftarKontak.map((baris) => {
    const masuk = baris.terakhir_pesan_masuk ? new Date(baris.terakhir_pesan_masuk).getTime() : null
    return {
      nomor: baris.nomor,
      nama: baris.nama,
      catatan: baris.catatan,
      opt_out: baris.opt_out === 1,
      terakhir_pesan_masuk: baris.terakhir_pesan_masuk,
      dalam_jendela: masuk !== null && sekarang - masuk < JENDELA_MS,
      tag: tagPerNomor.get(baris.nomor) ?? [],
    }
  })

  return json({ kontak: daftar, total })
}
