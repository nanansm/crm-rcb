import { guard, json, type Env } from '../../../_lib/auth'
import { kirimTemplate } from '../../../_lib/meta'
import { simpanPesan } from '../../../_lib/pesan'
import { ambilDaftarTemplateMeta, punyaVariabel, punyaHeaderGambar, type KomponenMeta } from '../../../_lib/template-meta'

interface BarisKontakPercakapan {
  opt_out: number
  status_agent: string | null
}

interface BodyKirimTemplate {
  template?: unknown
}

const POLA_NAMA_TEMPLATE = /^[a-z0-9_]{1,512}$/

// Kirim template WhatsApp buat buka ulang jendela 24 jam yang tutup. Beda dari
// balas.ts: TIDAK ada gerbang jendela -- template sah dikirim kapan pun menurut
// kebijakan WhatsApp. JANGAN sentuh kontak.terakhir_pesan_masuk di sini -- kolom
// itu jangkar jendela 24 jam dan cuma boleh bergeser dari pesan MASUK tamu asli;
// menyentuhnya dari jalur ini akan membuka jendela palsu.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const nomor = typeof params.nomor === 'string' ? params.nomor : Array.isArray(params.nomor) ? params.nomor[0] : ''
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  let body: BodyKirimTemplate
  try {
    body = await request.json()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const template = typeof body.template === 'string' ? body.template.trim() : ''
  if (!POLA_NAMA_TEMPLATE.test(template)) return json({ error: 'template_tidak_valid' }, { status: 400 })

  const baris = await env.DB.prepare(
    `SELECT
       k.opt_out AS opt_out,
       p.status_agent AS status_agent
     FROM kontak k
     LEFT JOIN percakapan p ON p.nomor = k.nomor
     WHERE k.nomor = ?`,
  )
    .bind(nomor)
    .first<BarisKontakPercakapan>()

  if (!baris) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  if (baris.opt_out) return json({ error: 'opt_out' }, { status: 409 })

  if (baris.status_agent !== 'diambil_alih') {
    return json({ error: 'belum_diambil_alih', pesan: 'Percakapan belum diambil alih dari agent' }, { status: 409 })
  }

  if (!env.META_TOKEN || !env.META_PHONE_ID || !env.META_WABA_ID) {
    return json({ error: 'gagal_kirim', pesan: 'meta_belum_dikonfigurasi' }, { status: 502 })
  }

  const daftar = await ambilDaftarTemplateMeta(env)
  if (!daftar.ok) return json({ error: daftar.pesan }, { status: daftar.status })

  const cocok = daftar.data.filter((t) => t.name === template)
  if (cocok.length === 0) return json({ error: 'template_tidak_ditemukan' }, { status: 400 })

  const siap = cocok.find((t) => t.status === 'APPROVED')
  if (!siap) return json({ error: 'template_belum_disetujui' }, { status: 400 })

  if (punyaVariabel(siap)) return json({ error: 'template_pakai_variabel' }, { status: 400 })
  if (punyaHeaderGambar(siap)) return json({ error: 'template_wajib_gambar' }, { status: 400 })

  const bahasa = siap.language ?? 'id'
  const bodyKomponen = (siap.components ?? []).find((k: KomponenMeta) => (k.type ?? '').toUpperCase() === 'BODY')
  const isi = bodyKomponen?.text ?? ''

  // Kirim ke Meta DULU, baru simpan ke D1 -- kalau dibalik dan pengiriman gagal,
  // riwayat memuat pesan yang sebenarnya tidak pernah sampai ke tamu.
  const hasilKirim = await kirimTemplate(env, { ke: nomor, nama: template, bahasa })
  if (!hasilKirim.ok) {
    return json({ error: 'gagal_kirim', pesan: hasilKirim.pesan }, { status: 502 })
  }

  const waktu = new Date().toISOString()
  await simpanPesan(env, {
    nomor,
    arah: 'keluar',
    pengirim: 'staf',
    teks: isi ? `[Template: ${template}]\n${isi}` : `[Template: ${template}]`,
    wamid: hasilKirim.wamid,
    waktu,
  })

  await env.DB.prepare('UPDATE percakapan SET terakhir_pesan_pada = ? WHERE nomor = ?').bind(waktu, nomor).run()

  return json({ ok: true, wamid: hasilKirim.wamid })
}
