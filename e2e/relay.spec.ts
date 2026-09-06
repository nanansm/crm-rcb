import { test, expect, type APIRequestContext } from '@playwright/test'

// Uji stack LOKAL saja (lihat playwright.config.ts: baseURL 127.0.0.1:8788,
// dijalankan lewat `npm run dev:cf` dengan D1/KV lokal).
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

test.describe('relay pesan-masuk & balasan-agent', () => {
  test('pesan masuk dengan header rahasia benar tersimpan dan agent aktif', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Uji', teks: 'halo', wamid: `wamid.${nomor}.1` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status_agent).toBe('aktif')
    expect(body.opt_out).toBe(false)
    expect(body.pesan_baru).toBe(true)
  })

  test('kirim ulang wamid sama bersifat idempoten, tidak tersimpan dobel', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const wamid = `wamid.${nomor}.1`
    const payload = { nomor, nama: 'Tamu Idem', teks: 'halo idem', wamid }

    const pertama = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: payload,
    })
    expect(pertama.status()).toBe(200)
    expect((await pertama.json()).pesan_baru).toBe(true)

    const kedua = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: payload,
    })
    expect(kedua.status()).toBe(200)
    expect((await kedua.json()).pesan_baru).toBe(false)

    await loginStaf(request)
    const detail = await request.get(`/api/percakapan/${nomor}`)
    expect(detail.status()).toBe(200)
    const detailBody = await detail.json()
    const cocok = detailBody.pesan.filter((p: { wamid: string | null; teks: string | null }) => p.teks === 'halo idem')
    expect(cocok).toHaveLength(1)
  })

  test('header rahasia salah ditolak 401', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': 'salah-sekali' },
      data: { nomor, teks: 'halo' },
    })
    expect(res.status()).toBe(401)
  })

  test('body tanpa nomor ditolak 400', async ({ request }) => {
    const res = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { teks: 'halo tanpa nomor' },
    })
    expect(res.status()).toBe(400)
  })

  test('waktu epoch dari Meta dipakai apa adanya, bukan jam server', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const detikEpoch = Math.floor(Date.now() / 1000) - 3600 // 1 jam lalu, beda jelas dari "sekarang"
    const res = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'halo waktu', wamid: `wamid.${nomor}.waktu`, waktu: String(detikEpoch) },
    })
    expect(res.status()).toBe(200)

    await loginStaf(request)
    const detail = await request.get(`/api/percakapan/${nomor}`)
    expect(detail.status()).toBe(200)
    const detailBody = await detail.json()
    const pesan = detailBody.pesan.find((p: { teks: string | null }) => p.teks === 'halo waktu')
    expect(pesan).toBeTruthy()
    const detikTersimpan = Math.floor(new Date(pesan.waktu).getTime() / 1000)
    expect(detikTersimpan).toBe(detikEpoch)
  })

  test('waktu berisi nilai sampah tetap 200 dan tidak melempar galat', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'halo sampah', wamid: `wamid.${nomor}.sampah`, waktu: 'bukan-angka' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status_agent).toBe('aktif')
  })

  test('balasan agent tersimpan sesudah pesan tamu dengan arah dan pengirim benar', async ({ request }) => {
    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'halo dari tamu', wamid: `wamid.${nomor}.tamu` },
    })

    const balasan = await request.post('/api/balasan-agent', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'balasan dari agent', wamid: `wamid.${nomor}.agent` },
    })
    expect(balasan.status()).toBe(200)
    expect((await balasan.json()).ok).toBe(true)

    await loginStaf(request)
    const detail = await request.get(`/api/percakapan/${nomor}`)
    expect(detail.status()).toBe(200)
    const detailBody = await detail.json()
    const pesanKeluar = detailBody.pesan.find((p: { teks: string | null }) => p.teks === 'balasan dari agent')
    expect(pesanKeluar).toBeTruthy()
    expect(pesanKeluar.arah).toBe('keluar')
    expect(pesanKeluar.pengirim).toBe('agent')

    const idxTamu = detailBody.pesan.findIndex((p: { teks: string | null }) => p.teks === 'halo dari tamu')
    const idxAgent = detailBody.pesan.findIndex((p: { teks: string | null }) => p.teks === 'balasan dari agent')
    expect(idxAgent).toBeGreaterThan(idxTamu)
  })

  test('daftar percakapan butuh sesi staf dan memuat nomor uji dengan cuplikan', async ({ request }) => {
    const tanpaSesi = await request.get('/api/percakapan')
    expect(tanpaSesi.status()).toBe(401)

    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'cuplikan uji daftar', wamid: `wamid.${nomor}.daftar` },
    })

    await loginStaf(request)
    const denganSesi = await request.get(`/api/percakapan?cari=${nomor}`)
    expect(denganSesi.status()).toBe(200)
    const body = await denganSesi.json()
    const baris = body.percakapan.find((p: { nomor: string }) => p.nomor === nomor)
    expect(baris).toBeTruthy()
    expect(baris.cuplikan).toBe('cuplikan uji daftar')
  })

  test('detail percakapan nomor yang belum pernah chat mengembalikan 404', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const res = await request.get(`/api/percakapan/${nomor}`)
    expect(res.status()).toBe(404)
  })

  test('Inbox: cari nomor uji, klik baris, pesan tamu dan balasan agent tampil', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'halo lewat UI', wamid: `wamid.${nomor}.ui-tamu` },
    })
    await request.post('/api/balasan-agent', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, teks: 'balasan lewat UI', wamid: `wamid.${nomor}.ui-agent` },
    })

    await page.goto('/')
    await page.getByLabel('Email').fill(STAF_EMAIL)
    await page.getByLabel('Kata sandi').fill(STAF_PASSWORD)
    await page.getByRole('button', { name: 'Masuk' }).click()

    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByPlaceholder('Cari nomor atau nama').fill(nomor)
    const baris = page.getByRole('button', { name: new RegExp(nomor) })
    await baris.click()

    // Dibatasi ke jendela chat: teks yang sama juga muncul sebagai cuplikan di
    // daftar percakapan, jadi pencarian global akan cocok dua kali.
    const jendela = page.getByTestId('jendela-chat')
    await expect(jendela.getByText('halo lewat UI')).toBeVisible()
    await expect(jendela.getByText('balasan lewat UI')).toBeVisible()
  })
})
