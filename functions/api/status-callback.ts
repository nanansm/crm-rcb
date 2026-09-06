import { json, safeEqual, type Env } from '../_lib/auth'

/**
 * Peringkat status pengiriman. Status hanya boleh maju: terkirim < sampai < dibaca.
 * `gagal` dianggap terminal dan selalu menang -- begitu status gagal tersimpan,
 * event lain (termasuk 'read' yang tiba telat) tidak boleh menimpanya lagi.
 */
const URUTAN: Record<string, number> = { terkirim: 1, sampai: 2, dibaca: 3 }

/**
 * n8n meneruskan `statuses[].status` apa adanya dari Meta, jadi yang masuk bisa
 * istilah Meta (`sent`/`delivered`/`read`/`failed`) maupun istilah tabel kalau
 * node n8n sudah menerjemahkannya. Dua-duanya diterima; yang tidak dikenal
 * ditolak 400 supaya tidak diam-diam tersimpan sebagai status sampah.
 */
const PETA_STATUS: Record<string, string> = {
  sent: 'terkirim',
  delivered: 'sampai',
  read: 'dibaca',
  failed: 'gagal',
  terkirim: 'terkirim',
  sampai: 'sampai',
  dibaca: 'dibaca',
  gagal: 'gagal',
}

function statusMaju(lama: string, baru: string): boolean {
  return lama !== 'gagal' && (baru === 'gagal' || (URUTAN[baru] ?? 0) > (URUTAN[lama] ?? 0))
}

interface BodyStatusCallback {
  wamid?: string
  status?: string
  billable?: boolean | number
  waktu?: string
}

function billableKeAngka(nilai: boolean | number | undefined): number | null {
  return nilai === undefined ? null : nilai ? 1 : 0
}

/**
 * `waktu` dari Meta = detik epoch dalam bentuk string. Nilai yang tidak masuk
 * akal (kosong, bukan angka, di luar rentang) jatuh ke jam server, sama seperti
 * pola di pesan-masuk.ts.
 */
function waktuDariEpoch(nilai?: string): string {
  const detik = Number(nilai)
  if (!nilai || !Number.isFinite(detik) || detik <= 0) return new Date().toISOString()
  const tanggal = new Date(detik * 1000)
  return Number.isNaN(tanggal.getTime()) ? new Date().toISOString() : tanggal.toISOString()
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // RELAY_SECRET kosong berarti belum dikonfigurasi -- jangan pernah dianggap lolos.
  if (!env.RELAY_SECRET) {
    return json({ error: 'server_misconfigured' }, { status: 500 })
  }
  const headerSecret = request.headers.get('X-Relay-Secret') || ''
  if (!safeEqual(headerSecret, env.RELAY_SECRET)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: BodyStatusCallback
  try {
    body = await request.json<BodyStatusCallback>()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const wamid = String(body.wamid ?? '').trim()
  const statusMentah = String(body.status ?? '').trim().toLowerCase()
  if (!wamid || !statusMentah) {
    return json({ error: 'wamid_dan_status_wajib' }, { status: 400 })
  }
  const status = PETA_STATUS[statusMentah]
  if (!status) {
    return json({ error: 'status_tidak_dikenal' }, { status: 400 })
  }

  const billable = billableKeAngka(body.billable)
  const waktu = waktuDariEpoch(body.waktu)
  const sekarang = new Date().toISOString()

  try {
    const baris = await env.DB.prepare(`SELECT status_terakhir FROM pengiriman WHERE wamid = ?`)
      .bind(wamid)
      .first<{ status_terakhir: string }>()

    // n8n memanggil endpoint ini fire-and-forget untuk tiap statuses[] dari webhook
    // Meta. Webhook status SERING tiba sebelum baris wamid-nya sempat ditulis alur
    // kirim campaign (race antara respons kirim & webhook Meta) -- kalau langsung
    // dibuang, status sampai/dibaca hilang permanen untuk sebagian besar pesan.
    if (!baris) {
      await env.DB.prepare(
        `INSERT INTO status_menunggu (wamid, status, billable, waktu) VALUES (?, ?, ?, ?)
         ON CONFLICT(wamid) DO UPDATE SET
           status = CASE
             WHEN status_menunggu.status = 'gagal' THEN status_menunggu.status
             WHEN excluded.status = 'gagal' THEN excluded.status
             WHEN (CASE excluded.status WHEN 'dibaca' THEN 3 WHEN 'sampai' THEN 2 WHEN 'terkirim' THEN 1 ELSE 0 END)
                > (CASE status_menunggu.status WHEN 'dibaca' THEN 3 WHEN 'sampai' THEN 2 WHEN 'terkirim' THEN 1 ELSE 0 END)
               THEN excluded.status
             ELSE status_menunggu.status
           END,
           billable = COALESCE(excluded.billable, status_menunggu.billable),
           waktu = excluded.waktu`,
      )
        .bind(wamid, status, billable, waktu)
        .run()

      // Tetap 200: n8n tidak menunggu jawaban ini untuk memutuskan apa pun.
      return json({ ok: true, wamid, ditahan: true })
    }

    const pernyataan: D1PreparedStatement[] = []
    if (statusMaju(baris.status_terakhir, status)) {
      pernyataan.push(
        env.DB.prepare(
          `UPDATE pengiriman SET status_terakhir = ?, billable = COALESCE(?, billable), diperbarui = ? WHERE wamid = ?`,
        ).bind(status, billable, sekarang, wamid),
      )
    }

    // Baris untuk wamid ini baru saja disentuh -- serap status yatim yang sempat
    // tertahan di buffer untuk wamid yang sama, supaya tidak nyangkut selamanya
    // kalau baris dibuat setelah callback yatimnya sempat lewat sekali.
    const tertahan = await env.DB.prepare(`SELECT status, billable FROM status_menunggu WHERE wamid = ?`)
      .bind(wamid)
      .first<{ status: string; billable: number | null }>()

    if (tertahan) {
      const acuan = pernyataan.length > 0 ? status : baris.status_terakhir
      if (statusMaju(acuan, tertahan.status)) {
        pernyataan.push(
          env.DB.prepare(
            `UPDATE pengiriman SET status_terakhir = ?, billable = COALESCE(?, billable), diperbarui = ? WHERE wamid = ?`,
          ).bind(tertahan.status, tertahan.billable, sekarang, wamid),
        )
      }
      pernyataan.push(env.DB.prepare(`DELETE FROM status_menunggu WHERE wamid = ?`).bind(wamid))
    }

    if (pernyataan.length > 0) await env.DB.batch(pernyataan)

    return json({ ok: true, wamid, ditahan: false })
  } catch (err) {
    // n8n fire-and-forget: galat D1 tidak boleh membuat n8n retry berulang atau
    // gagal memproses statuses[] lain dalam batch yang sama.
    return json({
      ok: false,
      wamid,
      catatan_galat: err instanceof Error ? err.message : 'galat_tidak_diketahui',
    })
  }
}
