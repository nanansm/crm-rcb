import { json, safeEqual, type Env } from '../../_lib/auth'

type StatusHasil = 'terkirim' | 'gagal' | 'tertahan'

interface HasilMentah {
  nomor?: unknown
  wamid?: unknown
  status?: unknown
  kode_galat?: unknown
}

interface BodyMentah {
  campaign_id?: unknown
  hasil?: unknown
  selesai?: unknown
}

// Kode galat WhatsApp yang berarti nomor sedang dibatasi Meta (rate limit,
// pairing, dsb) -- ini bukan kegagalan kirim, jadi dihitung 'tertahan'.
const KODE_GALAT_TERTAHAN = new Set(['130429', '131048', '131049', '131056'])

const AMBANG_TERTAHAN_BERUNTUN = 5

function statusSah(nilai: unknown): nilai is StatusHasil {
  return nilai === 'terkirim' || nilai === 'gagal' || nilai === 'tertahan'
}

/** Ambil cuma entri yang bentuknya benar -- entri rusak dibuang diam-diam. */
function hasilSah(daftar: unknown): { nomor: string; wamid: string | null; status: StatusHasil }[] {
  if (!Array.isArray(daftar)) return []
  const keluar: { nomor: string; wamid: string | null; status: StatusHasil }[] = []
  for (const item of daftar as HasilMentah[]) {
    if (typeof item?.nomor !== 'string' || !statusSah(item.status)) continue
    const kodeGalat = typeof item.kode_galat === 'string' ? item.kode_galat : null
    // Kode galat pemutus arus menang atas status yang dilaporkan n8n -- nomor
    // yang kena limit Meta bukan kegagalan kirim biasa.
    const status: StatusHasil = kodeGalat && KODE_GALAT_TERTAHAN.has(kodeGalat) ? 'tertahan' : item.status
    keluar.push({
      nomor: item.nomor,
      wamid: typeof item.wamid === 'string' ? item.wamid : null,
      status,
    })
  }
  return keluar
}

function kunciStreak(campaignId: number): string {
  return `campaign:${campaignId}:tertahan_beruntun`
}

