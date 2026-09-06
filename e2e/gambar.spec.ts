import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899600${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

async function segmenSiap(request: APIRequestContext): Promise<number> {
  const nomor = nomorUjiAcak()
  await request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama: 'Tamu Gambar', teks: 'halo', wamid: `wamid.${nomor}.g` },
  })
  const tag = await request.post('/api/tag', { data: { nama: `zz-uji-gbr-${Date.now()}` } })
  const tagId = (await tag.json()).id as number
  await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })
  return tagId
}

test.describe('gambar broadcast', () => {
  test('URL gambar http biasa ditolak sebelum campaign dibuat', async ({ request }) => {
    await loginStaf(request)
    const tagId = await segmenSiap(request)

    const sebelum = ((await (await request.get('/api/campaign')).json()).campaign as unknown[]).length

    const res = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId], gambar_url: 'http://contoh.test/a.jpg' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('gambar_url_wajib_https')

    // Ditolak sebelum baris campaign lahir — kalau tidak, indeks unik parsial
    // mengunci sistem oleh baris hantu.
    const sesudah = ((await (await request.get('/api/campaign')).json()).campaign as unknown[]).length
    expect(sesudah).toBe(sebelum)
  })

  test('URL gambar ngawur ditolak', async ({ request }) => {
    await loginStaf(request)
    const tagId = await segmenSiap(request)
    const res = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId], gambar_url: 'bukan-url' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('gambar_url_tidak_valid')
  })

  test('broadcast tanpa gambar tetap boleh, gambar sifatnya opsional', async ({ request }) => {
    await loginStaf(request)
    const tagId = await segmenSiap(request)
    const res = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId] },
    })
    // Lokal tanpa n8n: berhenti di 502, bukan ditolak validasi gambar.
    expect(res.status()).toBe(502)
    expect((await res.json()).error).toBe('n8n_belum_dikonfigurasi')
  })

  test('gambar https tersimpan di baris campaign dan ikut ke riwayat', async ({ request }) => {
    await loginStaf(request)
    const tagId = await segmenSiap(request)
    await request.post('/api/campaign', {
      data: {
        template: 'hello_world',
        tag_ids: [tagId],
        gambar_url: 'https://contoh.test/promo.jpg',
      },
    })

    const daftar = (await (await request.get('/api/campaign')).json()).campaign as {
      gambar_url: string | null
    }[]
    expect(daftar[0].gambar_url).toBe('https://contoh.test/promo.jpg')
  })

  test('template ber-gambar ditandai supaya broadcast bisa mewajibkan gambarnya', async ({
    request,
  }) => {
    await loginStaf(request)
    const res = await request.get('/api/template')
    const body = await res.json()
    // Lokal tanpa kredensial Meta: daftarnya kosong, tapi kontraknya tetap ada.
    expect(body.meta_belum_dikonfigurasi).toBe(true)
    expect(Array.isArray(body.template)).toBe(true)
  })

  test('pengajuan template dengan gambar http biasa ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        nama: 'promo_gambar',
        bahasa: 'id',
        kategori: 'MARKETING',
        isi: 'halo',
        gambar_url: 'http://contoh.test/a.jpg',
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('gambar_url_wajib_https')
  })
})
