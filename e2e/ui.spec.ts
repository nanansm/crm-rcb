import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899500${acak}`
}

async function kirimMasuk(request: APIRequestContext, nomor: string, teks: string, wamid: string) {
  const res = await request.post('http://127.0.0.1:8788/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    // Nama memuat nomor lengkap supaya baris daftar mudah dikunci di tes.
    data: { nomor, nama: `Tamu ${nomor}`, teks, wamid },
  })
  expect(res.status()).toBe(200)
}

async function masuk(page: Page) {
  await page.goto('/')
  await page.fill('#email', STAF_EMAIL)
  await page.fill('#sandi', STAF_PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForSelector('nav')
}

test.describe('UI dipakai seperti staf memakainya', () => {
  test('mendarat langsung di Inbox, bukan di halaman statistik', async ({ page }) => {
    await masuk(page)
    // Staf membuka aplikasi ini untuk membalas tamu, bukan untuk melihat angka.
    await expect(page.locator('h1')).toHaveText('Inbox')
  })

  test('alamat mengikuti halaman, refresh tidak membuang staf ke awal', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kontak', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Kontak & Segmen')
    expect(page.url()).toContain('#kontak')

    await page.reload()
    await expect(page.locator('h1')).toHaveText('Kontak & Segmen')
  })

  test('tombol Back browser benar-benar berpindah halaman', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Broadcast', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Broadcast')
    await page.goBack()
    await expect(page.locator('h1')).toHaveText('Inbox')
  })

  test('menu Pengaturan yang belum jadi tidak dipajang', async ({ page }) => {
    await masuk(page)
    await expect(page.getByRole('button', { name: 'Pengaturan', exact: true })).toHaveCount(0)
  })

  test('daftar ikut berubah setelah Ambil alih, tanpa refresh manual', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo mau tanya kamar', `wamid.${nomor}.ui1`)

    await masuk(page)
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()

    await page.getByRole('button', { name: 'Ambil alih' }).click()

    // Inilah bug yang bikin staf mengira kliknya gagal lalu klik dua kali:
    // dulu daftar di kiri tidak pernah ikut berubah setelah aksi.
    await expect(page.getByRole('button', { name: 'Kembalikan ke agent' })).toBeVisible()
    await expect(page.getByText('Dipegang staf').first()).toBeVisible({ timeout: 10_000 })
  })

  test('tamu yang diambil alih lalu mengirim pesan muncul sebagai nunggu dibalas', async ({
    page,
    request,
  }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'pertanyaan pertama', `wamid.${nomor}.ui2a`)

    await masuk(page)
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()
    await page.getByRole('button', { name: 'Ambil alih' }).click()
    await expect(page.getByRole('button', { name: 'Kembalikan ke agent' })).toBeVisible()

    // Tamu menyusul bertanya lagi. Agent DIAM karena percakapan dipegang staf.
    await kirimMasuk(request, nomor, 'halo? masih ada?', `wamid.${nomor}.ui2b`)

    // Polling 8 detik harus memunculkan penanda ini tanpa staf menyentuh apa pun.
    await expect(page.getByText(/tamu nunggu dibalas/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/nunggu \d+ menit/).first()).toBeVisible()
  })

  test('judul tab memberi tahu ada yang nunggu walau tab tidak dilihat', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo', `wamid.${nomor}.ui3a`)

    await masuk(page)
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()
    await page.getByRole('button', { name: 'Ambil alih' }).click()
    await kirimMasuk(request, nomor, 'halo? kok didiemin', `wamid.${nomor}.ui3b`)

    await expect(async () => {
      expect(await page.title()).toMatch(/^\(\d+\) Inbox/)
    }).toPass({ timeout: 15_000 })
  })

  test('Enter mengirim balasan, Shift+Enter cuma baris baru', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo enter', `wamid.${nomor}.ui4`)

    await masuk(page)
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()
    await page.getByRole('button', { name: 'Ambil alih' }).click()

    const kotak = page.locator('textarea')
    await kotak.fill('baris satu')
    await kotak.press('Shift+Enter')
    await kotak.type('baris dua')
    expect(await kotak.inputValue()).toContain('\n')

    await kotak.press('Enter')
    // Lokal tanpa kredensial Meta: kirim WAJIB gagal dengan pesan yang terbaca,
    // bukan diam. Yang diuji di sini: Enter memang memicu pengiriman.
    await expect(page.getByText(/gagal|Meta|belum dikonfigurasi/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('broadcast berhenti di langkah satu sampai template dipilih', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Broadcast', exact: true }).click()
    // Langkah dua dan tiga terlihat sebagai peta jalan, tapi belum bisa dibuka.
    await expect(page.getByText('2 Pilih penerima')).toBeVisible()
    await expect(page.getByText('3 Periksa & kirim')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
    await expect(page.getByText(/Ketik jumlah penerima/)).toHaveCount(0)
  })

  test('broadcast tidak punya tombol kirim satu klik', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Broadcast', exact: true }).click()
    // Satu klik yang menembak ratusan tamu tidak boleh ada di layar ini.
    await expect(page.getByRole('button', { name: 'Kirim sekarang' })).toHaveCount(0)
  })

  test('template: pratinjau memperlihatkan tulisan seperti yang tamu baca', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Template', exact: true }).click()

    await page.fill('#isi', 'Terima kasih sudah pernah menginap di Rancabango.')
    await page.fill('#footer', 'Rancabango Hotel and Resort')

    // Pengajuan ke Meta tidak bisa ditarik kembali, jadi pratinjau wajib
    // memperlihatkan isi yang sedang diketik, bukan menunggu tombol simpan.
    // Dicari di paragraf, bukan di seluruh halaman: textarea isian memuat teks
    // yang sama persis, jadi pencarian polos akan cocok dua kali.
    const gelembung = page.getByRole('paragraph').filter({
      hasText: 'Terima kasih sudah pernah menginap di Rancabango.',
    })
    await expect(gelembung).toBeVisible()
    await expect(
      page.getByRole('paragraph').filter({ hasText: /^Rancabango Hotel and Resort$/ }),
    ).toBeVisible()
  })

  test('template: kolom link cuma muncul kalau tombolnya memang buka link', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Template', exact: true }).click()

    await expect(page.locator('#tombolUrl')).toHaveCount(0)
    await expect(page.locator('#tombolTeks')).toHaveCount(0)

    await page.getByRole('button', { name: 'Buka link website' }).click()
    await expect(page.locator('#tombolUrl')).toBeVisible()
    await expect(page.locator('#tombolTeks')).toBeVisible()

    await page.getByRole('button', { name: 'Tombol balasan cepat' }).click()
    await expect(page.locator('#tombolUrl')).toHaveCount(0)
    await expect(page.locator('#tombolTeks')).toBeVisible()
  })

  test('template: isian yang salah dihentikan sebelum menyentuh WhatsApp', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Template', exact: true }).click()

    await page.fill('#judul', 'Sapa Tamu Lama')
    await page.fill('#isi', 'halo')
    await page.getByRole('button', { name: 'Ajukan template ke WhatsApp' }).click()

    await expect(page.getByText('Isi pesan terlalu pendek.')).toBeVisible()
  })

  test('kontak: catatan yang gagal disimpan tidak dibiarkan diam', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo catatan', `wamid.${nomor}.ui5`)

    await masuk(page)
    await page.getByRole('button', { name: 'Kontak', exact: true }).click()
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByText(nomor).first().click()

    const catatan = page.locator('textarea').first()
    await catatan.fill('alergi udang')
    await catatan.blur()

    // Sukses maupun gagal, staf HARUS melihat sesuatu. Diam total adalah bug.
    await expect(page.getByText(/Tersimpan|gagal/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
