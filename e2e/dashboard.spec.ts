import { test, expect, type APIRequestContext } from '@playwright/test'

// Lingkungan lokal sengaja tanpa kredensial Meta. Bagian dashboard yang berasal
// dari Meta (kesehatan nomor, grafik, tagihan) WAJIB gagal terang-terangan lewat
// array `gagal`, bukan diam-diam menampilkan nol -- nol yang menyesatkan lebih
// berbahaya daripada angka yang hilang.
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

/** `waktu` = detik epoch dalam bentuk string, bentuk yang dipakai Meta. */
async function kirimMasuk(request: APIRequestContext, nomor: string, teks: string, waktu?: string) {
  return request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: {
      nomor,
      teks,
      wamid: `wamid.${nomor}.${Math.random().toString(36).slice(2)}`,
      ...(waktu ? { waktu } : {}),
    },
  })
}

async function balasanAgent(request: APIRequestContext, nomor: string, teks: string) {
  return request.post('/api/balasan-agent', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, teks, wamid: `wamid.out.${nomor}.${Math.random().toString(36).slice(2)}` },
  })
}

async function ambilDashboard(request: APIRequestContext) {
  const res = await request.get('/api/dashboard')
  expect(res.status()).toBe(200)
  return res.json()
}

test.describe('dashboard', () => {
  test('bagian Meta yang gagal ditandai, bukan disamarkan jadi nol', async ({ request }) => {
    await loginStaf(request)
    const d = await ambilDashboard(request)

    expect(Array.isArray(d.gagal)).toBe(true)
    expect(d.gagal.join(' ')).toContain('meta_belum_dikonfigurasi')
    expect(d.nomor.kualitas).toBe('tidak diketahui')
    expect(d.harian).toEqual([])
    // Meta tidak menjawab, jadi tagihan WAJIB ditandai sebagai perkiraan.
    expect(d.bulan_ini.biaya_asli).toBe(false)
  })

  test('batas kuota 250 penerima unik, bukan jumlah pesan', async ({ request }) => {
    await loginStaf(request)
    const d = await ambilDashboard(request)
    expect(d.kuota.batas).toBe(250)
    expect(d.kuota.terpakai + d.kuota.sisa).toBeLessThanOrEqual(250 + d.kuota.terpakai)
    expect(d.kuota.sisa).toBe(Math.max(0, 250 - d.kuota.terpakai))
  })

  test('tamu yang diambil alih lalu mengirim pesan terhitung nunggu dibalas', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo dulu')

    const sebelum = await ambilDashboard(request)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    await kirimMasuk(request, nomor, 'halo, masih ada?')
    const sesudah = await ambilDashboard(request)

    expect(sesudah.perlu_tindakan.nunggu_dibalas).toBe(sebelum.perlu_tindakan.nunggu_dibalas + 1)
    expect(sesudah.percakapan.diambil_alih).toBe(sebelum.percakapan.diambil_alih + 1)
  })

  test('percakapan yang masih dipegang agent tidak dihitung nunggu dibalas', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()

    const sebelum = await ambilDashboard(request)
    await kirimMasuk(request, nomor, 'halo agent')
    const sesudah = await ambilDashboard(request)

    // Agent yang menjawab bukan urusan staf -- angka ini khusus percakapan yang
    // sudah diambil alih manusia dan karenanya tidak akan dijawab siapa pun.
    expect(sesudah.perlu_tindakan.nunggu_dibalas).toBe(sebelum.perlu_tindakan.nunggu_dibalas)
  })

  test('pesan keluar terakhir menutup status nunggu dibalas', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await kirimMasuk(request, nomor, 'halo')
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    await kirimMasuk(request, nomor, 'ada yang bisa bantu?')

    const menunggu = await ambilDashboard(request)
    await balasanAgent(request, nomor, 'siap, saya bantu')
    const sesudahDibalas = await ambilDashboard(request)

    expect(sesudahDibalas.perlu_tindakan.nunggu_dibalas).toBe(
      menunggu.perlu_tindakan.nunggu_dibalas - 1,
    )
  })

  test('tamu yang menunggu lebih dari 15 menit dipisahkan sendiri', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    // Pesan berwaktu lama dikirim sebagai pesan PERTAMA: `upsertKontak` memakai
    // MAX supaya jejak waktu tidak pernah mundur, jadi menyusulkan pesan lama
    // setelah pesan baru tidak akan mengubah apa pun.
    const lama = String(Math.floor((Date.now() - 40 * 60 * 1000) / 1000))
    await kirimMasuk(request, nomor, 'sudah lama nih', lama)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)

    const d = await ambilDashboard(request)
    expect(d.perlu_tindakan.nunggu_lewat_ambang).toBeGreaterThan(0)
    expect(d.perlu_tindakan.nunggu_lewat_ambang).toBeLessThanOrEqual(d.perlu_tindakan.nunggu_dibalas)
  })

  test('percakapan yang jendela 24 jamnya hampir tutup terhitung terpisah', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    const sebelum = await ambilDashboard(request)

    // 23 jam lalu: masih di dalam jendela, tapi sisa waktunya di bawah dua jam.
    // Harus jadi pesan pertama nomor ini -- jejak waktu masuk tidak bisa mundur.
    const hampirTutup = String(Math.floor((Date.now() - 23 * 60 * 60 * 1000) / 1000))
    await kirimMasuk(request, nomor, 'masih nunggu', hampirTutup)
    await request.post(`/api/percakapan/${nomor}/ambil-alih`)
    const sesudah = await ambilDashboard(request)

    expect(sesudah.perlu_tindakan.jendela_hampir_tutup).toBe(
      sebelum.perlu_tindakan.jendela_hampir_tutup + 1,
    )
  })

  test('dashboard ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/dashboard')
    expect(res.status()).toBe(401)
  })
})
