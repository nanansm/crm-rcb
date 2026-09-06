import { ambilSesiAktif, hapusSesi, catatSesi, type Env } from './db'

export type { Env }

const COOKIE_NAME = 'crm_session'
const SESSION_TTL_SECONDS = 12 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

// WAJIB 100000, TIDAK BOLEH lebih: Cloudflare Workers menolak PBKDF2 di atas
// 100.000 iterasi saat runtime (bukan saat typecheck/build).
const PBKDF2_ITERATIONS = 100000

const encoder = new TextEncoder()

function base64url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Comparison that does not leak the position of the first differing byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await pbkdf2(password, salt)
  return `${base64url(salt.buffer)}:${base64url(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false
  const salt = base64urlDecode(saltB64)
  const bits = await pbkdf2(password, salt)
  return safeEqual(base64url(bits), hashB64)
}

function cookieDariHeader(request: Request): string | null {
  const header = request.headers.get('Cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

async function hashToken(token: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
}

/** Buat sesi baru di D1 (token acak, cuma hash-nya yang disimpan) dan kembalikan header Set-Cookie. */
export async function buatSesiCookie(env: Env, penggunaId: number, ip: string): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const tokenHash = await hashToken(token)
  const kadaluarsa = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await catatSesi(env, { tokenHash, penggunaId, kadaluarsa, ip })
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ')
}

export function hapusSesiCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export type HasilGuard = { ok: true; penggunaId: number } | { ok: false }

/** Dipakai `_middleware.ts` untuk menolak request tanpa sesi valid. */
export async function guard(request: Request, env: Env): Promise<HasilGuard> {
  const token = cookieDariHeader(request)
  if (!token) return { ok: false }

  const tokenHash = await hashToken(token)
  const sesi = await ambilSesiAktif(env, tokenHash)
  if (!sesi) return { ok: false }

  if (new Date(sesi.kadaluarsa).getTime() <= Date.now()) {
    await hapusSesi(env, tokenHash)
    return { ok: false }
  }

  return { ok: true, penggunaId: sesi.penggunaId }
}

/** Hash token sesi dari cookie request, dipakai buat hapus baris sesi saat logout. */
export async function tokenHashDariRequest(request: Request): Promise<string | null> {
  const token = cookieDariHeader(request)
  if (!token) return null
  return hashToken(token)
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  })
}
