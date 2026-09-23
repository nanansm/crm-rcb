import { test, expect, type APIRequestContext } from '@playwright/test'

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

test.describe('GET /api/status-agent', () => {
  test('nomor belum pernah punya baris percakapan: aktif, opt_out false', async ({ request }) => {
    const nomor = nomorUjiAcak()
    const res = await request.get(`/api/status-agent?nomor=${nomor}`, {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ status_agent: 'aktif', opt_out: false })
  })

  test('nomor sudah diambil-alih staf: status_agent diambil_alih', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()

    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(ambil.status()).toBe(200)

    const res = await request.get(`/api/status-agent?nomor=${nomor}`, {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
    })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { status_agent: string; opt_out: boolean }
    expect(body.status_agent).toBe('diambil_alih')
  })

  test('tanpa X-Relay-Secret atau secret salah: 401', async ({ request }) => {
    const nomor = nomorUjiAcak()

    const tanpaHeader = await request.get(`/api/status-agent?nomor=${nomor}`)
    expect(tanpaHeader.status()).toBe(401)

    const secretSalah = await request.get(`/api/status-agent?nomor=${nomor}`, {
      headers: { 'X-Relay-Secret': 'salah-banget' },
    })
    expect(secretSalah.status()).toBe(401)
  })

  test('tanpa query param nomor: 400', async ({ request }) => {
    const res = await request.get('/api/status-agent', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
    })
    expect(res.status()).toBe(400)
  })
})
