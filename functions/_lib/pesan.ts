/**
 * Helper D1 untuk tabel `kontak`, `percakapan`, dan `pesan_chat`. Dipakai
 * endpoint pesan-masuk dan endpoint lain yang menulis riwayat chat.
 */

import type { Env } from './db'

export type StatusAgent = 'aktif' | 'diambil_alih'

export interface SimpanPesanInput {
  nomor: string
  arah: string
  pengirim: string
  teks?: string | null
  wamid?: string | null
  waktu: string
}

/**
 * Buat baris kontak kalau belum ada, selalu perbarui jejak pesan masuk terakhir.
 * `waktu` = timestamp pesan dari Meta, bukan jam server. Jendela 24 jam dihitung
 * dari kolom ini, jadi memakai jam server akan menggeser jendela setiap kali
 * webhook telat tiba. `MAX` menjaga jendela tidak mundur saat webhook tiba
 * tidak berurutan.
 */
export async function upsertKontak(
  env: Env,
  nomor: string,
  nama?: string | null,
  waktu?: string,
): Promise<void> {
  const sekarang = new Date().toISOString()
  const masuk = waktu ?? sekarang
  await env.DB.prepare(
    `INSERT INTO kontak (nomor, nama, opt_out, terakhir_pesan_masuk, dibuat, diperbarui)
     VALUES (?, ?, 0, ?, ?, ?)
     ON CONFLICT(nomor) DO UPDATE SET
       terakhir_pesan_masuk = MAX(excluded.terakhir_pesan_masuk, kontak.terakhir_pesan_masuk),
       diperbarui = excluded.diperbarui,
       -- jangan timpa nama yang sudah terisi dengan nilai kosong/null
       nama = CASE
         WHEN kontak.nama IS NULL OR kontak.nama = '' THEN COALESCE(excluded.nama, kontak.nama)
         ELSE kontak.nama
       END`,
  )
    .bind(nomor, nama ?? null, masuk, sekarang, sekarang)
    .run()
}

/**
 * Simpan satu pesan. Idempoten lewat wamid: di SQLite, NULL tidak pernah
 * dianggap bentrok oleh UNIQUE, jadi pesan tanpa wamid (misal dikirim staf
 * sebelum wamid diketahui) selalu masuk tanpa menyentuh jalur ON CONFLICT.
 */
export async function simpanPesan(env: Env, data: SimpanPesanInput): Promise<boolean> {
  const hasil = await env.DB.prepare(
    `INSERT INTO pesan_chat (nomor, arah, pengirim, teks, wamid, waktu)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(wamid) DO NOTHING`,
  )
    .bind(data.nomor, data.arah, data.pengirim, data.teks ?? null, data.wamid ?? null, data.waktu)
    .run()
  return (hasil.meta.changes ?? 0) > 0
}

/**
 * Baca/siapkan baris percakapan, sekaligus perbarui jejak waktu pesan terakhir.
 * Satu pernyataan upsert, bukan SELECT lalu INSERT: dua pesan yang tiba
 * bersamaan dari nomor yang sama akan bentrok di primary key kalau dipisah.
 * `MAX` dipakai karena webhook Meta bisa tiba tidak berurutan — jejak waktu
 * tidak boleh mundur.
 */
export async function statusPercakapan(env: Env, nomor: string, waktu: string): Promise<StatusAgent> {
  const baris = await env.DB.prepare(
    `INSERT INTO percakapan (nomor, status_agent, terakhir_pesan_pada)
     VALUES (?, 'aktif', ?)
     ON CONFLICT(nomor) DO UPDATE SET
       terakhir_pesan_pada = MAX(excluded.terakhir_pesan_pada, percakapan.terakhir_pesan_pada)
     RETURNING status_agent`,
  )
    .bind(nomor, waktu)
    .first<{ status_agent: string }>()

  return baris?.status_agent === 'diambil_alih' ? 'diambil_alih' : 'aktif'
}

export async function apakahOptOut(env: Env, nomor: string): Promise<boolean> {
  const baris = await env.DB.prepare('SELECT opt_out FROM kontak WHERE nomor = ?')
    .bind(nomor)
    .first<{ opt_out: number }>()
  return (baris?.opt_out ?? 0) !== 0
}
