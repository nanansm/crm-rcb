import { test, expect, type APIRequestContext } from '@playwright/test'

const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

// PNG 1x1 paling kecil yang masih sah, cukup untuk menguji jalur unggah.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', { data: { email: STAF_EMAIL, password: STAF_PASSWORD } })
  expect(res.ok()).toBeTruthy()
}

test.describe('unggah gambar promo', () => {
  test('PNG diterima dan dibalas alamat publik', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/unggah', {
      multipart: { file: { name: 'promo.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    })
    expect(res.status()).toBe(201)
    const data = (await res.json()) as { url: string; kunci: string }
    expect(data.url).toContain('https://')
    // Nama file asli tidak boleh jadi kunci: dua staf mengunggah "promo.png"
    // akan saling menimpa dan template yang sudah disetujui ikut berubah.
    expect(data.kunci).not.toContain('promo.png')
    expect(data.kunci.endsWith('.png')).toBe(true)
  })

  test('jenis file di luar JPG/PNG ditolak sebelum menyentuh penyimpanan', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/unggah', {
      multipart: { file: { name: 'promo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') } },
    })
    expect(res.status()).toBe(400)
  })

  test('permintaan tanpa file ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/unggah', { multipart: { catatan: 'tanpa file' } })
    expect(res.status()).toBe(400)
  })

  test('unggah ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.post('/api/unggah', {
      multipart: { file: { name: 'promo.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    })
    expect(res.status()).toBe(401)
  })
})
