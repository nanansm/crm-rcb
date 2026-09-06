import { test, expect, type APIRequestContext } from '@playwright/test'

// Uji stack LOKAL saja (lihat playwright.config.ts: baseURL 127.0.0.1:8788,
// dijalankan lewat `npm run dev:cf` dengan D1/KV lokal).
const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899000${acak}`
}

function namaTagAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `tag-e2e-${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

async function buatKontak(request: APIRequestContext, nomor: string, nama?: string): Promise<void> {
  const res = await request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama, teks: 'halo uji kontak', wamid: `wamid.${nomor}.kontak` },
  })
  expect(res.status()).toBe(200)
}

async function buatTag(request: APIRequestContext, nama: string): Promise<number> {
  const res = await request.post('/api/tag', { data: { nama } })
  expect(res.status()).toBe(201)
  const body = await res.json()
  return body.id
}

test.describe('kontak & segmen (tag)', () => {
  test('buat tag baru berhasil', async ({ request }) => {
    await loginStaf(request)
    const nama = namaTagAcak()
    const res = await request.post('/api/tag', { data: { nama } })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.nama).toBe(nama)
  })

  test('buat tag dengan nama yang sama ditolak 409', async ({ request }) => {
    await loginStaf(request)
    const nama = namaTagAcak()
    await buatTag(request, nama)

    const kedua = await request.post('/api/tag', { data: { nama } })
    expect(kedua.status()).toBe(409)
    const body = await kedua.json()
    expect(body.error).toBe('nama_sudah_ada')
  })

  test('warna tag bukan format heks ditolak 400', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/tag', {
      data: { nama: namaTagAcak(), warna: 'bukan-heks' },
    })
    expect(res.status()).toBe(400)
  })

  test('pasang tag dua kali ke kontak bersifat idempoten', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await buatKontak(request, nomor, 'Tamu Tag')
    const tagId = await buatTag(request, namaTagAcak())

    const pertama = await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })
    expect(pertama.status()).toBe(200)

    const kedua = await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })
    expect(kedua.status()).toBe(200)
    const body = await kedua.json()
    const cocok = body.tag.filter((t: { id: number }) => t.id === tagId)
    expect(cocok).toHaveLength(1)
  })

  test('saring kontak per tag hanya mengembalikan kontak yang ditandai', async ({ request }) => {
    await loginStaf(request)
    const nomorBertag = nomorUjiAcak()
    const nomorLain = nomorUjiAcak()
    await buatKontak(request, nomorBertag, 'Kontak Bertag')
    await buatKontak(request, nomorLain, 'Kontak Lain')
    const tagId = await buatTag(request, namaTagAcak())
    await request.post(`/api/kontak/${nomorBertag}/tag`, { data: { tag_id: tagId } })

    const res = await request.get(`/api/kontak?tag=${tagId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const nomorDaftar = body.kontak.map((k: { nomor: string }) => k.nomor)
    expect(nomorDaftar).toContain(nomorBertag)
    expect(nomorDaftar).not.toContain(nomorLain)
  })

  test('saring dua tag sekaligus bersifat DAN, kontak dengan satu tag saja tidak ikut', async ({ request }) => {
    await loginStaf(request)
    const nomorDua = nomorUjiAcak()
    const nomorSatu = nomorUjiAcak()
    await buatKontak(request, nomorDua, 'Kontak Dua Tag')
    await buatKontak(request, nomorSatu, 'Kontak Satu Tag')

    const tagA = await buatTag(request, namaTagAcak())
    const tagB = await buatTag(request, namaTagAcak())

    await request.post(`/api/kontak/${nomorDua}/tag`, { data: { tag_id: tagA } })
    await request.post(`/api/kontak/${nomorDua}/tag`, { data: { tag_id: tagB } })
    await request.post(`/api/kontak/${nomorSatu}/tag`, { data: { tag_id: tagA } })

    const res = await request.get(`/api/kontak?tag=${tagA}&tag=${tagB}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const nomorDaftar = body.kontak.map((k: { nomor: string }) => k.nomor)
    expect(nomorDaftar).toContain(nomorDua)
    expect(nomorDaftar).not.toContain(nomorSatu)
  })

  test('PATCH catatan saja tidak menghapus nama, PATCH nama saja tidak menghapus catatan', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await buatKontak(request, nomor, 'Nama Awal')

    const patchCatatan = await request.patch(`/api/kontak/${nomor}`, { data: { catatan: 'catatan pertama' } })
    expect(patchCatatan.status()).toBe(200)

    let detail = await (await request.get(`/api/kontak/${nomor}`)).json()
    expect(detail.nama).toBe('Nama Awal')
    expect(detail.catatan).toBe('catatan pertama')

    const patchNama = await request.patch(`/api/kontak/${nomor}`, { data: { nama: 'Nama Baru' } })
    expect(patchNama.status()).toBe(200)

    detail = await (await request.get(`/api/kontak/${nomor}`)).json()
    expect(detail.nama).toBe('Nama Baru')
    expect(detail.catatan).toBe('catatan pertama')
  })

  test('PATCH opt_out mengisi opt_out_pada, mematikannya lagi mengosongkannya', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await buatKontak(request, nomor, 'Kontak Optout')

    const nyala = await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    expect(nyala.status()).toBe(200)

    let detail = await (await request.get(`/api/kontak/${nomor}`)).json()
    expect(Number(detail.opt_out)).toBe(1)
    expect(detail.opt_out_pada).toBeTruthy()

    const mati = await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: false } })
    expect(mati.status()).toBe(200)

    detail = await (await request.get(`/api/kontak/${nomor}`)).json()
    expect(Number(detail.opt_out)).toBe(0)
    expect(detail.opt_out_pada).toBeNull()
  })

  test('lepas tag dari kontak menghapusnya dan respons memuat tag terbaru', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await buatKontak(request, nomor, 'Kontak Lepas Tag')
    const tagId = await buatTag(request, namaTagAcak())
    await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })

    const lepas = await request.delete(`/api/kontak/${nomor}/tag?tag_id=${tagId}`)
    expect(lepas.status()).toBe(200)
    const body = await lepas.json()
    expect(body.tag.some((t: { id: number }) => t.id === tagId)).toBe(false)
  })

  test('GET /api/kontak tanpa sesi staf ditolak 401', async ({ request }) => {
    const res = await request.get('/api/kontak')
    expect(res.status()).toBe(401)
  })

  test('UI: buat tag, cari kontak uji, pasang tag lewat panel detail', async ({ page, request }) => {
    const nomor = nomorUjiAcak()
    await buatKontak(request, nomor, 'Kontak UI Tag')
    const namaTag = namaTagAcak()

    await page.goto('/')
    await page.getByLabel('Email').fill(STAF_EMAIL)
    await page.getByLabel('Kata sandi').fill(STAF_PASSWORD)
    await page.getByRole('button', { name: 'Masuk' }).click()

    await page.getByRole('button', { name: 'Kontak' }).click()

    await page.getByPlaceholder('Tag baru').fill(namaTag)
    await page.getByRole('button', { name: 'Tambah tag' }).click()

    // Nama aksesibel keping = nama tag + jumlah kontaknya, tanpa spasi pemisah
    // ("tag-e2e-1 0"), karena jaraknya cuma margin CSS.
    // Daftar tag filter memampatkan diri setelah sepuluh tag: di atas ambang itu
    // muncul kolom cari, di bawahnya tombol bentang. Dua-duanya dicoba sampai
    // keping tag baru kelihatan -- daftarnya baru dimuat ulang setelah simpan.
    const keping = page.getByRole('button', { name: new RegExp(`^${namaTag}\\s*\\d+$`) })
    await expect(async () => {
      const cariTag = page.getByPlaceholder(/^Cari di \d+ tag$/)
      if (await cariTag.count()) {
        await cariTag.fill(namaTag)
      } else {
        const lagi = page.getByRole('button', { name: /^\+\d+ tag lagi$/ })
        if (await lagi.count()) await lagi.click()
      }
      await expect(keping).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    await page.getByPlaceholder('Cari nomor atau nama').fill(nomor)
    const baris = page.locator('tr', { hasText: nomor })
    await baris.click()

    await page.getByRole('button', { name: '+ Tambah tag' }).click()
    const daftar = page.getByRole('listbox')
    await expect(daftar).toBeVisible()
    // Dropdown menumbuhkan kolom cari begitu opsinya lewat tujuh -- pakai kalau ada,
    // supaya tag yang dicari tidak tertimbun puluhan tag lain.
    const cariOpsi = page.getByPlaceholder('Cari', { exact: true })
    if (await cariOpsi.count()) await cariOpsi.fill(namaTag)
    await daftar.getByRole('option', { name: namaTag, exact: true }).click()
    await expect(page.getByRole('button', { name: `Lepas tag ${namaTag}` })).toBeVisible()
  })
})
