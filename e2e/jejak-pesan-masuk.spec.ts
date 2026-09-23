import { test, expect, type APIRequestContext } from '@playwright/test'

// Regresi buat bug "dua jalur INSERT ke tabel kontak beda kontrak kolom":
// impor daftar tamu (POST /api/daftar aksi selesai) dan pesan-masuk webhook
// (POST /api/pesan-masuk) sama-sama bikin baris `kontak`, tapi salah satu
// jalur tidak mengisi kolom yang dibutuhkan jalur lain (mis. terakhir_pesan_masuk
// atau terakhir_pesan_pada). Sebelum fix di pesan.ts, dua test di bawah ini
// merah -- itu buktinya test ini benar-benar menangkap bug-nya. Jangan pernah
// diakali supaya hijau tanpa fix di kode produksi.

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899000${acak}`
}

function namaDaftarAcak(): string {
  return `daftar-e2e-jejak-${Math.random().toString(36).slice(2, 8)}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', { data: { email: STAF_EMAIL, password: STAF_PASSWORD } })
  expect(res.ok()).toBeTruthy()
}

async function kirimPesanMasuk(request: APIRequestContext, nomor: string, teks: string, waktu?: string) {
  return request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, teks, wamid: `wamid.${nomor}.${Math.random().toString(36).slice(2)}`, ...(waktu ? { waktu } : {}) },
  })
}

test.describe('jejak pesan masuk: dua jalur INSERT ke kontak', () => {
  test('kontak dari unggahan daftar lalu chat: jejak pesan masuk terisi dan balasan staf lolos gerbang jendela', async ({
    request,
  }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()

    // Jalur 1: kontak lahir dari impor daftar tamu.
    const mulai = await request.post('/api/daftar', { data: { aksi: 'mulai', nama: namaDaftarAcak() } })
    expect(mulai.status()).toBe(201)
    const { id } = (await mulai.json()) as { id: string }

    const tambah = await request.post('/api/daftar', {
      data: { aksi: 'tambah', id, nomor: [{ nomor, nama: 'Tamu Impor' }] },
    })
    expect(tambah.ok()).toBeTruthy()

    const selesai = await request.post('/api/daftar', { data: { aksi: 'selesai', id } })
    expect(selesai.ok()).toBeTruthy()

    // Jalur 2: kontak yang sama lalu kirim pesan lewat webhook.
    const masuk = await kirimPesanMasuk(request, nomor, 'halo dari tamu impor')
    expect(masuk.status()).toBe(200)
    expect((await masuk.json()).status_agent).toBe('aktif')

    // Kontrak kolom kontak harus konsisten lepas dari jalur INSERT mana pun.
    const kontak = await request.get(`/api/kontak?cari=${nomor}`)
    expect(kontak.status()).toBe(200)
    const kontakBody = (await kontak.json()) as { kontak: { nomor: string; terakhir_pesan_masuk: string | null; dalam_jendela: boolean }[] }
    const kontakItem = kontakBody.kontak.find((k) => k.nomor === nomor)
    expect(kontakItem).toBeTruthy()
    expect(kontakItem?.terakhir_pesan_masuk).not.toBeNull()
    expect(kontakItem?.dalam_jendela).toBe(true)

    const percakapan = await request.get(`/api/percakapan?cari=${nomor}`)
    expect(percakapan.status()).toBe(200)
    const percakapanBody = (await percakapan.json()) as { percakapan: { nomor: string; dalam_jendela: boolean }[] }
    const percakapanItem = percakapanBody.percakapan.find((p) => p.nomor === nomor)
    expect(percakapanItem).toBeTruthy()
    expect(percakapanItem?.dalam_jendela).toBe(true)

    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(ambil.status()).toBe(200)

    const balas = await request.post(`/api/percakapan/${nomor}/balas`, { data: { teks: 'uji balas' } })
    expect(balas.status()).not.toBe(409)
    expect(balas.status()).toBe(502)
    expect((await balas.json()).pesan).toBe('meta_belum_dikonfigurasi')
  })

  test('ambil-alih sebelum ada chat lalu pesan masuk: terakhir_pesan_pada terisi', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()

    // Kontak belum pernah chat sama sekali saat diambil-alih.
    const ambil = await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    expect(ambil.status()).toBe(200)

    const detikEpoch = Math.floor(Date.now() / 1000) - 3600 // 1 jam lalu, timestamp deterministik
    const masuk = await kirimPesanMasuk(request, nomor, 'halo', String(detikEpoch))
    expect(masuk.status()).toBe(200)

    const percakapan = await request.get(`/api/percakapan?cari=${nomor}`)
    expect(percakapan.status()).toBe(200)
    const percakapanBody = (await percakapan.json()) as { percakapan: { nomor: string; terakhir_pesan_pada: string | null }[] }
    const percakapanItem = percakapanBody.percakapan.find((p) => p.nomor === nomor)
    expect(percakapanItem).toBeTruthy()
    expect(percakapanItem?.terakhir_pesan_pada).not.toBeNull()
    const detikTersimpan = Math.floor(new Date(percakapanItem!.terakhir_pesan_pada!).getTime() / 1000)
    expect(detikTersimpan).toBe(detikEpoch)
  })
})
