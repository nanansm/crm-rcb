import { test, expect, type APIRequestContext } from '@playwright/test'

const RELAY_SECRET = 'lokal-uji-relay-9f2a'
const BC_SECRET = 'lokal-uji-bc-3c7d'
const STAF_EMAIL = 'e2e@lokal.test'
const STAF_PASSWORD = 'uji-lokal-123'

function nomorUjiAcak(): string {
  const acak = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
  return `62899200${acak}`
}

async function loginStaf(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/login', {
    data: { email: STAF_EMAIL, password: STAF_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
}

/**
 * Bikin satu baris campaign nyata. Lokal tanpa kredensial n8n, jadi POST berakhir
 * 502 dan barisnya ditandai gagal -- tetap baris sah dengan id yang bisa dipakai
 * menguji progress-callback.
 */
async function buatCampaign(request: APIRequestContext): Promise<number> {
  await loginStaf(request)
  const nomor = nomorUjiAcak()
  await request.post('/api/pesan-masuk', {
    headers: { 'X-Relay-Secret': RELAY_SECRET },
    data: { nomor, nama: 'Tamu Status', teks: 'halo', wamid: `wamid.${nomor}.awal` },
  })
  const buatTag = await request.post('/api/tag', { data: { nama: `st-${Date.now()}-${Math.random()}` } })
  const tagId = (await buatTag.json()).id as number
  await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })

  const res = await request.post('/api/campaign', { data: { template: 'hello_world', tag_ids: [tagId] } })
  expect(res.status()).toBe(502)

  const daftar = (await (await request.get('/api/campaign')).json()).campaign as { id: number }[]
  return daftar[0].id
}

async function progres(request: APIRequestContext, id: number) {
  const res = await request.get(`/api/campaign/${id}/progress`)
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    status: string
    terkirim: number
    gagal: number
    tertahan: number
    persen: number
  }
}

