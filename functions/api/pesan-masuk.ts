import { json, safeEqual, type Env } from '../_lib/auth'
import { upsertKontak, simpanPesan, statusPercakapan, apakahOptOut } from '../_lib/pesan'

interface BodyPesanMasuk {
  nomor?: string
  nama?: string
  teks?: string
  wamid?: string
  waktu?: string
  tipe?: string
}

/**
 * `waktu` dari Meta = detik epoch dalam bentuk string. Nilai yang tidak masuk
 * akal (kosong, bukan angka, di luar rentang) jatuh ke jam server. Tanpa
 * penjagaan ini `new Date(NaN).toISOString()` melempar dan seluruh relay gagal.
 */
function waktuDariEpoch(nilai?: string): string {
  const detik = Number(nilai)
  if (!nilai || !Number.isFinite(detik) || detik <= 0) return new Date().toISOString()
  const tanggal = new Date(detik * 1000)
  return Number.isNaN(tanggal.getTime()) ? new Date().toISOString() : tanggal.toISOString()
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // RELAY_SECRET kosong berarti belum dikonfigurasi — jangan pernah dianggap lolos.
  if (!env.RELAY_SECRET) {
    return json({ error: 'server_misconfigured' }, { status: 500 })
  }
  const headerSecret = request.headers.get('X-Relay-Secret') || ''
  if (!safeEqual(headerSecret, env.RELAY_SECRET)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: BodyPesanMasuk
  try {
    body = (await request.json()) as BodyPesanMasuk
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const nomor = String(body.nomor ?? '').trim()
  if (!nomor) {
    return json({ error: 'nomor_wajib' }, { status: 400 })
  }

  // `waktu` Meta = detik epoch, ini timestamp pesan yang sebenarnya. Jam
  // server cuma dipakai kalau field itu tidak dikirim, karena jam server
  // adalah saat request TIBA, bukan saat tamu mengirim pesannya.
  const waktu = waktuDariEpoch(body.waktu)

  try {
    await upsertKontak(env, nomor, body.nama ?? null, waktu)
    const pesanBaru = await simpanPesan(env, {
      nomor,
      arah: 'masuk',
      pengirim: 'tamu',
      teks: body.teks ?? null,
      wamid: body.wamid ?? null,
      waktu,
    })
    const statusAgent = await statusPercakapan(env, nomor, waktu)
    const optOut = await apakahOptOut(env, nomor)

    return json({ status_agent: statusAgent, opt_out: optOut, pesan_baru: pesanBaru })
  } catch (err) {
    // Fail-open dengan sengaja: n8n MENUNGGU jawaban ini untuk memutuskan AI
    // agent membalas tamu atau tidak. Galat D1 tidak boleh membuat tamu
    // tidak dibalas, jadi kirim status aman lalu catat galatnya saja.
    return json({
      status_agent: 'aktif',
      opt_out: false,
      pesan_baru: false,
      catatan_galat: err instanceof Error ? err.message : 'galat_tidak_diketahui',
    })
  }
}
