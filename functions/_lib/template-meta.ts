/**
 * Satu-satunya tempat daftar template ditarik dari Graph API. Dipakai dua jalur:
 * layar Templat (menampilkan daftar) dan pembuatan campaign (memeriksa template
 * yang dipilih staf masih layak kirim sebelum ratusan pesan berangkat).
 */

import type { Env } from './db'

export const VERSI_GRAPH = 'v21.0'

export interface TombolMetaKomponen {
  type?: string
  text?: string
  url?: string
}

export interface KomponenMeta {
  type?: string
  format?: string
  text?: string
  buttons?: TombolMetaKomponen[]
}

export interface TemplateMeta {
  id?: string
  name?: string
  status?: string
  category?: string
  language?: string
  components?: KomponenMeta[]
}

interface RespMetaTemplates {
  data?: TemplateMeta[]
}

export interface RespMetaGagal {
  error?: { message?: string; code?: number }
}

/** Pesan galat Meta kadang menyertakan angka panjang (ID, kode akun). Disamarkan
 * sebelum tampil ke layar staf atau tersimpan di log. */
export function samarkanAngka(pesan: string): string {
  return pesan.replace(/\d{8,}/g, '(angka)')
}

/**
 * Template ber-variabel (`{{1}}`) DITOLAK Meta kalau dikirim tanpa parameter,
 * dan jalur broadcast di sini tidak pernah mengirim parameter. Template seperti
 * itu gagal 100% di setiap nomor, jadi wajib dikenali sebelum dipakai -- bukan
 * ditemukan setelah ratusan pesan tercatat gagal.
 */
export function punyaVariabel(t: TemplateMeta): boolean {
  for (const k of t.components ?? []) {
    if (typeof k.text === 'string' && k.text.includes('{{')) return true
    for (const b of k.buttons ?? []) {
      if (typeof b.text === 'string' && b.text.includes('{{')) return true
      if (typeof b.url === 'string' && b.url.includes('{{')) return true
    }
  }
  return false
}

/** Header bergambar wajib dikirimi parameter gambar; tanpa itu Meta menolak. */
export function punyaHeaderGambar(t: TemplateMeta): boolean {
  const header = (t.components ?? []).find((k) => (k.type ?? '').toUpperCase() === 'HEADER')
  return (header?.format ?? '').toUpperCase() === 'IMAGE'
}

export type HasilDaftar =
  | { ok: true; data: TemplateMeta[] }
  | { ok: false; pesan: string; status: number }

export async function ambilDaftarTemplateMeta(env: Env): Promise<HasilDaftar> {
  let res: Response
  try {
    res = await fetch(
      `https://graph.facebook.com/${VERSI_GRAPH}/${env.META_WABA_ID}/message_templates?fields=id,name,status,category,language,components&limit=200`,
      {
        headers: { Authorization: `Bearer ${env.META_TOKEN as string}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    return { ok: false, pesan: 'gagal_menghubungi_meta', status: 502 }
  }

  const teks = await res.text()
  let terurai: unknown = null
  try {
    terurai = teks ? JSON.parse(teks) : null
  } catch {
    // biarkan null -- ditangani lewat status HTTP di bawah
  }

  if (!res.ok) {
    const err = (terurai as RespMetaGagal | null)?.error
    return {
      ok: false,
      pesan: err?.message ? samarkanAngka(err.message) : 'meta_menolak_permintaan',
      status: 502,
    }
  }

  return { ok: true, data: (terurai as RespMetaTemplates | null)?.data ?? [] }
}
