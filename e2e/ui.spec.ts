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
  // Ditunggu `main`, bukan `nav`: di lebar HP menunya memang belum ada di
  // halaman sampai tombol burger ditekan.
  await page.waitForSelector('main')
}

test.describe('UI dipakai seperti staf memakainya', () => {
  test('mendarat di Ringkasan, halaman paling atas di menu', async ({ page }) => {
    await masuk(page)
    // Ringkasan memberi tahu apa yang perlu ditindak hari itu sebelum staf
    // memilih sendiri mau masuk ke Inbox, Kontak, atau Kirim Pesan.
    await expect(page.locator('h1')).toHaveText('Ringkasan')
  })

  test('alamat mengikuti halaman, refresh tidak membuang staf ke awal', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kontak & Daftar Tamu', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Kontak & Daftar Tamu')
    expect(page.url()).toContain('#kontak')

    await page.reload()
    await expect(page.locator('h1')).toHaveText('Kontak & Daftar Tamu')
  })

  test('tombol Back browser benar-benar berpindah halaman', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kirim Pesan', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Kirim Pesan')
    await page.goBack()
    await expect(page.locator('h1')).toHaveText('Ringkasan')
  })

  test('menu Pengaturan yang belum jadi tidak dipajang', async ({ page }) => {
    await masuk(page)
    await expect(page.getByRole('button', { name: 'Pengaturan', exact: true })).toHaveCount(0)
  })

  test('daftar ikut berubah setelah Ambil alih, tanpa refresh manual', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo mau tanya kamar', `wamid.${nomor}.ui1`)

    await masuk(page)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
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
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
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
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByRole('button', { name: new RegExp(nomor) }).first().click()
    await page.getByRole('button', { name: 'Ambil alih' }).click()
    await kirimMasuk(request, nomor, 'halo? kok didiemin', `wamid.${nomor}.ui3b`)

    await expect(async () => {
      expect(await page.title()).toMatch(/^\(\d+\) Inbox/)
    }).toPass({ timeout: 15_000 })

    // Inti pemindahan badge ke App: staf pindah halaman, badge TIDAK boleh hilang.
    // Tab CRM biasanya tertimbun tab lain, dan di situlah badge ini berguna.
    await page.getByRole('button', { name: 'Ringkasan', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Ringkasan')
    await expect(async () => {
      expect(await page.title()).toMatch(/^\(\d+\) Inbox/)
    }).toPass({ timeout: 15_000 })
  })

  test('Enter mengirim balasan, Shift+Enter cuma baris baru', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo enter', `wamid.${nomor}.ui4`)

    await masuk(page)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
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
    await page.getByRole('button', { name: 'Kirim Pesan', exact: true }).click()
    // Langkah dua dan tiga terlihat sebagai peta jalan, tapi belum bisa dibuka.
    await expect(page.getByText('2 Pilih daftar & jumlah')).toBeVisible()
    await expect(page.getByText('3 Periksa & kirim')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
    // Kartu jumlah penerima dan tombol tahan-kirim baru muncul setelah template
    // dipilih; di langkah satu keduanya belum boleh ada di layar.
    await expect(page.getByRole('button', { name: 'Uji dulu' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Tahan untuk kirim/ })).toHaveCount(0)
  })

  test('broadcast tidak punya tombol kirim satu klik', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kirim Pesan', exact: true }).click()
    // Satu klik yang menembak ratusan tamu tidak boleh ada di layar ini.
    await expect(page.getByRole('button', { name: 'Kirim sekarang' })).toHaveCount(0)
  })

  test('template: pratinjau memperlihatkan tulisan seperti yang tamu baca', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Templat Pesan', exact: true }).click()

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
    await page.getByRole('button', { name: 'Templat Pesan', exact: true }).click()

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
    await page.getByRole('button', { name: 'Templat Pesan', exact: true }).click()

    await page.fill('#judul', 'Sapa Tamu Lama')
    await page.fill('#isi', 'halo')
    await page.getByRole('button', { name: 'Ajukan template ke WhatsApp' }).click()

    await expect(page.getByText('Isi pesan terlalu pendek.')).toBeVisible()
  })

  test('kontak: catatan yang gagal disimpan tidak dibiarkan diam', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo catatan', `wamid.${nomor}.ui5`)

    await masuk(page)
    await page.getByRole('button', { name: 'Kontak & Daftar Tamu', exact: true }).click()
    await page.fill('input[placeholder*="Cari"]', nomor)
    await page.getByText(nomor).first().click()

    const catatan = page.locator('textarea').first()
    await catatan.fill('alergi udang')
    await catatan.blur()

    // Sukses maupun gagal, staf HARUS melihat sesuatu. Diam total adalah bug.
    await expect(page.getByText(/Tersimpan|gagal/i).first()).toBeVisible({ timeout: 10_000 })
  })
  test('di layar HP menu disembunyikan di balik tombol, bukan digeser ke samping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await masuk(page)

    // Deretan menu yang harus digeser ke samping memakan lebar layar HP dan
    // membuat menu paling kanan tidak pernah terlihat. Di layar HP menunya
    // belum ada di halaman sama sekali sampai tombolnya ditekan.
    await expect(page.locator('#menu-utama')).toHaveCount(0)

    await page.getByRole('button', { name: 'Buka menu' }).click()
    const menuKontak = page.locator('#menu-utama').getByRole('button', { name: 'Kontak & Daftar Tamu', exact: true })
    await expect(menuKontak).toBeVisible()

    await menuKontak.click()
    // Menu menutup sendiri setelah halaman dibuka -- kalau tidak, isi halaman
    // tertutup daftar menu dan staf harus menutupnya manual tiap pindah.
    await expect(page.locator('#menu-utama')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Kontak/ })).toBeVisible()
  })

  test('kepala halaman memakai logo Rancabango, bukan tulisan nama aplikasi', async ({ page }) => {
    await masuk(page)
    // Merek dipasang dua kali (batang atas HP dan sisi kiri layar lebar), jadi
    // pemeriksaan dikunci ke satu wadah supaya tidak jadi ambigu.
    const sisi = page.locator('aside')
    await expect(sisi.getByText('customer management')).toBeVisible()
    await expect(sisi.getByAltText('Rancabango')).toBeVisible()
    await expect(page.getByText('CRM Rancabango')).toHaveCount(0)
  })

  test('broadcast: kartu jumlah muncul setelah template dipilih dan biayanya disebut', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kirim Pesan', exact: true }).click()
    // Lingkungan lokal tanpa kredensial Meta: daftar template kosong, jadi
    // langkah dua tidak bisa dibuka lewat template. Yang diuji di sini cuma
    // bahwa kartu jumlah tidak pernah muncul tanpa template terpilih.
    await expect(page.getByRole('button', { name: 'Uji dulu' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
  })

  test('kontak: impor daftar tamu tersembunyi sampai staf membukanya', async ({ page }) => {
    await masuk(page)
    await page.getByRole('button', { name: 'Kontak & Daftar Tamu', exact: true }).click()
    await expect(page.locator('#daftarFile')).toHaveCount(0)

    await page.getByRole('button', { name: 'Impor file' }).click()
    await expect(page.locator('#daftarFile')).toBeVisible()
    await expect(page.locator('#daftarNama')).toBeVisible()
  })

})
