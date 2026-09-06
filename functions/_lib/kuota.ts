import type { Env } from './auth'

// Nomor WhatsApp Rancabango belum lolos Business Verification, jadi Meta
// membatasi jumlah PENERIMA UNIK yang boleh dihubungi bisnis dalam 24 jam.
// Lewat batas ini bukan cuma gagal kirim, tapi bisa menurunkan kualitas
// nomor yang juga dipakai melayani tamu sehari-hari.
export const BATAS_PENERIMA_24JAM = 250

const JENDELA_MS = 24 * 60 * 60 * 1000

interface BarisHitung {
  total: number
}

interface BarisNomorBc {
  nomor: string
  terakhir_bc: string | null
}

export interface SisaKuota {
  terpakai: number
  sisa: number
}

/** Hitung penerima UNIK (bukan jumlah baris) yang sudah dikirimi dalam 24 jam terakhir. */
export async function sisaKuota(env: Env): Promise<SisaKuota> {
  const cutoff = new Date(Date.now() - JENDELA_MS).toISOString()
  const hasil = await env.DB.prepare(
    `SELECT COUNT(DISTINCT nomor) AS total FROM pengiriman WHERE diperbarui >= ?`,
  )
    .bind(cutoff)
    .first<BarisHitung>()
  const terpakai = hasil?.total ?? 0
  const sisa = Math.max(0, BATAS_PENERIMA_24JAM - terpakai)
  return { terpakai, sisa }
}

export interface TargetSegmenInput {
  tagIds: number[]
  maks?: number
}

export interface TargetSegmenHasil {
  nomor: string[]
  total_cocok: number
  dibuang_opt_out: number
  dibuang_baru_dibc: number
  dipotong_kuota: number
}

/**
 * Daftar nomor layak kirim: punya SEMUA tag di `tagIds` (kosong = semua kontak),
 * bukan opt_out, dan belum di-broadcast dalam 24 jam terakhir (mencegah satu
 * tamu dihujani dua broadcast sehari). Dipotong ke `maks`, lalu ke sisa kuota.
 */
export async function targetSegmen(env: Env, input: TargetSegmenInput): Promise<TargetSegmenHasil> {
  const { tagIds, maks } = input
  const kondisiTag: string[] = []
  const paramTag: (string | number)[] = []

  // Butuh SEMUA tag yang diminta: cocokkan lewat kontak_tag lalu syaratkan
  // jumlah tag yang match sama dengan jumlah tag yang diminta.
  if (tagIds.length > 0) {
    const placeholder = tagIds.map(() => '?').join(', ')
    kondisiTag.push(
      `nomor IN (SELECT kontak_nomor FROM kontak_tag WHERE tag_id IN (${placeholder}) GROUP BY kontak_nomor HAVING COUNT(DISTINCT tag_id) = ?)`,
    )
    paramTag.push(...tagIds, tagIds.length)
  }

  const klausaTag = kondisiTag.length > 0 ? `WHERE ${kondisiTag.join(' AND ')}` : ''

  const total_cocok =
    (
      await env.DB.prepare(`SELECT COUNT(*) AS total FROM kontak ${klausaTag}`)
        .bind(...paramTag)
        .first<BarisHitung>()
    )?.total ?? 0

  const kondisiOptOut = [...kondisiTag, 'opt_out = 0']
  const hasilOptOut = await env.DB.prepare(
    `SELECT nomor, terakhir_bc FROM kontak WHERE ${kondisiOptOut.join(' AND ')}`,
  )
    .bind(...paramTag)
    .all<BarisNomorBc>()
  const setelahOptOut = hasilOptOut.results ?? []
  const dibuang_opt_out = total_cocok - setelahOptOut.length

  const cutoff = Date.now() - JENDELA_MS
  const eligible = setelahOptOut.filter((baris) => {
    if (!baris.terakhir_bc) return true
    return new Date(baris.terakhir_bc).getTime() < cutoff
  })
  const dibuang_baru_dibc = setelahOptOut.length - eligible.length

  let dipilih = eligible
  if (typeof maks === 'number' && maks >= 0) dipilih = dipilih.slice(0, maks)

  const { sisa } = await sisaKuota(env)
  const sebelumKuota = dipilih.length
  dipilih = dipilih.slice(0, sisa)
  const dipotong_kuota = sebelumKuota - dipilih.length

  return {
    nomor: dipilih.map((baris) => baris.nomor),
    total_cocok,
    dibuang_opt_out,
    dibuang_baru_dibc,
    dipotong_kuota,
  }
}
