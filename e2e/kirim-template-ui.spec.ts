import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

// Fase 5: cek tampilan Inbox saat jendela 24 jam tutup DAN lingkungan lokal
// tanpa kredensial Meta (/api/template balas meta_belum_dikonfigurasi -> daftar
// kosong di UI). Bukti bahwa kotak balas bebas tidak pernah muncul di kondisi
// ini, dan staf diarahkan ke jalur template (kosong) alih-alih diam total.

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899600${acak}`
}

// 8 hari lalu (epoch detik) -- jendela 24 jam pasti tutup.
const DETIK_LAMA = String(Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60)

async function siapkanDiambilAlihJendelaTutup(request: APIRequestContext, nomor: string): Promise<void> {
  const masuk = await request.post('http://127.0.0.1:8788/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama: `Tamu ${nomor}`, teks: 'halo lama', wamid: `wamid.${nomor}.ui-tpl`, waktu: DETIK_LAMA },
  })
  expect(masuk.status()).toBe(200)

  const login = await request.post('http://127.0.0.1:8788/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(login.ok()).toBeTruthy()

  const ambil = await request.post(`http://127.0.0.1:8788/api/percakapan/${nomor}/ambil-alih`)
  expect(ambil.status()).toBe(200)
}

async function masuk(page: Page) {
  await page.goto('/')
  await page.fill('#email', STAF_EMAIL)
  await page.fill('#sandi', STAF_PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForSelector('main')
}

test.describe('Inbox: jendela 24 jam tutup, jalur kirim template', () => {
  test('tanpa kredensial Meta: template kosong ditampilkan, tombol kirim & kotak balas bebas tidak ada', async ({
    page,
    request,
  }) => {
    const nomor = nomorUjiAcak()
    await siapkanDiambilAlihJendelaTutup(request, nomor)

    await masuk(page)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()

    await expect(page.getByText('Jendela 24 jam tutup').first()).toBeVisible()
    await expect(page.getByTestId('template-kosong')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('tombol-kirim-template')).toHaveCount(0)
    await expect(page.getByPlaceholder('Tulis balasan')).toHaveCount(0)
  })
})
