import { guard, json, type Env } from '../_lib/auth'

// Meta menolak header gambar di luar dua jenis ini, jadi ditolak di sini juga --
// gagal saat unggah jauh lebih murah daripada gagal saat template diajukan.
const JENIS_SAH: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

// Batas Meta untuk gambar header template. Lewat ini unggahannya percuma.
const MAKS_BYTE = 5 * 1024 * 1024

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const sesi = await guard(request, env)
  if (!sesi.ok) return json({ error: 'unauthorized' }, { status: 401 })

  if (!env.MEDIA) return json({ error: 'penyimpanan_belum_dikonfigurasi' }, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'body_tidak_valid' }, { status: 400 })
  }

  const berkas = form.get('file')
  if (!(berkas instanceof File)) return json({ error: 'file_wajib' }, { status: 400 })

  const ext = JENIS_SAH[berkas.type]
  if (!ext) return json({ error: 'Gambar harus JPG atau PNG.' }, { status: 400 })
  if (berkas.size === 0) return json({ error: 'File kosong.' }, { status: 400 })
  if (berkas.size > MAKS_BYTE) return json({ error: 'Gambar maksimal 5 MB.' }, { status: 400 })

  // Nama file asli TIDAK dipakai sebagai kunci: dua staf mengunggah "promo.jpg"
  // akan saling menimpa, dan template yang sudah disetujui Meta ikut berubah
  // gambarnya tanpa ada yang tahu.
  const kunci = `promo/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`

  await env.MEDIA.put(kunci, berkas.stream(), {
    httpMetadata: {
      contentType: berkas.type,
      // Gambar tidak pernah ditimpa di kunci yang sama, jadi aman di-cache lama.
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  const dasar = (env.MEDIA_BASE_URL ?? '').replace(/\/+$/, '')
  if (!dasar) {
    // Objeknya sudah tersimpan, tapi tanpa domain publik URL-nya tidak bisa
    // disusun -- dan URL yang tidak bisa dibuka Meta lebih buruk daripada galat.
    return json({ error: 'domain_media_belum_dikonfigurasi', kunci }, { status: 503 })
  }

  return json({ url: `${dasar}/${kunci}`, kunci }, { status: 201 })
}
