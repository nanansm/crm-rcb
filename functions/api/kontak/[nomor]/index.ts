import { guard, json, type Env } from '../../../_lib/auth'

interface BarisKontak {
  nomor: string
  nama: string | null
  catatan: string | null
  opt_out: number
  opt_out_pada: string | null
  terakhir_bc: string | null
  terakhir_pesan_masuk: string | null
  dibuat: string
}

interface BarisTag {
  id: number
  nama: string
  warna: string | null
}

interface BodyPatch {
  nama?: string | null
  catatan?: string | null
  opt_out?: boolean | number
}

function ambilNomor(params: Record<string, string | string[]>): string {
  const nomor = params.nomor
  return typeof nomor === 'string' ? nomor : Array.isArray(nomor) ? nomor[0] : ''
}

async function ambilTagKontak(env: Env, nomor: string): Promise<BarisTag[]> {
  const hasil = await env.DB.prepare(
    `SELECT t.id AS id, t.nama AS nama, t.warna AS warna
     FROM tag t
     JOIN kontak_tag kt ON kt.tag_id = t.id
     WHERE kt.kontak_nomor = ?
     ORDER BY t.nama`,
  )
    .bind(nomor)
    .all<BarisTag>()
  return hasil.results ?? []
}

// Detail satu kontak + tag terpasang. Dipakai panel kontak di Inbox.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = ambilNomor(params)
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const baris = await env.DB.prepare(
    `SELECT nomor, nama, catatan, opt_out, opt_out_pada, terakhir_bc, terakhir_pesan_masuk, dibuat
     FROM kontak WHERE nomor = ?`,
  )
    .bind(nomor)
    .first<BarisKontak>()

  if (!baris) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  const tag = await ambilTagKontak(env, nomor)

  return json({
    nomor: baris.nomor,
    nama: baris.nama,
    catatan: baris.catatan,
    opt_out: baris.opt_out,
    opt_out_pada: baris.opt_out_pada,
    terakhir_bc: baris.terakhir_bc,
    terakhir_pesan_masuk: baris.terakhir_pesan_masuk,
    dibuat: baris.dibuat,
    tag,
  })
}

// Ubah nama/catatan/opt_out kontak. Cuma field yang benar-benar dikirim yang disentuh.
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const nomor = ambilNomor(params)
  if (!nomor) return json({ error: 'nomor_kosong' }, { status: 400 })

  const hasilGuard = await guard(request, env)
  if (!hasilGuard.ok) return json({ error: 'unauthorized' }, { status: 401 })

  let body: BodyPatch
  try {
    body = (await request.json()) as BodyPatch
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const kolomDikirim = ['nama', 'catatan', 'opt_out'].filter((kunci) =>
    Object.prototype.hasOwnProperty.call(body, kunci),
  )
  if (kolomDikirim.length === 0) return json({ error: 'body_kosong' }, { status: 400 })

  const kontakSekarang = await env.DB.prepare('SELECT nomor, opt_out FROM kontak WHERE nomor = ?')
    .bind(nomor)
    .first<{ nomor: string; opt_out: number }>()
  if (!kontakSekarang) return json({ error: 'tidak_ditemukan' }, { status: 404 })

  const sekarang = new Date().toISOString()
  const setKlausa: string[] = []
  const nilai: unknown[] = []

  if (kolomDikirim.includes('nama')) {
    setKlausa.push('nama = ?')
    nilai.push(body.nama ?? null)
  }
  if (kolomDikirim.includes('catatan')) {
    setKlausa.push('catatan = ?')
    nilai.push(body.catatan ?? null)
  }

  let optOutBerubah = false
  let optOutBaru = kontakSekarang.opt_out
  if (kolomDikirim.includes('opt_out')) {
    optOutBaru = body.opt_out ? 1 : 0
    optOutBerubah = optOutBaru !== kontakSekarang.opt_out
    setKlausa.push('opt_out = ?')
    nilai.push(optOutBaru)
    setKlausa.push('opt_out_pada = ?')
    nilai.push(optOutBaru ? sekarang : null)
  }

  setKlausa.push('diperbarui = ?')
  nilai.push(sekarang)

  nilai.push(nomor)
  await env.DB.prepare(`UPDATE kontak SET ${setKlausa.join(', ')} WHERE nomor = ?`)
    .bind(...nilai)
    .run()

  if (optOutBerubah) {
    await env.DB.prepare('INSERT INTO opt_out_log (nomor, sumber, waktu) VALUES (?, ?, ?)')
      .bind(nomor, 'staf', sekarang)
      .run()
  }

  return json({ ok: true })
}