test.describe('status callback & progres campaign', () => {
  test('status-callback ditolak tanpa rahasia relay', async ({ request }) => {
    const res = await request.post('/api/status-callback', {
      data: { wamid: 'wamid.x', status: 'delivered' },
    })
    expect(res.status()).toBe(401)
  })

  test('status yang tidak dikenal ditolak, tidak disimpan diam-diam', async ({ request }) => {
    const res = await request.post('/api/status-callback', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { wamid: 'wamid.aneh', status: 'entah_apa' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('status_tidak_dikenal')
  })

  test('status untuk wamid yang belum ada ditahan di buffer, tidak dibuang', async ({ request }) => {
    const res = await request.post('/api/status-callback', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { wamid: `wamid.buffer.${Date.now()}`, status: 'delivered' },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).ditahan).toBe(true)
  })

  test('status yatim diserap begitu baris pengirimannya lahir', async ({ request }) => {
    const id = await buatCampaign(request)
    const nomor = nomorUjiAcak()
    const wamid = `wamid.serap.${Date.now()}`

    // Urutan yang sebenarnya terjadi di produksi: webhook status Meta duluan,
    // baris pengirimannya menyusul.
    const tahan = await request.post('/api/status-callback', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { wamid, status: 'read' },
    })
    expect((await tahan.json()).ditahan).toBe(true)

    const lapor = await request.post('/api/campaign/progress-callback', {
      headers: { 'X-BC-Secret': BC_SECRET },
      data: { campaign_id: id, hasil: [{ nomor, wamid, status: 'terkirim' }] },
    })
    expect(lapor.status()).toBe(200)

    // Status berikutnya untuk wamid yang sama harus melihat status hasil serapan,
    // yaitu 'dibaca' -- bukan 'terkirim' yang barusan ditulis batch.
    const susulan = await request.post('/api/status-callback', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { wamid, status: 'sent' },
    })
    const bodySusulan = await susulan.json()
    expect(bodySusulan.ditahan).toBe(false)
    expect(bodySusulan.ok).toBe(true)
  })

  test('progress-callback ditolak tanpa rahasia broadcast', async ({ request }) => {
    const res = await request.post('/api/campaign/progress-callback', {
      data: { campaign_id: 1, hasil: [] },
    })
    expect(res.status()).toBe(401)
  })

  test('counter campaign bertambah antar batch, bukan ditimpa', async ({ request }) => {
    const id = await buatCampaign(request)

    for (const teks of ['a', 'b']) {
      const nomor = nomorUjiAcak()
      const res = await request.post('/api/campaign/progress-callback', {
        headers: { 'X-BC-Secret': BC_SECRET },
        data: {
          campaign_id: id,
          hasil: [{ nomor, wamid: `wamid.${nomor}.${teks}`, status: 'terkirim' }],
        },
      })
      expect(res.status()).toBe(200)
      // Campaign buatan fixture sudah dilepas dari aktif=1 (n8n tidak dikonfigurasi
      // di lokal, jadi serah-terimanya gagal). Laporan batch yang telat datang tetap
      // WAJIB dicatat, tapi jawabannya harus 'berhenti' -- lihat uji di bawah.
      expect((await res.json()).lanjut).toBe(false)
    }

    const p = await progres(request, id)
    expect(p.terkirim).toBe(2)
  })

  test('campaign yang sudah dihentikan menyuruh n8n berhenti, hasilnya tetap dicatat', async ({
    request,
  }) => {
    const id = await buatCampaign(request)
    await loginStaf(request)
    // Hentikan eksplisit: ini yang terjadi saat staf menekan tombol Hentikan.
    expect((await request.delete('/api/campaign')).status()).toBe(200)

    const nomor = nomorUjiAcak()
    const res = await request.post('/api/campaign/progress-callback', {
      headers: { 'X-BC-Secret': BC_SECRET },
      data: { campaign_id: id, hasil: [{ nomor, wamid: `wamid.${nomor}.stop`, status: 'terkirim' }] },
    })
    expect(res.status()).toBe(200)
    // Tanpa ini tombol Hentikan tidak menghentikan apa pun: n8n terus mengirim
    // batch berikutnya sampai daftar nomor habis.
    expect((await res.json()).lanjut).toBe(false)

    const p = await progres(request, id)
    expect(p.terkirim).toBe(1)
  })

  test('nomor terkirim langsung ditandai terakhir_bc, jadi tidak masuk segmen lagi', async ({ request }) => {
    const id = await buatCampaign(request)
    await loginStaf(request)

    const nomor = nomorUjiAcak()
    await request.post('/api/pesan-masuk', {
      headers: { 'X-Relay-Secret': RELAY_SECRET },
      data: { nomor, nama: 'Tamu Dedupe', teks: 'halo', wamid: `wamid.${nomor}.awal` },
    })
    const tagId = (await (await request.post('/api/tag', { data: { nama: `dedup-${Date.now()}` } })).json())
      .id as number
    await request.post(`/api/kontak/${nomor}/tag`, { data: { tag_id: tagId } })

    const sebelum = await (await request.get(`/api/segmen/hitung?tag=${tagId}`)).json()
    expect(sebelum.akan_dikirim).toBe(1)

    await request.post('/api/campaign/progress-callback', {
      headers: { 'X-BC-Secret': BC_SECRET },
      data: { campaign_id: id, hasil: [{ nomor, wamid: `wamid.${nomor}.kirim`, status: 'terkirim' }] },
    })

    const sesudah = await (await request.get(`/api/segmen/hitung?tag=${tagId}`)).json()
    expect(sesudah.dibuang_baru_dibc).toBe(1)
    expect(sesudah.akan_dikirim).toBe(0)
  })

  test('lima tertahan beruntun menghentikan campaign otomatis', async ({ request }) => {
    const id = await buatCampaign(request)

    const hasil = Array.from({ length: 5 }, () => {
      const nomor = nomorUjiAcak()
      return { nomor, wamid: `wamid.${nomor}.tahan`, status: 'tertahan' }
    })

    const res = await request.post('/api/campaign/progress-callback', {
      headers: { 'X-BC-Secret': BC_SECRET },
      data: { campaign_id: id, hasil },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).lanjut).toBe(false)

    const p = await progres(request, id)
    expect(p.status).toBe('dihentikan_otomatis')
    expect(p.tertahan).toBe(5)
  })

  test('kode galat rate-limit Meta dihitung tertahan, bukan gagal', async ({ request }) => {
    const id = await buatCampaign(request)
    const nomor = nomorUjiAcak()

    await request.post('/api/campaign/progress-callback', {
      headers: { 'X-BC-Secret': BC_SECRET },
      data: {
        campaign_id: id,
        // n8n melaporkannya sebagai 'gagal'; kode galatnya yang menentukan.
        hasil: [{ nomor, wamid: `wamid.${nomor}.limit`, status: 'gagal', kode_galat: '131049' }],
      },
    })

    const p = await progres(request, id)
    expect(p.tertahan).toBe(1)
    expect(p.gagal).toBe(0)
  })

  test('progres campaign yang tidak ada balas 404', async ({ request }) => {
    await loginStaf(request)
    const res = await request.get('/api/campaign/999999/progress')
    expect(res.status()).toBe(404)
  })

  test('progres ditolak tanpa sesi staf', async ({ request }) => {
    const res = await request.get('/api/campaign/1/progress')
    expect(res.status()).toBe(401)
  })
})
