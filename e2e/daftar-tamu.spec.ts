import { test, expect, type APIRequestContext } from '@playwright/test'

const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899400${acak}`
}

function namaDaftarAcak(): string {
  return `daftar-e2e-${Math.random().toString(36).slice(2, 8)}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', { data: { email: STAF_EMAIL, password: STAF_PASSWORD } })
  expect(res.ok()).toBeTruthy()
}

async function buatDaftar(
  request: APIRequestContext,
  nama: string,
  nomor: { nomor: string; nama?: string }[],
): Promise<string> {
  const mulai = await request.post('/api/daftar', { data: { aksi: 'mulai', nama } })
  expect(mulai.status()).toBe(201)
  const { id } = (await mulai.json()) as { id: string }

  const tambah = await request.post('/api/daftar', { data: { aksi: 'tambah', id, nomor } })
  expect(tambah.ok()).toBeTruthy()

  const selesai = await request.post('/api/daftar', { data: { aksi: 'selesai', id } })
  expect(selesai.ok()).toBeTruthy()
  return id
}

test.describe('daftar tamu dari file', () => {
  test('daftar baru muncul hanya setelah dikunci', async ({ request }) => {
    await loginStaf(request)
    const nama = namaDaftarAcak()

    const mulai = await request.post('/api/daftar', { data: { aksi: 'mulai', nama } })
    expect(mulai.status()).toBe(201)
    const { id } = (await mulai.json()) as { id: string }

    // Unggahan yang putus di tengah tidak boleh bisa dikirimi separuh, jadi
    // daftar siap=0 sengaja tidak pernah muncul di mana pun.
    const sebelum = await request.get('/api/daftar')
    const dataSebelum = (await sebelum.json()) as { daftar: { id: string }[] }
    expect(dataSebelum.daftar.some((d) => d.id === id)).toBe(false)

    await request.post('/api/daftar', { data: { aksi: 'tambah', id, nomor: [{ nomor: nomorAcak() }] } })
    await request.post('/api/daftar', { data: { aksi: 'selesai', id } })

    const sesudah = await request.get('/api/daftar')
    const dataSesudah = (await sesudah.json()) as { daftar: { id: string; jumlah: number }[] }
    const baris = dataSesudah.daftar.find((d) => d.id === id)
    expect(baris?.jumlah).toBe(1)
  })

  test('nomor dinormalkan dan yang dobel dihitung sekali', async ({ request }) => {
    await loginStaf(request)
    const dasar = nomorAcak()
    const lokal = '0' + dasar.slice(2)

    const id = await buatDaftar(request, namaDaftarAcak(), [
      { nomor: dasar },
      { nomor: lokal }, // bentuk 08xx dari nomor yang sama
      { nomor: '12345' }, // tidak mungkin nomor Indonesia
    ])

    const res = await request.get('/api/daftar')
    const data = (await res.json()) as { daftar: { id: string; jumlah: number }[] }
    expect(data.daftar.find((d) => d.id === id)?.jumlah).toBe(1)
  })

  test('daftar tanpa satu pun nomor sah ditolak dan tidak disimpan', async ({ request }) => {
    await loginStaf(request)
    const nama = namaDaftarAcak()

    const mulai = await request.post('/api/daftar', { data: { aksi: 'mulai', nama } })
    const { id } = (await mulai.json()) as { id: string }
    await request.post('/api/daftar', { data: { aksi: 'tambah', id, nomor: [{ nomor: 'bukan nomor' }] } })

    const selesai = await request.post('/api/daftar', { data: { aksi: 'selesai', id } })
    expect(selesai.status()).toBe(400)

    const res = await request.get('/api/daftar')
    const data = (await res.json()) as { daftar: { id: string }[] }
    expect(data.daftar.some((d) => d.id === id)).toBe(false)
  })

  test('nama daftar terlalu pendek ditolak', async ({ request }) => {
    await loginStaf(request)
    const res = await request.post('/api/daftar', { data: { aksi: 'mulai', nama: 'ab' } })
    expect(res.status()).toBe(400)
  })

  test('daftar yang sudah dikunci menolak tambahan nomor', async ({ request }) => {
    await loginStaf(request)
    const id = await buatDaftar(request, namaDaftarAcak(), [{ nomor: nomorAcak() }])

    const res = await request.post('/api/daftar', {
      data: { aksi: 'tambah', id, nomor: [{ nomor: nomorAcak() }] },
    })
    expect(res.status()).toBe(400)
  })

  test('impor memasukkan tamu ke daftar kontak CRM', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorAcak()
    await buatDaftar(request, namaDaftarAcak(), [{ nomor, nama: 'Tamu Impor' }])

    const res = await request.get(`/api/kontak?cari=${nomor}`)
    const data = (await res.json()) as { kontak: { nomor: string; nama: string | null }[] }
    expect(data.kontak.some((k) => k.nomor === nomor)).toBe(true)
  })

  test('hitung segmen dibatasi anggota daftar yang dipilih', async ({ request }) => {
    await loginStaf(request)
    const a = nomorAcak()
    const b = nomorAcak()
    const id = await buatDaftar(request, namaDaftarAcak(), [{ nomor: a }, { nomor: b }])

    const res = await request.get(`/api/segmen/hitung?daftar=${id}`)
    const data = (await res.json()) as { total_cocok: number; akan_dikirim: number }
    expect(data.total_cocok).toBe(2)
    expect(data.akan_dikirim).toBeLessThanOrEqual(2)
  })

  test('daftar dihapus tanpa ikut menghapus kontaknya', async ({ request }) => {
    await loginStaf(request)
    const nomor = nomorAcak()
    const id = await buatDaftar(request, namaDaftarAcak(), [{ nomor }])

    const hapus = await request.delete(`/api/daftar?id=${id}`)
    expect(hapus.ok()).toBeTruthy()

    const daftar = await request.get('/api/daftar')
    const dataDaftar = (await daftar.json()) as { daftar: { id: string }[] }
    expect(dataDaftar.daftar.some((d) => d.id === id)).toBe(false)

    // Kontaknya tetap ada: tag, catatan, dan riwayat chat tamu tidak boleh ikut
    // hilang cuma karena satu daftar dibuang.
    const kontak = await request.get(`/api/kontak?cari=${nomor}`)
    const dataKontak = (await kontak.json()) as { kontak: { nomor: string }[] }
    expect(dataKontak.kontak.some((k) => k.nomor === nomor)).toBe(true)
  })

  test('mode uji menjawab satu penerima tanpa menyentuh segmen', async ({ request }) => {
    await loginStaf(request)
    const res = await request.get('/api/segmen/hitung?maks=-1')
    const data = (await res.json()) as {
      uji: boolean
      nomor_uji: string | null
      akan_dikirim: number
      total_cocok: number
    }
    expect(data.uji).toBe(true)
    expect(data.akan_dikirim).toBe(1)
    expect(data.total_cocok).toBe(0)
    expect(data.nomor_uji).toBe('628999000111')
  })

  test('daftar ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/daftar')
    expect(res.status()).toBe(401)
  })
})
