import { guard, json, type Env } from '../../../_lib/auth'
import { kirimTeks } from '../../../_lib/meta'
import { simpanPesan } from '../../../_lib/pesan'

const JENDELA_MS = 24 * 60 * 60 * 1000
const MAKS_PANJANG_TEKS = 4096

interface BarisKontakPercakapan {
  opt_out: number
  terakhir_pesan_masuk: string | null
  status_agent: string | null
}

interface BodyBalas {
  teks?: unknown
}

// Balasan manual staf. Dipakai saat percakapan sudah diambil alih dari agent.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const nomor = typeof params.nomor === 'string' ? params.nomor : Array.isArray(params.nomor) ? params.nomor[0] : ''
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  let body: BodyBalas
  try {
    body = await request.json()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const teks = typeof body.teks === 'string' ? body.teks : ''
  if (teks.trim() === '') return json({ error: 'teks_kosong' }, { status: 400 })
  if (teks.length > MAKS_PANJANG_TEKS) return json({ error: 'teks_terlalu_panjang' }, { status: 400 })

  const baris = await env.DB.prepare(
    `SELECT
       k.opt_out AS opt_out,
       k.terakhir_pesan_masuk AS terakhir_pesan_masuk,
       p.status_agent AS status_agent
     FROM kontak k
     LEFT JOIN percakapan p ON p.nomor = k.nomor
     WHERE k.nomor = ?`,
  )
    .bind(nomor)
    .first<BarisKontakPercakapan>()

  if (!baris) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  if (baris.opt_out) return json({ error: 'opt_out' }, { status: 409 })

  // Balasan manual cuma boleh saat staf memegang percakapan -- kalau agent masih
  // aktif, staf dan agent bisa menjawab bersamaan ke tamu yang sama.
  if (baris.status_agent !== 'diambil_alih') {
    return json({ error: 'belum_diambil_alih', pesan: 'Percakapan belum diambil alih dari agent' }, { status: 409 })
  }

  const masuk = baris.terakhir_pesan_masuk ? new Date(baris.terakhir_pesan_masuk).getTime() : null
  const dalamJendela = masuk !== null && Date.now() - masuk < JENDELA_MS
  if (!dalamJendela) return json({ error: 'di_luar_jendela' }, { status: 409 })

  // Kirim ke Meta DULU, baru simpan ke D1. Kalau urutan dibalik dan pengiriman
  // gagal, riwayat akan memuat pesan yang sebenarnya tidak pernah sampai ke tamu.
  const hasilKirim = await kirimTeks(env, { ke: nomor, teks })
  if (!hasilKirim.ok) {
    return json({ error: 'gagal_kirim', pesan: hasilKirim.pesan }, { status: 502 })
  }

  const waktu = new Date().toISOString()
  await simpanPesan(env, {
    nomor,
    arah: 'keluar',
    pengirim: 'staf',
    teks,
    wamid: hasilKirim.wamid,
    waktu,
  })

  await env.DB.prepare('UPDATE percakapan SET terakhir_pesan_pada = ? WHERE nomor = ?').bind(waktu, nomor).run()

  return json({ ok: true, wamid: hasilKirim.wamid })
}
