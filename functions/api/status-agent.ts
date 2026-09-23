import { json, safeEqual, type Env } from '../_lib/auth'

interface BarisStatusAgent {
  status_agent: string | null
  opt_out: number | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // RELAY_SECRET kosong berarti belum dikonfigurasi — jangan pernah dianggap lolos.
  if (!env.RELAY_SECRET) {
    return json({ error: 'server_misconfigured' }, { status: 500 })
  }
  const headerSecret = request.headers.get('X-Relay-Secret') || ''
  if (!safeEqual(headerSecret, env.RELAY_SECRET)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  const nomor = new URL(request.url).searchParams.get('nomor')
  if (!nomor) {
    return json({ error: 'nomor_kosong' }, { status: 400 })
  }

  const baris = await env.DB.prepare(
    `SELECT
       p.status_agent AS status_agent,
       k.opt_out AS opt_out
     FROM percakapan p
     LEFT JOIN kontak k ON k.nomor = p.nomor
     WHERE p.nomor = ?`,
  )
    .bind(nomor)
    .first<BarisStatusAgent>()

  if (!baris) {
    return json({ status_agent: 'aktif', opt_out: false })
  }

  return json({
    status_agent: baris.status_agent === 'diambil_alih' ? 'diambil_alih' : 'aktif',
    opt_out: Boolean(baris.opt_out),
  })
}
