import { useMemo, useState } from 'react'

export type TagRingkas = { id: number; nama: string; jumlah_kontak: number }

const TAMPIL_AWAL = 10

/**
 * Pemilih tag yang tidak menumpahkan seluruh daftar ke layar. Hotel yang sudah
 * jalan setahun gampang punya puluhan tag; menampilkan semuanya sekaligus
 * membuat halaman Kontak dan Broadcast jadi dinding chip yang tidak terbaca.
 * Yang terpilih selalu di depan, sisanya di balik satu klik.
 */
export default function PilihTag({
  tag,
  terpilih,
  onUbah,
  kosong = 'Belum ada tag.',
}: {
  tag: TagRingkas[]
  terpilih: number[]
  onUbah: (idBaru: number[]) => void
  kosong?: string
}) {
  const [cari, setCari] = useState('')
  const [semua, setSemua] = useState(false)

  const urut = useMemo(() => {
    const kunci = cari.trim().toLowerCase()
    const cocok = kunci ? tag.filter((t) => t.nama.toLowerCase().includes(kunci)) : tag
    // Tag yang sedang dipakai menyaring tidak boleh hilang dari layar hanya
    // karena kata pencarian berubah -- staf jadi tidak tahu filter apa yang aktif.
    return [...cocok].sort((a, b) => {
      const aPilih = terpilih.includes(a.id) ? 0 : 1
      const bPilih = terpilih.includes(b.id) ? 0 : 1
      if (aPilih !== bPilih) return aPilih - bPilih
      return b.jumlah_kontak - a.jumlah_kontak
    })
  }, [tag, terpilih, cari])

  const tampil = semua || cari.trim() ? urut : urut.slice(0, TAMPIL_AWAL)
  const sisa = urut.length - tampil.length

  function jungkit(id: number) {
    onUbah(terpilih.includes(id) ? terpilih.filter((x) => x !== id) : [...terpilih, id])
  }

  if (tag.length === 0) return <p className="text-sm text-ink-soft">{kosong}</p>

  return (
    <div className="space-y-2">
      {tag.length > TAMPIL_AWAL ? (
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder={`Cari di ${tag.length} tag`}
          className="kolom-isian w-full max-w-xs text-sm"
        />
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {tampil.map((t) => {
          const aktif = terpilih.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => jungkit(t.id)}
              className={
                'rounded-full border px-3 py-1 text-sm transition-colors ' +
                (aktif
                  ? 'border-teal bg-teal text-white'
                  : 'border-line bg-white text-ink hover:border-teal hover:text-teal-deep')
              }
            >
              {t.nama}
              <span className={aktif ? 'ml-1.5 text-white/70' : 'ml-1.5 text-ink-soft'}>
                {t.jumlah_kontak}
              </span>
            </button>
          )
        })}

        {sisa > 0 ? (
          <button
            type="button"
            onClick={() => setSemua(true)}
            className="rounded-full border border-line bg-white px-3 py-1 text-sm text-ink-soft hover:border-teal hover:text-teal-deep"
          >
            +{sisa} tag lagi
          </button>
        ) : null}

        {semua && !cari.trim() && urut.length > TAMPIL_AWAL ? (
          <button
            type="button"
            onClick={() => setSemua(false)}
            className="rounded-full border border-line bg-white px-3 py-1 text-sm text-ink-soft hover:border-teal hover:text-teal-deep"
          >
            Ringkas lagi
          </button>
        ) : null}
      </div>

      {terpilih.length > 0 ? (
        <button
          type="button"
          onClick={() => onUbah([])}
          className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          Kosongkan {terpilih.length} tag terpilih
        </button>
      ) : null}
    </div>
  )
}
