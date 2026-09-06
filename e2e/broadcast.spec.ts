import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899100${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

/** Buat kontak lewat relay, lalu pasang tag baru padanya. Kembalikan id tag. */
async function kontakBertag(request: APIRequestContext, nomor: string, namaTag: string): Promise<number> {
  const relay = await request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama: 'Tamu BC', teks: 'halo bc', wamid: `wamid.${nomor}.bc` },
  })
  expect(relay.status()).toBe(200)

  const buatTag = await request.post('/api/tag', { data: { nama: namaTag } })
  expect(buatTag.status()).toBe(201)
  const tagId = (await buatTag.json()).id as number

  const pasang = await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })
  expect(pasang.ok()).toBeTruthy()
  return tagId
}

test.describe('segmen & kuota broadcast', () => {
  test('hitung segmen ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/segmen/hitung')
    expect(res.status()).toBe(401)
  })

  test('kontak bertag ikut terhitung di segmennya', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const tagId = await kontakBertag(request, nomor, `bc-ikut-${Date.now()}`)

    const res = await request.get(`/api/segmen/hitung?tag=${tagId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.total_cocok).toBe(1)
    expect(body.akan_dikirim).toBe(1)
    expect(body.sisa_kuota).toBeLessThanOrEqual(250)
  })

  test('kontak opt-out dibuang dari segmen, bukan sekadar ditandai', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const tagId = await kontakBertag(request, nomor, `bc-optout-${Date.now()}`)

    const patch = await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    expect(patch.ok()).toBeTruthy()

    const res = await request.get(`/api/segmen/hitung?tag=${tagId}`)
    const body = await res.json()
    expect(body.total_cocok).toBe(1)
    expect(body.dibuang_opt_out).toBe(1)
    expect(body.akan_dikirim).toBe(0)
  })

  test('maks memotong jumlah penerima', async ({ request }) => {
    await loginStaf(request)
    const namaTag = `bc-maks-${Date.now()}`
    const tagId = await kontakBertag(request, nomorUjiAcak(), namaTag)

    const nomorKedua = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor: nomorKedua, nama: 'Tamu BC 2', teks: 'halo', wamid: `wamid.${nomorKedua}.bc` },
    })
    await request.post(`/api/kontak/${nomorKedua}/tag`, { data: { tag_id: tagId } })

    const semua = await (await request.get(`/api/segmen/hitung?tag=${tagId}`)).json()
    expect(semua.akan_dikirim).toBe(2)

    const dipotong = await (await request.get(`/api/segmen/hitung?tag=${tagId}&maks=1`)).json()
    expect(dipotong.total_cocok).toBe(2)
    expect(dipotong.akan_dikirim).toBe(1)
  })

  test('segmen tanpa penerima layak ditolak sebelum baris campaign dibuat', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const tagId = await kontakBertag(request, nomor, `bc-kosong-${Date.now()}`)
    await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })

    const sebelum = ((await (await request.get('/api/campaign')).json()).campaign as unknown[]).length

    const res = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId] },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('target_kosong')

    const sesudah = ((await (await request.get('/api/campaign')).json()).campaign as unknown[]).length
    expect(sesudah).toBe(sebelum)
  })

  test('template wajib diisi', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/campaign', { data: { tag_ids: [] } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('template_wajib')
  })

  test('n8n absen: campaign gagal dilepas, tidak mengunci campaign berikutnya', async ({ request }) => {
    await loginStaf(request)
    const tagId = await kontakBertag(request, nomorUjiAcak(), `bc-lepas-${Date.now()}`)

    const pertama = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId] },
    })
    // Lokal sengaja tanpa kredensial n8n -- inilah keadaan yang diuji.
    expect(pertama.status()).toBe(502)
    expect((await pertama.json()).error).toBe('n8n_belum_dikonfigurasi')

    // Kalau baris hantu tetap aktif=1, indeks unik parsial mengunci SELURUH sistem.
    const kedua = await request.post('/api/campaign', {
      data: { template: 'hello_world', tag_ids: [tagId] },
    })
    expect(kedua.status()).not.toBe(409)

    const daftar = (await (await request.get('/api/campaign')).json()).campaign as {
      status: string
      aktif: number | null
    }[]
    expect(daftar.filter((c) => c.aktif === 1)).toHaveLength(0)
    expect(daftar[0].status).toBe('gagal')
  })

  test('hentikan campaign bersifat idempoten', async ({ request }) => {
    await loginStaf(request)
    const satu = await request.delete('/api/campaign')
    expect(satu.status()).toBe(200)
    const dua = await request.delete('/api/campaign')
    expect(dua.status()).toBe(200)
  })

  test('daftar campaign ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/campaign')
    expect(res.status()).toBe(401)
  })
})
