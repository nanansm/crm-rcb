import { ambilPenggunaByEmail, type Env } from '../_lib/db'
import { buatSesiCookie, json, verifyPassword } from '../_lib/auth'

const PESAN_GAGAL = 'Email atau kata sandi salah'
const BATAS_GAGAL_BAWAAN = 8
const JENDELA_GAGAL_DETIK = 15 * 60

// Hash dummy (bukan hash siapa pun) dengan format valid salt:hash. Dipakai
// supaya verifyPassword tetap jalan walau email tidak ditemukan, agar waktu
// respons tidak membocorkan email mana yang terdaftar.
const HASH_DUMMY = `${'A'.repeat(22)}:${'A'.repeat(43)}`

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = ''
  let password = ''
  try {
    const body = (await request.json()) as { email?: string; password?: string }
    email = String(body.email ?? '').trim()
    password = String(body.password ?? '')
  } catch {
    return json({ error: 'Permintaan tidak terbaca.' }, { status: 400 })
  }
  if (!email || !password) {
    return json({ error: 'Email dan kata sandi wajib diisi.' }, { status: 400 })
  }

  // Pembatas percobaan gagal, dicek sebelum menyentuh D1. Batasnya bisa
  // dinaikkan lewat env untuk lingkungan uji, tanpa melonggarkan produksi.
  const batasGagal = Number(env.MAKS_LOGIN_GAGAL) || BATAS_GAGAL_BAWAAN
  const kunciGagal = `login-gagal:${email}`
  const jumlahGagal = Number((await env.CRM_STATE.get(kunciGagal)) ?? '0')
  if (jumlahGagal >= batasGagal) {
    return json({ error: 'Terlalu banyak percobaan, coba lagi nanti.' }, { status: 429 })
  }

  const pengguna = await ambilPenggunaByEmail(env, email)
  // Selalu jalankan verifyPassword, pakai hash dummy kalau pengguna tidak
  // ditemukan, supaya waktu respons sama di kasus email ada maupun tidak.
  const cocok = await verifyPassword(password, pengguna?.password_hash ?? HASH_DUMMY)

  if (!pengguna || pengguna.aktif !== 1 || !cocok) {
    await env.CRM_STATE.put(kunciGagal, String(jumlahGagal + 1), {
      expirationTtl: JENDELA_GAGAL_DETIK,
    })
    return json({ error: PESAN_GAGAL }, { status: 401 })
  }

  await env.CRM_STATE.delete(kunciGagal)

  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const cookie = await buatSesiCookie(env, pengguna.id, ip, request)
  return json(
    { id: pengguna.id, nama: pengguna.nama, email: pengguna.email },
    { headers: { 'Set-Cookie': cookie } },
  )
}
