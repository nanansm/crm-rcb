import { test, expect, type APIRequestContext } from '@playwright/test'

// Uji stack LOKAL saja (lihat playwright.config.ts: baseURL 127.0.0.1:8788,
// dijalankan lewat `npm run dev:cf` dengan D1/KV lokal). Lingkungan lokal
// sengaja tidak punya kredensial Meta: `balas` yang lolos semua penjagaan
// berhenti di 502 `meta_belum_dikonfigurasi` — itu hasil BENAR di sini,
// diperlakukan sebagai lulus, bukan diakali.
const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899000${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

async function kirimPesanMasuk(request: APIRequestContext, nomor: string, teks: string, waktu?: string) {
  return request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, teks, wamid: `wamid.${nomor}.${Math.random().toString(36).slice(2)}`, ...(waktu ? { waktu } : {}) },
  })
}

test.describe('takeover: ambil-alih & kembalikan', () => {
  test('kontak baru: pesan masuk membalas status_agent aktif', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await kirimPesanMasuk(request, nomor, 'halo kontak baru')
    expect(res.status()).toBe(200)
    expect((await res.json()).status_agent).toBe('aktif')
  })

  test('sesudah ambil-alih, pesan masuk berikutnya membalas status_agent diambil_alih', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo sebelum ambil alih')

    await loginStaf(request)
    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(ambil.status()).toBe(200)
    expect((await ambil.json()).status_agent).toBe('diambil_alih')

    const res = await kirimPesanMasuk(request, nomor, 'halo sesudah ambil alih')
    expect(res.status()).toBe(200)
    expect((await res.json()).status_agent).toBe('diambil_alih')
  })

  test('ambil-alih dua kali oleh staf yang sama tetap 200, bukan 409', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await loginStaf(request)

    const pertama = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(pertama.status()).toBe(200)

    const kedua = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(kedua.status()).toBe(200)
  })

  test('sesudah kembalikan, pesan masuk berikutnya membalas status_agent aktif', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo sebelum kembalikan')

    await loginStaf(request)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    const kembali = await request.post(`/api/percakapan/${nomor}/kembalikan`)
    expect(kembali.status()).toBe(200)

    const res = await kirimPesanMasuk(request, nomor, 'halo sesudah kembalikan')
    expect((await res.json()).status_agent).toBe('aktif')
  })

  test('mengembalikan percakapan yang memang sudah aktif tetap 200, bukan 404', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await loginStaf(request)

    const res = await request.post(`/api/percakapan/${nomor}/kembalikan`)
    expect(res.status()).toBe(200)
  })

  test('ambil-alih dan kembalikan tanpa sesi staf ditolak 401', async ({ request }) => {
    const nomor = nomorUjiAcak()

    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(ambil.status()).toBe(401)

    const kembali = await request.post(`/api/percakapan/${nomor}/kembalikan`)
    expect(kembali.status()).toBe(401)
  })

  test('balas manual ditolak 409 sebelum diambil alih, tidak ada pesan tersimpan', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo pra ambil alih')

    await loginStaf(request)
    const sebelum = await request.get(`/api/percakapan/${nomor}`)
    expect(sebelum.status()).toBe(200)
    const jumlahSebelum = (await sebelum.json()).pesan.length

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'coba balas' } })
    expect(balas.status()).toBe(409)
    expect((await balas.json()).error).toBe('belum_diambil_alih')

    const sesudah = await request.get(`/api/percakapan/${nomor}`)
    expect((await sesudah.json()).pesan.length).toBe(jumlahSebelum)
  })

  test('balas manual ditolak 409 saat kontak opt_out walau sudah diambil alih', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo opt out')

    await loginStaf(request)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    const patch = await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    expect(patch.status()).toBe(200)

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'coba balas opt out' } })
    expect(balas.status()).toBe(409)
    expect((await balas.json()).error).toBe('opt_out')
  })

  test('balas manual ditolak 409 di luar jendela 24 jam', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const epochLama = Math.floor(Date.now() / 1000) - 25 * 60 * 60 // 25 jam lalu
    await kirimPesanMasuk(request, nomor, 'halo lama', String(epochLama))

    await loginStaf(request)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'coba balas lama' } })
    expect(balas.status()).toBe(409)
    expect((await balas.json()).error).toBe('di_luar_jendela')
  })

  test('balas manual yang lolos semua penjagaan berhenti 502 meta_belum_dikonfigurasi, tidak ada pesan tersimpan', async ({
    request,
  }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo lolos guard')

    await loginStaf(request)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)

    const sebelum = await request.get(`/api/percakapan/${nomor}`)
    const jumlahSebelum = (await sebelum.json()).pesan.length

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'balasan lolos guard' } })
    expect(balas.status()).toBe(502)
    const balasBody = await balas.json()
    expect(balasBody.error).toBe('gagal_kirim')
    expect(balasBody.pesan).toBe('meta_belum_dikonfigurasi')

    const sesudah = await request.get(`/api/percakapan/${nomor}`)
    expect((await sesudah.json()).pesan.length).toBe(jumlahSebelum)
  })

  test('Inbox: tombol Ambil alih dan Kembalikan ke agent bertukar kolom balasan', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimPesanMasuk(request, nomor, 'halo lewat UI takeover')

    await page.goto('/')
    await page.getByLabel('Email').fill(STAF_EMAIL)
    await page.getByLabel('Kata sandi').fill(STAF_PASSWORD)
    await page.getByRole('button', { name: 'Masuk' }).click()

    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByPlaceholder('Cari nomor atau nama').fill(nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).click()

    await page.getByRole('button', { name: 'Ambil alih' }).click()
    await expect(page.getByRole('button', { name: 'Kembalikan ke agent' })).toBeVisible()
    await expect(page.getByPlaceholder('Tulis balasan')).toBeVisible()

    await page.getByRole('button', { name: 'Kembalikan ke agent' }).click()
    await expect(page.getByRole('button', { name: 'Ambil alih' })).toBeVisible()
    await expect(page.getByPlaceholder('Tulis balasan')).not.toBeVisible()
    await expect(page.getByText('Agent masih menangani percakapan ini')).toBeVisible()
  })
})