/**
 * Dipanggil n8n tiap batch broadcast selesai. Sudah dijaga X-BC-Secret dan
 * dikecualikan dari guard cookie di `_middleware.ts`.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Rahasia kosong berarti belum dikonfigurasi -- jangan pernah dianggap lolos.
  if (!env.N8N_BC_SECRET) {
    return json({ error: 'server_misconfigured' }, { status: 500 })
  }
  const headerSecret = request.headers.get('X-BC-Secret') || ''
  if (!safeEqual(headerSecret, env.N8N_BC_SECRET)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: BodyMentah
  try {
    body = (await request.json()) as BodyMentah
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const campaignId = Number(body.campaign_id)
  if (!Number.isFinite(campaignId)) return json({ error: 'campaign_id_tidak_valid' }, { status: 400 })

  const daftarHasil = hasilSah(body.hasil)

  const campaign = await env.DB.prepare('SELECT status, aktif FROM campaign WHERE id = ?')
    .bind(campaignId)
    .first<{ status: string; aktif: number | null }>()
  if (!campaign) return json({ lanjut: false, catatan: 'campaign tidak dikenal' })

  const sekarang = new Date().toISOString()
  const statements: D1PreparedStatement[] = []

  let tambahTerkirim = 0
  let tambahGagal = 0
  let tambahTertahan = 0

  // Nomor yang sama bisa dilaporkan >1 kali -- keduplikasi sebelum ditulis ke
  // kontak supaya statement UPDATE tidak dobel untuk nomor yang sama.
  const nomorTerkirim = new Set<string>()

  // Streak tertahan-beruntun dipakai buat pemutus arus. Bersihkan begitu ada
  // satu 'terkirim'; 'gagal' tidak menghentikan hitungan beruntunnya.
  const kunci = kunciStreak(campaignId)
  let streak = Number(await env.CRM_STATE.get(kunci)) || 0
  let putus = false

  for (const item of daftarHasil) {
    if (item.status === 'terkirim') {
      tambahTerkirim += 1
      nomorTerkirim.add(item.nomor)
      streak = 0
    } else if (item.status === 'tertahan') {
      tambahTertahan += 1
      streak += 1
      if (streak >= AMBANG_TERTAHAN_BERUNTUN) putus = true
    } else {
      tambahGagal += 1
    }

    if (item.wamid) {
      // wamid = primary key -- panggilan ulang dengan wamid yang sama tidak
      // boleh melempar, jadi baris kedua diabaikan diam-diam.
      statements.push(
        env.DB.prepare(
          `INSERT INTO pengiriman (wamid, campaign_id, nomor, status_terakhir, billable, diperbarui)
           VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(wamid) DO NOTHING`,
        ).bind(item.wamid, campaignId, item.nomor, item.status, sekarang),
      )

      // Inti buffer status: webhook status Meta hampir selalu tiba SEBELUM baris
      // pengiriman ini ditulis, jadi statusnya menumpuk di status_menunggu. Baris
      // barusan lahir -- serap sekarang juga, kalau tidak status sampai/dibaca
      // nyangkut selamanya (24 dari 25 status hilang di bc-ksa karena ini).
      statements.push(
        env.DB.prepare(
          `UPDATE pengiriman SET
             status_terakhir = (SELECT status FROM status_menunggu WHERE wamid = ?),
             billable = COALESCE((SELECT billable FROM status_menunggu WHERE wamid = ?), billable),
             diperbarui = ?
           WHERE wamid = ?
             AND EXISTS (SELECT 1 FROM status_menunggu WHERE wamid = ?)`,
        ).bind(item.wamid, item.wamid, sekarang, item.wamid, item.wamid),
      )
      statements.push(env.DB.prepare('DELETE FROM status_menunggu WHERE wamid = ?').bind(item.wamid))
    }
  }

  // `terakhir_bc` ditulis di batch ini juga, bukan menunggu run selesai --
  // nomor ini juga melayani tamu sehari-hari, jadi kalau run putus di tengah,
  // nomor yang sudah dikirimi tidak boleh terkirimi ulang di run berikutnya.
  for (const nomor of nomorTerkirim) {
    statements.push(
      env.DB.prepare('UPDATE kontak SET terakhir_bc = ?, diperbarui = ? WHERE nomor = ?').bind(
        sekarang,
        sekarang,
        nomor,
      ),
    )
  }

  statements.push(
    env.DB.prepare(
      'UPDATE campaign SET terkirim = terkirim + ?, gagal = gagal + ?, tertahan = tertahan + ? WHERE id = ?',
    ).bind(tambahTerkirim, tambahGagal, tambahTertahan, campaignId),
  )

  const selesaiDariN8n = body.selesai === true

  if (selesaiDariN8n) {
    statements.push(env.DB.prepare("UPDATE campaign SET status = 'selesai', aktif = NULL WHERE id = ?").bind(campaignId))
  } else if (putus) {
    // Nomor ini juga melayani tamu sehari-hari -- kualitasnya tidak boleh
    // dikorbankan demi menuntaskan satu campaign, jadi campaign dihentikan
    // otomatis begitu Meta menahan lima balasan beruntun.
    statements.push(
      env.DB.prepare("UPDATE campaign SET status = 'dihentikan_otomatis', aktif = NULL WHERE id = ?").bind(
        campaignId,
      ),
    )
  }

  if (statements.length > 0) await env.DB.batch(statements)

  if (selesaiDariN8n || putus) {
    await env.CRM_STATE.delete(kunci)
    return json({ lanjut: false })
  }

  await env.CRM_STATE.put(kunci, String(streak))
  return json({ lanjut: true })
}
