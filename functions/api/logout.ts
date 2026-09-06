import { hapusSesi, type Env } from '../_lib/db'
import { guard, hapusSesiCookie, json, tokenHashDariRequest } from '../_lib/auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (hasil.ok) {
    const tokenHash = await tokenHashDariRequest(request)
    if (tokenHash) await hapusSesi(env, tokenHash)
  }
  // Tetap 200 walau sesi sudah tidak valid, biar tombol Keluar tidak macet.
  return json({ ok: true }, { headers: { 'Set-Cookie': hapusSesiCookie(request) } })
}
