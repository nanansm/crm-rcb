import { guard, json, type Env } from '../../_lib/auth'
import { sisaKuota, targetSegmen } from '../../_lib/kuota'
import { nomorUji } from '../../_lib/uji'

// Pratinjau segmen SEBELUM staf menekan kirim broadcast — endpoint ini
// cuma membaca, tidak boleh menulis apa pun ke database.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const hasil = await guard(request, env)
  if (!hasil.ok) return json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const tagIds = url.searchParams
    .getAll('tag')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v))

  const daftarId = (url.searchParams.get('daftar') ?? '').trim() || null

  const maksMentah = url.searchParams.get('maks')
  const maksParsed = maksMentah !== null ? Number(maksMentah) : undefined

  // maks = -1 berarti mode uji: satu pesan ke nomor uji, tidak ada tamu yang
  // menerima. Dijawab tanpa menyentuh segmen sama sekali supaya angkanya tidak
  // pernah tercampur dengan hitungan tamu sungguhan.
  if (maksParsed === -1) {
    const kuota = await sisaKuota(env)
    return json({
      uji: true,
      nomor_uji: nomorUji(env),
      total_cocok: 0,
      akan_dikirim: 1,
      sisa_kuota: kuota.sisa,
      terpakai_kuota: kuota.terpakai,
      dibuang_opt_out: 0,
      dibuang_baru_dibc: 0,
      dipotong_kuota: 0,
    })
  }

  // maks = 0 dari layar preset berarti "semua tamu", jadi diteruskan sebagai
  // undefined; targetSegmen memperlakukan 0 sebagai batas nol pesan.
  const maks =
    maksParsed !== undefined && Number.isFinite(maksParsed) && maksParsed > 0 ? maksParsed : undefined

  const [segmen, kuota] = await Promise.all([
    targetSegmen(env, { tagIds, maks, daftarId }),
    sisaKuota(env),
  ])

  return json({
    uji: false,
    total_cocok: segmen.total_cocok,
    akan_dikirim: segmen.nomor.length,
    sisa_kuota: kuota.sisa,
    terpakai_kuota: kuota.terpakai,
    dibuang_opt_out: segmen.dibuang_opt_out,
    dibuang_baru_dibc: segmen.dibuang_baru_dibc,
    dipotong_kuota: segmen.dipotong_kuota,
  })
}
