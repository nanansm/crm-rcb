import type { Env } from './db'

/**
 * Nomor tujuan mode "Uji dulu". Nomor ini milik tim, bukan tamu, dan sengaja
 * TIDAK ditulis di dalam kode: repo ini publik. Kosong berarti mode uji mati,
 * bukan jatuh ke nomor bawaan mana pun -- salah tujuan di sini berarti pesan uji
 * mendarat di HP tamu.
 */
export function nomorUji(env: Env): string | null {
  const mentah = (env.NOMOR_UJI ?? '').replace(/\D/g, '')
  if (!mentah.startsWith('628')) return null
  if (mentah.length < 11 || mentah.length > 14) return null
  return mentah
}
