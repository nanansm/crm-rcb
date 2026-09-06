import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899300${acak}`
}

const ISI_SAH =
  'Terima kasih sudah pernah menginap di Rancabango. Semoga kabarnya baik selalu.'

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

test.describe('template & dashboard', () => {
  test('daftar template ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/template')
    expect(res.status()).toBe(401)
  })

  test('tanpa kredensial Meta, daftar template kosong dan ditandai jelas', async ({ request }) => {
    await loginStaf(request)
    const res = await request.get('/api/template')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.meta_belum_dikonfigurasi).toBe(true)
    expect(body.template).toEqual([])
  })

  test('nama template terlalu pendek ditolak sebelum menyentuh Meta', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { judul: 'ab', kategori: 'MARKETING', isi: ISI_SAH },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Nama template terlalu pendek.')
  })

  test('isi pesan di bawah 30 huruf ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { judul: 'Sapa Tamu Lama', kategori: 'MARKETING', isi: 'halo' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Isi pesan terlalu pendek.')
  })

  // Broadcast di sini tidak pernah mengirim parameter, jadi template ber-{{1}}
  // pasti gagal saat dipakai kirim. Ditutup di pintu masuk, bukan di Meta.
  test('isi pesan ber-{{ }} ditolak karena pengiriman tidak mengirim parameter', async ({
    request,
  }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { judul: 'Sapa Tamu Lama', kategori: 'MARKETING', isi: `Halo {{1}}, ${ISI_SAH}` },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('{{ }}')
  })

  test('jenis template selain MARKETING dan UTILITY ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { judul: 'Sapa Tamu Lama', kategori: 'AUTHENTICATION', isi: ISI_SAH },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Jenis template tidak dikenali.')
  })

  test('tombol wa.me ditolak karena Meta selalu menolaknya', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        judul: 'Sapa Tamu Lama',
        kategori: 'MARKETING',
        isi: ISI_SAH,
        tombol: { tipe: 'situs', teks: 'Chat', url: 'https://wa.me/628112237711' },
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('wa.me')
  })

  test('tombol link tanpa https ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        judul: 'Sapa Tamu Lama',
        kategori: 'MARKETING',
        isi: ISI_SAH,
        tombol: { tipe: 'situs', teks: 'Tulis Ulasan', url: 'http://g.page/r/abc/review' },
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toContain('https://')
  })

  test('masa berlaku yang sudah lewat ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        judul: 'Sapa Tamu Lama',
        kategori: 'MARKETING',
        isi: ISI_SAH,
        berlaku_sampai: '2020-01-01',
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Masa berlaku tidak boleh tanggal yang sudah lewat.')
  })

  // Isian yang salah adalah salah staf dan harus dibilang begitu, apa pun keadaan
  // kredensial server. Kredensial baru diperiksa sesudah isiannya bersih.
  test('isian salah dijawab 400, bukan 503 kredensial', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: { judul: 'Sapa Tamu Lama', kategori: 'MARKETING', isi: ISI_SAH, gambar_url: 'bukan-url' },
    })
    expect(res.status()).toBe(400)
  })

  test('pengajuan template gagal jelas saat kredensial Meta belum ada', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/template', {
      data: {
        judul: 'Sapa Tamu Lama Review',
        ringkas: 'Ucapan terima kasih ke tamu yang pernah menginap',
        kategori: 'MARKETING',
        isi: ISI_SAH,
        footer: 'Rancabango Hotel and Resort',
        tombol: { tipe: 'situs', teks: 'Tulis Ulasan', url: 'https://g.page/r/abc/review' },
      },
    })
    expect(res.status()).toBe(503)
    expect((await res.json()).error).toBe('meta_belum_dikonfigurasi')
  })

  test('pengajuan template ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.post('/api/template', {
      data: { judul: 'Sapa Tamu Lama', kategori: 'MARKETING', isi: ISI_SAH },
    })
    expect(res.status()).toBe(401)
  })

  test('dashboard ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/dashboard')
    expect(res.status()).toBe(401)
  })

  test('kontak baru menaikkan angka dashboard dan masuk jendela 24 jam', async ({ request }) => {
    await loginStaf(request)
    const sebelum = await (await request.get('/api/dashboard')).json()

    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Dash', teks: 'halo dash', wamid: `wamid.${nomor}.dash` },
    })

    const sesudah = await (await request.get('/api/dashboard')).json()
    expect(sesudah.kontak.total).toBe(sebelum.kontak.total + 1)
    expect(sesudah.percakapan.dalam_jendela).toBe(sebelum.percakapan.dalam_jendela + 1)
    expect(sesudah.percakapan.masuk_24jam).toBe(sebelum.percakapan.masuk_24jam + 1)
    expect(sesudah.kontak.baru_7hari).toBe(sebelum.kontak.baru_7hari + 1)
    expect(sesudah.kuota.batas).toBe(250)
  })

  test('opt-out terhitung di dashboard', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Stop', teks: 'BERHENTI', wamid: `wamid.${nomor}.stop` },
    })

    const sebelum = await (await request.get('/api/dashboard')).json()
    await request.patch(`/api/kontak/${nomor}`, { data: { opt_out: true } })
    const sesudah = await (await request.get('/api/dashboard')).json()
    expect(sesudah.kontak.opt_out).toBe(sebelum.kontak.opt_out + 1)
  })
})
