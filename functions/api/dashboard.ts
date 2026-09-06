import { guard, json, type Env } from '../_lib/auth'
import { BATAS_PENERIMA_24JAM, sisaKuota } from '../_lib/kuota'
import { analitikHarian, biayaHarian, kesehatanNomor, type AnalitikHarian } from '../_lib/meta'

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000
const JENDELA_MS = 24 * 60 * 60 * 1000
const HARI_MS = 24 * 60 * 60 * 1000

// Nomor ini TIDAK punya WhatsApp Web -- tamu yang dibalas telat tidak
// terlihat di mana pun kecuali di layar dashboard ini. 15 menit dipilih
// supaya kartu "perlu tindakan" menyala jauh sebelum tamu benar-benar kesal.
const AMBANG_TUNGGU_MENIT = 15

// Tarif marketing nyata hasil pengukuran (lihat catatan kuota/broadcast),
// dipakai HANYA sebagai fallback saat Meta tidak menjawab permintaan biaya.
const TARIF_FALLBACK_PER_PESAN = 586

interface Angka {
  n: number
}

interface HitungTunggu {
  nunggu_dibalas: number
  nunggu_lewat_ambang: number
}

interface HitungBulanIni {
  terkirim: number
  sampai: number
  dibaca: number
}

interface BarisCampaignAktif {
  id: number
  status: string
  template: string
  target: number
  terkirim: number
  gagal: number
  tertahan: number
}

/** Awal bulan berjalan menurut kalender Asia/Jakarta (UTC+7, tanpa DST). */
function awalBulanJakarta(sekarang: Date): Date {
  const jakarta = new Date(sekarang.getTime() + JAKARTA_OFFSET_MS)
  const awalUtcJakarta = Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), 1)
  return new Date(awalUtcJakarta - JAKARTA_OFFSET_MS)
}

