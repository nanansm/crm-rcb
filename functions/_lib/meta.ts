/**
 * Pembungkus tipis Graph API WhatsApp Business, dipakai jalur balas manual staf.
 */

import type { Env } from './db'

const VERSI = 'v21.0'

export type HasilKirim = { ok: true; wamid: string } | { ok: false; kode: number | null; pesan: string }

/**
 * Pesan galat Meta kadang menyertakan nomor tujuan. Pesan ini tampil di layar
 * staf dan ikut tersimpan di log, jadi deretan angka panjang disamarkan dulu.
 */
function samarkanNomor(pesan: string): string {
  return pesan.replace(/\d{8,}/g, '(nomor)')
}

interface ResponMetaSukses {
  messages?: { id?: string }[]
}

interface ResponMetaGagal {
  error?: { message?: string; code?: number }
}

/**
 * Kirim pesan teks biasa. Tidak melempar exception untuk galat Meta yang normal --
 * pemanggil WAJIB menangani `ok: false`. Pesan galat yang dikembalikan tidak pernah
 * memuat token, header, atau nomor tujuan -- pesan ini tampil langsung di UI staf.
 */
export async function kirimTeks(env: Env, data: { ke: string; teks: string }): Promise<HasilKirim> {
  // Lokal/dev sengaja tidak punya kredensial Meta -- ini keadaan normal, bukan galat.
  if (!env.META_TOKEN || !env.META_PHONE_ID) {
    return { ok: false, kode: null, pesan: 'meta_belum_dikonfigurasi' }
  }

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${VERSI}/${env.META_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: data.ke,
        type: 'text',
        text: { body: data.teks },
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Timeout atau jaringan putus.
    return { ok: false, kode: null, pesan: 'gagal_menghubungi_meta' }
  }

  const teks = await res.text()
  let terurai: unknown = null
  try {
    terurai = teks ? JSON.parse(teks) : null
  } catch {
    // biarkan null -- ditangani lewat status HTTP di bawah
  }

  if (!res.ok) {
    const err = (terurai as ResponMetaGagal | null)?.error
    return {
      ok: false,
      kode: err?.code ?? res.status,
      pesan: err?.message ? samarkanNomor(err.message) : 'meta_menolak_pesan',
    }
  }

  const wamid = (terurai as ResponMetaSukses | null)?.messages?.[0]?.id
  if (!wamid) return { ok: false, kode: null, pesan: 'meta_tidak_mengembalikan_wamid' }

  return { ok: true, wamid }
}

/**
 * Fungsi analitik Meta (dashboard) -- pola disalin dari bc-ksa/functions/_lib/meta.ts.
 * Kredensial di sini opsional (lokal sengaja kosong), jadi setiap fungsi mengecek
 * lebih dulu dan pulang `ok: false` tanpa pernah melempar exception.
 */

const JAKARTA_OFFSET_DETIK = 7 * 60 * 60
const CACHE_TTL_DETIK = 300
const CACHE_PREFIX = 'meta:'

export type HasilMeta<T> = { ok: true; data: T } | { ok: false; sebab: string }

export interface AnalitikHarian {
  tanggal: string // 'YYYY-MM-DD'
  terkirim: number
  sampai: number
}

export interface BiayaHarian {
  tanggal: string // 'YYYY-MM-DD'
  jumlah: number
  biaya: number // rupiah, sudah dijumlah semua kategori harga hari itu
}

export interface KesehatanNomor {
  display: string
  nama_terverifikasi: string
  kualitas: string
  status: string
}

/**
 * Cache-aside di KV `CRM_STATE`. KV yang gagal dibaca/ditulis TIDAK menggagalkan
 * permintaan -- itu cuma soal performa, bukan syarat -- jadi lanjut tembak Graph.
 */
async function ambilTercache<T>(env: Env, kunci: string, ambil: () => Promise<T>): Promise<HasilMeta<T>> {
  const kunciCache = `${CACHE_PREFIX}${kunci}`
  try {
    const tersimpan = await env.CRM_STATE.get(kunciCache)
    if (tersimpan) {
      try {
        return { ok: true, data: JSON.parse(tersimpan) as T }
      } catch {
        // cache rusak -- lanjut tembak Graph di bawah
      }
    }
  } catch {
    // KV gagal dibaca -- bukan alasan gagalkan permintaan
  }

  try {
    const data = await ambil()
    try {
      await env.CRM_STATE.put(kunciCache, JSON.stringify(data), { expirationTtl: CACHE_TTL_DETIK })
    } catch {
      // KV gagal ditulis -- data tetap dikembalikan ke pemanggil
    }
    return { ok: true, data }
  } catch (e) {
    // Pesan galat SELALU kata pendek tetap (lihat panggilGraph) -- tidak pernah
    // memuat token/header/nomor karena sebab ini tampil langsung ke layar staf.
    return { ok: false, sebab: e instanceof Error ? e.message : 'gagal_tanpa_keterangan' }
  }
}

