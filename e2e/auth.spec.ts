import { test, expect } from '@playwright/test'

// Akun uji LOKAL saja (lihat seed/lokal.sql). Bukan akun produksi.
const EMAIL_AKTIF = 'e2e@lokal.test'
const EMAIL_NONAKTIF = 'nonaktif@lokal.test'
const SANDI = 'uji-lokal-123'
const PESAN_GAGAL = 'Email atau kata sandi salah'

test('GET /api/me tanpa cookie balas 401', async ({ request }) => {
  const res = await request.get('/api/me')
  expect(res.status()).toBe(401)
})

test('login dengan sandi salah balas 401 dengan pesan galat baku', async ({ request }) => {
  const res = await request.post('/api/login', {
    data: { email: EMAIL_AKTIF, password: 'sandi-salah-pasti' },
  })
  expect(res.status()).toBe(401)
  const body = await res.json()
  expect(body.error).toBe(PESAN_GAGAL)
})

test('login dengan email tidak terdaftar balas persis sama seperti sandi salah', async ({ request }) => {
  const resSalah = await request.post('/api/login', {
    data: { email: EMAIL_AKTIF, password: 'sandi-salah-pasti' },
  })
  const resTakTerdaftar = await request.post('/api/login', {
    data: { email: 'tidak-ada@lokal.test', password: 'apa-saja-123' },
  })
  expect(resTakTerdaftar.status()).toBe(resSalah.status())
  const bodySalah = await resSalah.json()
  const bodyTakTerdaftar = await resTakTerdaftar.json()
  expect(bodyTakTerdaftar).toEqual(bodySalah)
})

test('login akun nonaktif ditolak dengan pesan baku, bukan pesan khusus', async ({ request }) => {
  const res = await request.post('/api/login', {
    data: { email: EMAIL_NONAKTIF, password: SANDI },
  })
  expect(res.status()).toBe(401)
  const body = await res.json()
  expect(body.error).toBe(PESAN_GAGAL)
})

// Pakai fixture `context` (bukan `request` polos) karena satu-satunya cara
// memeriksa atribut cookie (HttpOnly) adalah lewat context.cookies() — dan
// itu cuma terisi kalau request lewat context.request, bukan APIRequestContext
// berdiri sendiri.
test('login benar balas 200 memuat email dan cookie sesi HttpOnly', async ({ context }) => {
  const res = await context.request.post('/api/login', {
    data: { email: EMAIL_AKTIF, password: SANDI },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.email).toBe(EMAIL_AKTIF)

  const cookies = await context.cookies()
  const sesi = cookies.find((c) => c.name === 'crm_session')
  expect(sesi).toBeTruthy()
  expect(sesi?.httpOnly).toBe(true)
})

test('sesudah login, GET /api/me balas 200 dengan email yang sama', async ({ context }) => {
  await context.request.post('/api/login', { data: { email: EMAIL_AKTIF, password: SANDI } })

  const res = await context.request.get('/api/me')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.email).toBe(EMAIL_AKTIF)
})

test('logout balas 200 lalu GET /api/me balas 401', async ({ context }) => {
  await context.request.post('/api/login', { data: { email: EMAIL_AKTIF, password: SANDI } })

  const resLogout = await context.request.post('/api/logout')
  expect(resLogout.status()).toBe(200)

  const resMe = await context.request.get('/api/me')
  expect(resMe.status()).toBe(401)
})

test('alur antarmuka: login lewat form memunculkan sidebar, keluar mengembalikan layar login', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Email').fill(EMAIL_AKTIF)
  await page.getByLabel('Kata sandi').fill(SANDI)
  await page.getByRole('button', { name: 'Masuk' }).click()

  const tombolKeluar = page.getByRole('button', { name: 'Keluar' })
  await expect(tombolKeluar).toBeVisible()

  await tombolKeluar.click()

  await expect(page.getByLabel('Email')).toBeVisible()
})

test('POST /api/pesan-masuk tanpa header rahasia balas 401, bukan lolos ke middleware cookie', async ({ request }) => {
  const res = await request.post('/api/pesan-masuk', {
    data: { nomor: '000000000000', teks: 'uji tanpa header rahasia' },
  })
  expect(res.status()).toBe(401)
})
