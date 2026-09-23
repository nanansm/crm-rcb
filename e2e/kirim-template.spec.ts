import { test, expect, type APIRequestContext } from '@playwright/test'

// Fase 3: kirim template WhatsApp di Inbox. Beda dari balas.ts -- kirim-template.ts
// SENGAJA tidak punya gerbang jendela 24 jam (template sah dikirim kapan pun menurut
// kebijakan WhatsApp). Test ini membuktikan urutan gerbang: 401 -> nomor_kosong ->
// body_tidak_valid -> template_tidak_valid -> tidak_ditemukan -> opt_out ->
// belum_diambil_alih -> (tanpa cek jendela) -> gagal_kirim krn kredensial Meta kosong.

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
  const res = await request.post('/api/login', { data: { email: STAF_EMAIL, password: STAF_PASSWORD } })
  expect(res.ok()).toBeTruthy()
}

async function kirimPesanMasuk(request: APIRequestContext, nomor: string, teks: string, waktu?: string) {
  return request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, teks, wamid: `wamid.${nomor}.${Math.random().toString(36).slice(2)}`, ...(waktu ? { waktu } : {}) },
  })
}

// Siapkan kontak yang sudah kirim pesan masuk lalu diambil alih staf, jadi
// gerbang opt_out/belum_diambil_alih di kirim-template.ts lolos.
async function siapkanDiambilAlih(request: APIRequestContext, nomor: string, waktuMasuk?: string): Promise<void> {
  const masuk = await kirimPesanMasuk(request, nomor, 'halo', waktuMasuk)
  expect(masuk.status()).toBe(200)
  const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
  expect(ambil.status()).toBe(200)
}

// 8 hari lalu (epoch detik, format sama seperti kirimPesanMasuk pakai `waktu`) --
// jendela 24 jam pasti tutup.
const DETIK_LAMA = String(Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60)

test.describe('POST /api/percakapan/:nomor/kirim-template', () => {
  test('tanpa login: 401', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(401)
  })

  test('body bukan JSON valid: 400 body_tidak_valid', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('bukan-json'),
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('body_tidak_valid')
  })

  test('template tidak valid: 400 template_tidak_valid', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()

    const kosong = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: '' } })
    expect(kosong.status()).toBe(400)
    expect((await kosong.json()).error).toBe('template_tidak_valid')

    const hurufBesar = await request.post(`/api/percakapan/${nomor}/kirim-template`, {
      data: { template: 'Promo Uji' },
    })
    expect(hurufBesar.status()).toBe(400)
    expect((await hurufBesar.json()).error).toBe('template_tidak_valid')

    const tanpaField = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: {} })
    expect(tanpaField.status()).toBe(400)
    expect((await tanpaField.json()).error).toBe('template_tidak_valid')
  })

  test('nomor tanpa baris kontak sama sekali: 404 tidak_ditemukan', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('tidak_ditemukan')
  })

  test('belum diambil alih: 409 belum_diambil_alih', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const masuk = await kirimPesanMasuk(request, nomor, 'halo')
    expect(masuk.status()).toBe(200)

    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toBe('belum_diambil_alih')
  })

  test('kontak opt_out: 409 opt_out', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await siapkanDiambilAlih(request, nomor)

    const patch = await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    expect(patch.ok()).toBeTruthy()

    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toBe('opt_out')
  })

  test('jendela 24 jam tutup: kirim-template tetap dicoba (bukan gerbang jendela), gagal_kirim krn Meta belum dikonfigurasi, tidak nambah pesan/geser jendela', async ({
    request,
  }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await siapkanDiambilAlih(request, nomor, DETIK_LAMA)

    const list = await request.get(`/api/percakapan?cari=${nomor}`)
    expect(list.ok()).toBeTruthy()
    const daftarSebelum = (await list.json()).percakapan
    const itemSebelum = daftarSebelum.find((p: { nomor: string }) => p.nomor === nomor)
    expect(itemSebelum.dalam_jendela).toBe(false)

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'halo' } })
    expect(balas.status()).toBe(409)

    const detailSebelum = await request.get(`/api/percakapan/${nomor}`)
    expect(detailSebelum.ok()).toBeTruthy()
    const jumlahPesanSebelum = (await detailSebelum.json()).pesan.length

    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('gagal_kirim')
    expect(body.pesan).toBe('meta_belum_dikonfigurasi')

    const detailSesudah = await request.get(`/api/percakapan/${nomor}`)
    expect(detailSesudah.ok()).toBeTruthy()
    const dataSesudah = await detailSesudah.json()
    expect(dataSesudah.pesan.length).toBe(jumlahPesanSebelum)
    expect(dataSesudah.dalam_jendela).toBe(false)
  })

  test('jendela 24 jam masih buka: bukan 409, langsung coba kirim dan gagal_kirim krn Meta belum dikonfigurasi', async ({
    request,
  }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await siapkanDiambilAlih(request, nomor)

    const res = await request.post(`/api/percakapan/${nomor}/kirim-template`, { data: { template: 'promo_uji' } })
    expect(res.status()).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('gagal_kirim')
    expect(body.pesan).toBe('meta_belum_dikonfigurasi')
  })
})