/**
 * GET ke Graph API. Token dikirim lewat header Authorization, bukan query string:
 * URL ikut tercatat di log perantara, header tidak. Pesan galat tidak pernah
 * memuat token maupun isi respons Meta.
 */
async function panggilGraph<T>(env: Env, id: string, fields: string, tambahan?: Record<string, string>): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${VERSI}/${id}`)
  url.searchParams.set('fields', fields)
  for (const [k, v] of Object.entries(tambahan ?? {})) url.searchParams.set(k, v)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.META_TOKEN as string}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('gagal_menghubungi_meta')
  }
  if (!res.ok) throw new Error('meta_menolak_permintaan')

  try {
    return (await res.json()) as T
  } catch {
    throw new Error('meta_balas_rusak')
  }
}

/** Graph API meminta rentang waktu dalam epoch detik, bukan milidetik. */
function epochDetik(tanggal: Date): number {
  return Math.floor(tanggal.getTime() / 1000)
}

interface ResponAnalytics {
  analytics?: { data_points?: { start: number; sent?: number; delivered?: number }[] }
}

/** GET /{WABA}?fields=analytics.start(...).end(...).granularity(DAY) */
export async function analitikHarian(env: Env, mulai: Date, selesai: Date): Promise<HasilMeta<AnalitikHarian[]>> {
  if (!env.META_TOKEN || !env.META_WABA_ID) return { ok: false, sebab: 'meta_belum_dikonfigurasi' }

  const kunci = `analytics:${mulai.toISOString().slice(0, 10)}:${selesai.toISOString().slice(0, 10)}`
  return ambilTercache(env, kunci, async () => {
    const fields = `analytics.start(${epochDetik(mulai)}).end(${epochDetik(selesai)}).granularity(DAY)`
    const data = await panggilGraph<ResponAnalytics>(env, env.META_WABA_ID as string, fields)
    const titik = data.analytics?.data_points ?? []
    // Meta memotong hari menurut zona waktu nomornya, jadi `start` jatuh pada 17.00 UTC
    // (00.00 WIB). Tanpa menggeser +7 jam, `toISOString()` memberi tanggal sehari mundur.
    return titik.map((t) => ({
      tanggal: new Date((t.start + JAKARTA_OFFSET_DETIK) * 1000).toISOString().slice(0, 10),
      terkirim: t.sent ?? 0,
      sampai: t.delivered ?? 0,
    }))
  })
}

interface ResponPricing {
  pricing_analytics?: {
    data?: { data_points?: { start: number; volume?: number; cost?: number }[] }[]
  }
}

/**
 * GET /{WABA}?fields=pricing_analytics... -- biaya sebenarnya yang ditagih Meta.
 * Satu hari bisa punya beberapa data point (kategori harga berbeda), dijumlahkan
 * per tanggal. WABA ini berdenominasi IDR, jadi `cost` dipakai apa adanya.
 */
export async function biayaHarian(env: Env, mulai: Date, selesai: Date): Promise<HasilMeta<BiayaHarian[]>> {
  if (!env.META_TOKEN || !env.META_WABA_ID) return { ok: false, sebab: 'meta_belum_dikonfigurasi' }

  const kunci = `biaya:${mulai.toISOString().slice(0, 10)}:${selesai.toISOString().slice(0, 10)}`
  return ambilTercache(env, kunci, async () => {
    const fields =
      `pricing_analytics.start(${epochDetik(mulai)}).end(${epochDetik(selesai)})` +
      `.granularity(DAILY).dimensions(['PRICING_CATEGORY'])`
    const data = await panggilGraph<ResponPricing>(env, env.META_WABA_ID as string, fields)

    const perTanggal = new Map<string, BiayaHarian>()
    for (const kelompok of data.pricing_analytics?.data ?? []) {
      for (const t of kelompok.data_points ?? []) {
        const tanggal = new Date((t.start + JAKARTA_OFFSET_DETIK) * 1000).toISOString().slice(0, 10)
        const ada = perTanggal.get(tanggal) ?? { tanggal, jumlah: 0, biaya: 0 }
        ada.jumlah += t.volume ?? 0
        ada.biaya += t.cost ?? 0
        perTanggal.set(tanggal, ada)
      }
    }
    return [...perTanggal.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal))
  })
}

interface ResponNomor {
  display_phone_number: string
  verified_name: string
  quality_rating: string
  status: string
}

/** GET /{PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,status */
export async function kesehatanNomor(env: Env): Promise<HasilMeta<KesehatanNomor>> {
  if (!env.META_TOKEN || !env.META_PHONE_ID) return { ok: false, sebab: 'meta_belum_dikonfigurasi' }

  return ambilTercache(env, 'nomor', async () => {
    const data = await panggilGraph<ResponNomor>(
      env,
      env.META_PHONE_ID as string,
      'display_phone_number,verified_name,quality_rating,status',
    )
    return {
      display: data.display_phone_number,
      nama_terverifikasi: data.verified_name,
      kualitas: data.quality_rating,
      status: data.status,
    }
  })
}
