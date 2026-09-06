import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899300${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

test.describe('template & dashboard', () => {
  test('daftar template ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/template')
    expect(res.status()).toBe(401)
  })

  test('tanpa kredensial Meta, daftar template kosong dan ditandai jelas', async ({ request }) => {
    await loginStaf(request)
    const res = await request.get('/api/template')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.meta_belum_dikonfigurasi).toBe(true)
    expect(body.template).toEqual([])
  })

  test('nama template berhuruf besar ditolak sebelum menyentuh Meta', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { nama: 'Promo Akhir Pekan', bahasa: 'id', kategori: 'MARKETING', isi: 'halo' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('nama_hanya_huruf_kecil_angka_garis_bawah')
  })

  test('tombol wa.me ditolak karena Meta selalu menolaknya', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        nama: 'promo_wa',
        bahasa: 'id',
        kategori: 'MARKETING',
        isi: 'halo',
        tombol: [{ jenis: 'URL', teks: 'Chat', url: 'https://wa.me/628112237711' }],
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('tombol_url_wa_me_ditolak_meta_pakai_balasan_cepat')
  })

  test('pengajuan template gagal jelas saat kredensial Meta belum ada', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { nama: 'promo_sah', bahasa: 'id', kategori: 'MARKETING', isi: 'halo {{1}}' },
    })
    expect(res.status()).toBe(503)
    expect((await res.json()).error).toBe('meta_belum_dikonfigurasi')
  })

  test('dashboard ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/dashboard')
    expect(res.status()).toBe(401)
  })

  test('kontak baru menaikkan angka dashboard dan masuk jendela 24 jam', async ({ request }) => {
    await loginStaf(request)
    const sebelum = await (await request.get('/api/dashboard')).json()

    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Dash', teks: 'halo dash', wamid: `wamid.${nomor}.dash` },
    })

    const sesudah = await (await request.get('/api/dashboard')).json()
    expect(sesudah.kontak.total).toBe(sebelum.kontak.total + 1)
    expect(sesudah.percakapan.dalam_jendela).toBe(sebelum.percakapan.dalam_jendela + 1)
    expect(sesudah.percakapan.masuk_24jam).toBe(sebelum.percakapan.masuk_24jam + 1)
    expect(sesudah.kontak.baru_7hari).toBe(sebelum.kontak.baru_7hari + 1)
    expect(sesudah.kuota.batas).toBe(250)
  })

  test('opt-out terhitung di dashboard', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Stop', teks: 'BERHENTI', wamid: `wamid.${nomor}.stop` },
    })

    const sebelum = await (await request.get('/api/dashboard')).json()
    await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    const sesudah = await (await request.get('/api/dashboard')).json()
    expect(sesudah.kontak.opt_out).toBe(sebelum.kontak.opt_out + 1)
  })
})
