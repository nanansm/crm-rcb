/**
 * Pembungkus tipis buat menyerahkan broadcast ke workflow n8n `RCB - BC Run`.
 */

import type { Env } from './db'

export type HasilBroadcast = { ok: true } | { ok: false; pesan: string }

/**
 * Pesan galat n8n bisa saja menyalin balik nomor tujuan yang dikirim. Nomor
 * disamarkan dulu sebelum pesan ini tersimpan di baris campaign atau tampil di layar staf.
 */
function samarkanNomor(pesan: string): string {
  return pesan.replace(/\d{8,}/g, '(nomor)')
}

interface ResponN8nGagal {
  error?: string
  pesan?: string
}

/**
 * Serahkan satu batch broadcast ke n8n. Tidak melempar exception untuk penolakan
 * normal -- pemanggil WAJIB menangani `ok: false`. Rahasia dan daftar nomor tidak
 * pernah ikut ke pesan galat yang dikembalikan.
 */
export async function jalankanBroadcast(
  env: Env,
  data: { campaignId: number; template: string; nomor: string[]; gambarUrl: string | null },
): Promise<HasilBroadcast> {
  // Lokal/dev sengaja tidak punya URL & rahasia n8n -- ini keadaan normal, bukan galat.
  if (!env.N8N_BC_URL || !env.N8N_BC_SECRET) {
    return { ok: false, pesan: 'n8n_belum_dikonfigurasi' }
  }

  let res: Response
  try {
    res = await fetch(env.N8N_BC_URL, {
      method: 'POST',
      headers: {
        'X-BC-Secret': env.N8N_BC_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaignId: data.campaignId,
        template: data.template,
        nomor: data.nomor,
        // n8n yang menyusun components header image ke Graph API saat mengirim --
        // CRM cuma menentukan gambar mana yang dipakai.
        gambar_url: data.gambarUrl,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Timeout atau jaringan putus.
    return { ok: false, pesan: 'gagal_menghubungi_n8n' }
  }

  if (!res.ok) {
    const teks = await res.text()
    let terurai: ResponN8nGagal | null = null
    try {
      terurai = teks ? (JSON.parse(teks) as ResponN8nGagal) : null
    } catch {
      // biarkan null -- ditangani lewat pesan bawaan di bawah
    }
    const pesan = terurai?.error ?? terurai?.pesan ?? 'n8n_menolak_permintaan'
    return { ok: false, pesan: samarkanNomor(pesan) }
  }

  return { ok: true }
}
