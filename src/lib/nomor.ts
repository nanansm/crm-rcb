/**
 * Aturan normalisasi nomor. Dipakai DUA sisi: browser (saat file diunggah) dan
 * Pages Function (saat nomor disimpan). Wajib satu berkas, bukan dua salinan --
 * beda satu aturan berarti nomor yang lolos di browser terbuang diam-diam di server.
 */
export function norm(x: unknown): string | null {
  let d = String(x ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('6262')) d = '62' + d.slice(4)
  else if (d.startsWith('620')) d = '62' + d.slice(3)
  if (d.startsWith('0')) d = '62' + d.slice(1)
  else if (d.startsWith('8')) d = '62' + d
  if (!d.startsWith('628')) return null
  if (d.length < 11 || d.length > 14) return null
  return d
}

// Kata yang lebih spesifik ditaruh duluan: 'no hp' harus menang atas 'hp',
// dan 'whatsapp' atas 'wa'.
const KATA_KOLOM_NOMOR = [
  'nomor',
  'no hp',
  'nohp',
  'no_hp',
  'whatsapp',
  'telepon',
  'telpon',
  'telp',
  'phone',
  'mobile',
  'kontak',
  'contact',
  'hp',
  'wa',
]

const KATA_KOLOM_NAMA = ['nama', 'name', 'guest', 'tamu', 'pemesan', 'customer']

export interface HasilBaca {
  kolomNomor: string
  kolomNama: string | null
  barisFile: number
  terbaca: number
  rusak: number
  kosong: number
  dobelDiFile: number
  nomor: { nomor: string; nama: string }[]
}

/**
 * Cari kolom nomor. Perulangan luar adalah KATA, bukan header, supaya kata yang
 * lebih spesifik menang lebih dulu apa pun urutan kolom di file aslinya.
 * Kalau tidak ada judul kolom yang cocok, pilih kolom yang isinya paling banyak
 * terbaca sebagai nomor -- ekspor PMS sering memberi judul kolom seadanya.
 */
function cariKolomNomor(headers: string[], rows: Record<string, unknown>[]): string {
  const lower = headers.map((h) => h.toLowerCase())
  for (const kata of KATA_KOLOM_NOMOR) {
    const idx = lower.findIndex((h) => h.includes(kata))
    if (idx !== -1) return headers[idx]
  }

  let terbaik: string | null = null
  let terbanyak = 0
  for (const h of headers) {
    const valid = rows.reduce((n, r) => (norm(r[h]) !== null ? n + 1 : n), 0)
    if (valid > terbanyak) {
      terbanyak = valid
      terbaik = h
    }
  }
  if (terbaik) return terbaik

  throw new Error('Tidak ada kolom berisi nomor HP di file ini.')
}

function cariKolomNama(headers: string[], kolomNomor: string): string | null {
  const lower = headers.map((h) => h.toLowerCase())
  for (const kata of KATA_KOLOM_NAMA) {
    const idx = lower.findIndex((h, i) => headers[i] !== kolomNomor && h.includes(kata))
    if (idx !== -1) return headers[idx]
  }
  return null
}

/**
 * Pecah satu baris CSV. Ditulis tangan, bukan `split(',')`: nama tamu sering
 * mengandung koma di dalam tanda kutip ("Budi, S.E.") dan pemisah naif akan
 * menggeser SELURUH kolom setelahnya, termasuk kolom nomor.
 */
function pecahBarisCsv(baris: string, pemisah: string): string[] {
  const keluar: string[] = []
  let sel = ''
  let dalamKutip = false
  for (let i = 0; i < baris.length; i++) {
    const c = baris[i]
    if (dalamKutip) {
      if (c === '"') {
        // Dua kutip berturut-turut = satu kutip harfiah di dalam sel.
        if (baris[i + 1] === '"') {
          sel += '"'
          i++
        } else {
          dalamKutip = false
        }
      } else {
        sel += c
      }
      continue
    }
    if (c === '"') dalamKutip = true
    else if (c === pemisah) {
      keluar.push(sel)
      sel = ''
    } else sel += c
  }
  keluar.push(sel)
  return keluar.map((s) => s.trim())
}

/**
 * Ubah teks CSV jadi baris berjudul. Pemisahnya ditebak dari baris judul:
 * Excel berbahasa Indonesia mengekspor CSV bertitik-koma, dan membacanya
 * sebagai koma membuat seluruh baris jadi satu kolom.
 */
export function bacaCsv(teks: string): Record<string, unknown>[] {
  const bersih = teks.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const baris = bersih.split('\n').filter((b) => b.trim() !== '')
  if (baris.length < 2) return []

  const koma = (baris[0].match(/,/g) ?? []).length
  const titikKoma = (baris[0].match(/;/g) ?? []).length
  const pemisah = titikKoma > koma ? ';' : ','

  const headers = pecahBarisCsv(baris[0], pemisah).map((h, i) => h || `kolom_${i + 1}`)
  const keluar: Record<string, unknown>[] = []
  for (let i = 1; i < baris.length; i++) {
    const sel = pecahBarisCsv(baris[i], pemisah)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, j) => {
      obj[h] = sel[j] ?? ''
    })
    keluar.push(obj)
  }
  return keluar
}

/** Hitung ulang isi file jadi daftar nomor bersih plus laporan per sebab buang. */
export function bacaBaris(rows: Record<string, unknown>[]): HasilBaca {
  if (rows.length === 0) throw new Error('Tidak ada kolom berisi nomor HP di file ini.')

  const headers = Object.keys(rows[0])
  const kolomNomor = cariKolomNomor(headers, rows)
  const kolomNama = cariKolomNama(headers, kolomNomor)

  let rusak = 0
  let kosong = 0
  let dobelDiFile = 0
  const dipakai = new Set<string>()
  const nomor: { nomor: string; nama: string }[] = []

  for (const row of rows) {
    const mentah = row[kolomNomor]
    if (mentah === undefined || mentah === null || String(mentah).trim() === '') {
      kosong++
      continue
    }
    const bersih = norm(mentah)
    if (!bersih) {
      rusak++
      continue
    }
    if (dipakai.has(bersih)) {
      dobelDiFile++
      continue
    }
    dipakai.add(bersih)
    nomor.push({ nomor: bersih, nama: kolomNama ? String(row[kolomNama] ?? '').trim() : '' })
  }

  return {
    kolomNomor,
    kolomNama,
    barisFile: rows.length,
    terbaca: nomor.length,
    rusak,
    kosong,
    dobelDiFile,
    nomor,
  }
}
