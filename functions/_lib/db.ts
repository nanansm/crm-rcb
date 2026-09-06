/**
 * Pembungkus tipis di atas D1 untuk tabel `pengguna` dan `sesi`. Endpoint lain
 * bicara lewat fungsi di sini, bukan lewat SQL langsung.
 */

export interface Env {
  DB: D1Database
  CRM_STATE: KVNamespace
}

export interface Pengguna {
  id: number
  nama: string
  email: string
  password_hash: string
  aktif: number
}

export interface SesiAktif {
  penggunaId: number
  kadaluarsa: string // ISO
}

export async function ambilPenggunaByEmail(env: Env, email: string): Promise<Pengguna | null> {
  const baris = await env.DB.prepare(
    'SELECT id, nama, email, password_hash, aktif FROM pengguna WHERE email = ?',
  )
    .bind(email)
    .first<Pengguna>()
  return baris ?? null
}

export async function catatSesi(
  env: Env,
  data: { tokenHash: string; penggunaId: number; kadaluarsa: string; ip: string },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sesi (token_hash, pengguna_id, kadaluarsa, ip) VALUES (?, ?, ?, ?)',
  )
    .bind(data.tokenHash, data.penggunaId, data.kadaluarsa, data.ip)
    .run()
}

export async function ambilSesiAktif(env: Env, tokenHash: string): Promise<SesiAktif | null> {
  // JOIN ke pengguna: staf yang dinonaktifkan harus langsung kehilangan akses,
  // tidak menunggu sesi 12 jam habis.
  const baris = await env.DB.prepare(
    `SELECT s.pengguna_id, s.kadaluarsa
       FROM sesi s
       JOIN pengguna p ON p.id = s.pengguna_id
      WHERE s.token_hash = ? AND p.aktif = 1`,
  )
    .bind(tokenHash)
    .first<{ pengguna_id: number; kadaluarsa: string }>()
  if (!baris) return null
  return { penggunaId: baris.pengguna_id, kadaluarsa: baris.kadaluarsa }
}

export async function hapusSesi(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sesi WHERE token_hash = ?').bind(tokenHash).run()
}
