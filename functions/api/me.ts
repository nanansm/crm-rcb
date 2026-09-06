import { guard, json, type Env } from '../_lib/auth'

interface PenggunaRingkas {
  id: number
  nama: string
  email: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const baris = await env.DB.prepare('SELECT id, nama, email FROM pengguna WHERE id = ?')
    .bind(hasil.penggunaId)
    .first<PenggunaRingkas>()

  if (!baris) return json({ error: 'unauthorized' }, { status: 401 })

  return json(baris)
}