// Ringkasan untuk layar Dashboard. Semua angka dihitung ulang saat diminta;
// tidak ada nilai yang disimpan, supaya tidak pernah basi.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const sekarang = new Date()
  const awalBulan = awalBulanJakarta(sekarang)
  const mulai30Hari = new Date(sekarang.getTime() - 30 * HARI_MS)
  const batas24Jam = new Date(sekarang.getTime() - JENDELA_MS).toISOString()
  const batasTunggu = new Date(sekarang.getTime() - AMBANG_TUNGGU_MENIT * 60 * 1000).toISOString()
  const batasJendela22Jam = new Date(sekarang.getTime() - 22 * 60 * 60 * 1000).toISOString()
  const awalBulanIso = awalBulan.toISOString()
  const tujuhHariLalu = new Date(sekarang.getTime() - 7 * HARI_MS).toISOString()

  const ambil = async (sql: string, ...bind: unknown[]) => {
    const baris = await env.DB.prepare(sql)
      .bind(...bind)
      .first<Angka>()
    return baris?.n ?? 0
  }

  const [
    nomorHasil,
    analitikHasil,
    biayaHasil,
    bulanIni,
    kuota,
    kontakTotal,
    kontakBaru7Hari,
    kontakOptOut,
    kontakOptOutBulanIni,
    dipegangStaf,
    tunggu,
    jendelaHampirTutup,
    masuk24Jam,
    dalamJendela,
    campaignAktif,
  ] = await Promise.all([
    kesehatanNomor(env),
    analitikHarian(env, mulai30Hari, sekarang),
    biayaHarian(env, awalBulan, sekarang),
    // Bulan sebuah pengiriman ditentukan oleh kapan campaign-nya MULAI, bukan
    // `pengiriman.diperbarui`. Kolom itu bergerak tiap status Meta datang, jadi
    // broadcast 31 Agustus yang dibaca tamu 1 September akan pindah bulan.
    env.DB.prepare(
      `SELECT
         COUNT(*) AS terkirim,
         SUM(CASE WHEN p.status_terakhir IN ('sampai', 'dibaca') THEN 1 ELSE 0 END) AS sampai,
         SUM(CASE WHEN p.status_terakhir = 'dibaca' THEN 1 ELSE 0 END) AS dibaca
       FROM pengiriman p
       JOIN campaign c ON c.id = p.campaign_id
       WHERE c.mulai >= ?`,
    )
      .bind(awalBulanIso)
      .first<HitungBulanIni>(),
    sisaKuota(env),
    ambil('SELECT COUNT(*) AS n FROM kontak'),
    ambil('SELECT COUNT(*) AS n FROM kontak WHERE dibuat >= ?', tujuhHariLalu),
    ambil('SELECT COUNT(*) AS n FROM kontak WHERE opt_out = 1'),
    ambil('SELECT COUNT(*) AS n FROM opt_out_log WHERE waktu >= ?', awalBulanIso),
    ambil("SELECT COUNT(*) AS n FROM percakapan WHERE status_agent = 'diambil_alih'"),
    // Percakapan yang diambil alih staf tapi pesan TERAKHIRNYA justru dari
    // tamu (arah masuk) berarti tamu sedang menunggu tanpa siapa pun menjawab
    // -- pola subquery arah pesan terakhir sama seperti di percakapan/index.ts.
    env.DB.prepare(
      `SELECT
         COUNT(*) AS nunggu_dibalas,
         SUM(CASE WHEN k.terakhir_pesan_masuk <= ? THEN 1 ELSE 0 END) AS nunggu_lewat_ambang
       FROM percakapan p
       JOIN kontak k ON k.nomor = p.nomor
       WHERE p.status_agent = 'diambil_alih'
         AND (
           SELECT pc.arah FROM pesan_chat pc
           WHERE pc.nomor = p.nomor
           ORDER BY pc.waktu DESC, pc.id DESC
           LIMIT 1
         ) = 'masuk'`,
    )
      .bind(batasTunggu)
      .first<HitungTunggu>(),
    ambil(
      `SELECT COUNT(*) AS n FROM percakapan p
       JOIN kontak k ON k.nomor = p.nomor
       WHERE p.status_agent = 'diambil_alih'
         AND k.terakhir_pesan_masuk <= ? AND k.terakhir_pesan_masuk > ?`,
      batasJendela22Jam,
      batas24Jam,
    ),
    ambil('SELECT COUNT(*) AS n FROM pesan_chat WHERE arah = ? AND waktu >= ?', 'masuk', batas24Jam),
    ambil('SELECT COUNT(*) AS n FROM kontak WHERE terakhir_pesan_masuk >= ?', batas24Jam),
    env.DB.prepare(
      'SELECT id, status, template, target, terkirim, gagal, tertahan FROM campaign WHERE aktif = 1',
    ).first<BarisCampaignAktif>(),
  ])

  const gagal: string[] = []

  const harian: AnalitikHarian[] = analitikHasil.ok ? analitikHasil.data : []
  if (!analitikHasil.ok) gagal.push(`harian: ${analitikHasil.sebab}`)

  const nomor = nomorHasil.ok
    ? nomorHasil.data
    : { display: '', nama_terverifikasi: '', kualitas: 'tidak diketahui', status: 'tidak diketahui' }
  if (!nomorHasil.ok) gagal.push(`nomor: ${nomorHasil.sebab}`)

  const terkirimBulanIni = bulanIni?.terkirim ?? 0
  const biayaAsli = biayaHasil.ok
    ? biayaHasil.data.reduce((total, b) => total + b.biaya, 0)
    : null
  if (!biayaHasil.ok) gagal.push(`biaya: ${biayaHasil.sebab}`)

  return json({
    diperbarui: sekarang.toISOString(),
    nomor,
    bulan_ini: {
      terkirim: terkirimBulanIni,
      sampai: bulanIni?.sampai ?? 0,
      dibaca: bulanIni?.dibaca ?? 0,
      // `biaya_asli` true berarti angka tagihan Meta sungguhan, bukan hitungan
      // tarif x jumlah. Layar wajib mengubah labelnya sesuai penanda ini.
      biaya: biayaAsli === null ? terkirimBulanIni * TARIF_FALLBACK_PER_PESAN : Math.round(biayaAsli),
      biaya_asli: biayaAsli !== null,
    },
    harian,
    kuota: { ...kuota, batas: BATAS_PENERIMA_24JAM },
    perlu_tindakan: {
      nunggu_dibalas: tunggu?.nunggu_dibalas ?? 0,
      nunggu_lewat_ambang: tunggu?.nunggu_lewat_ambang ?? 0,
      jendela_hampir_tutup: jendelaHampirTutup,
    },
    percakapan: {
      diambil_alih: dipegangStaf,
      masuk_24jam: masuk24Jam,
      dalam_jendela: dalamJendela,
    },
    kontak: {
      total: kontakTotal,
      baru_7hari: kontakBaru7Hari,
      opt_out: kontakOptOut,
      opt_out_bulan_ini: kontakOptOutBulanIni,
    },
    campaign_aktif: campaignAktif ?? null,
    ...(gagal.length > 0 ? { gagal } : {}),
  })
}
