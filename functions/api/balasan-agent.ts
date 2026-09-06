import { safeEqual, json, type Env } from '../_lib/auth'
import { simpanPesan } from '../_lib/pesan'

// Endpoint mesin (n8n): dikecualikan dari guard cookie di _middleware.ts.
// Pengesahan pakai header rahasia, bukan sesi staf.

interface BodyMasuk {
  nomor?: string
  teks?: string
  wamid?: string
  waktu?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.RELAY_SECRET) {
    return json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const secretHeader = request.headers.get('X-Relay-Secret') || ''
  if (!safeEqual(secretHeader, env.RELAY_SECRET)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: BodyMasuk
  try {
    body = (await request.json()) as BodyMasuk
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const nomor = (body.nomor || '').trim()
  if (!nomor) {
    return json({ error: 'nomor_kosong' }, { status: 400 })
  }

  // Sama seperti /api/pesan-masuk: `waktu` dikirim sebagai detik epoch.
  const detik = Number(body.waktu)
  const waktu =
    body.waktu && Number.isFinite(detik) && detik > 0
      ? new Date(detik * 1000).toISOString()
      : new Date().toISOString()

  try {
    // Simpan lewat helper bersama supaya idempoten terhadap wamid dobel.
    const pesanBaru = await simpanPesan(env, {
      nomor,
      arah: 'keluar',
      pengirim: 'agent',
      teks: body.teks ?? null,
      wamid: body.wamid ?? null,
      waktu,
    })

    await env.DB.prepare('UPDATE percakapan SET terakhir_pesan_pada = ? WHERE nomor = ?')
      .bind(waktu, nomor)
      .run()

    return json({ ok: true, pesan_baru: pesanBaru })
  } catch {
    // n8n memanggil ini fire-and-forget: kegagalan D1 tidak boleh menahan
    // balasan ke tamu, jadi tetap balas 200 dengan ok:false.
    return json({ ok: false })
  }
}
