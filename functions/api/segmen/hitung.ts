import { guard, json, type Env } from '../../_lib/auth'
import { sisaKuota, targetSegmen } from '../../_lib/kuota'

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

  const maksMentah = url.searchParams.get('maks')
  const maksParsed = maksMentah !== null ? Number(maksMentah) : undefined
  const maks = maksParsed !== undefined && Number.isFinite(maksParsed) && maksParsed >= 0 ? maksParsed : undefined

  const [segmen, kuota] = await Promise.all([targetSegmen(env, { tagIds, maks }), sisaKuota(env)])

  return json({
    total_cocok: segmen.total_cocok,
    akan_dikirim: segmen.nomor.length,
    sisa_kuota: kuota.sisa,
    terpakai_kuota: kuota.terpakai,
    dibuang_opt_out: segmen.dibuang_opt_out,
    dibuang_baru_dibc: segmen.dibuang_baru_dibc,
    dipotong_kuota: segmen.dipotong_kuota,
  })
}
