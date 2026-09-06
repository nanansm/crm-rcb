import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899400${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

async function kirimMasuk(request: APIRequestContext, nomor: string, teks: string, wamid: string) {
  const res = await request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama: 'Tamu Daftar', teks, wamid },
  })
  expect(res.status()).toBe(200)
}

type Baris = {
  nomor: string
  status_agent: string
  arah_terakhir: string | null
  menunggu_dibalas: boolean
}

async function cari(request: APIRequestContext, q: string): Promise<Baris[]> {
  const res = await request.get(`/api/percakapan?cari=${encodeURIComponent(q)}`)
  expect(res.status()).toBe(200)
  return (await res.json()).percakapan as Baris[]
}

test.describe('daftar percakapan', () => {
  test('cari nomor format 08 menemukan kontak yang tersimpan format 62', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo cari', `wamid.${nomor}.cari`)

    // Cara semua orang Indonesia mengetik nomor sendiri.
    const format08 = `0${nomor.slice(2)}`
    const hasil = await cari(request, format08)
    expect(hasil.map((b) => b.nomor)).toContain(nomor)
  })

  test('cari dengan spasi dan tanda plus tetap menemukan', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo plus', `wamid.${nomor}.plus`)

    const hasil = await cari(request, `+${nomor.slice(0, 2)} ${nomor.slice(2)}`)
    expect(hasil.map((b) => b.nomor)).toContain(nomor)
  })

  test('percakapan yang diambil alih dan pesan terakhirnya dari tamu ditandai menunggu', async ({
    request,
  }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'pertanyaan pertama', `wamid.${nomor}.1`)

    const sebelum = (await cari(request, nomor)).find((b) => b.nomor === nomor)
    // Agent masih aktif: agent yang menjawab, tidak ada manusia yang ditunggu.
    expect(sebelum?.menunggu_dibalas).toBe(false)

    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`, { method: 'POST' })
    expect(ambil.ok()).toBeTruthy()

    await kirimMasuk(request, nomor, 'halo? masih ada?', `wamid.${nomor}.2`)

    const sesudah = (await cari(request, nomor)).find((b) => b.nomor === nomor)
    expect(sesudah?.status_agent).toBe('diambil_alih')
    expect(sesudah?.arah_terakhir).toBe('masuk')
    expect(sesudah?.menunggu_dibalas).toBe(true)
  })

  test('daftar mengembalikan total untuk pagination', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo total', `wamid.${nomor}.total`)

    const res = await request.get('/api/percakapan?limit=1')
    const body = await res.json()
    expect(body.percakapan).toHaveLength(1)
    expect(body.total).toBeGreaterThan(1)
  })

  test('offset menggeser halaman, tidak mengembalikan baris yang sama', async ({ request }) => {
    await loginStaf(request)
    await kirimMasuk(request, nomorUjiAcak(), 'a', `wamid.pg.${Date.now()}.a`)
    await kirimMasuk(request, nomorUjiAcak(), 'b', `wamid.pg.${Date.now()}.b`)

    const h1 = (await (await request.get('/api/percakapan?limit=1&offset=0')).json()).percakapan as Baris[]
    const h2 = (await (await request.get('/api/percakapan?limit=1&offset=1')).json()).percakapan as Baris[]
    expect(h1[0].nomor).not.toBe(h2[0].nomor)
  })
})
