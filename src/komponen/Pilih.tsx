import { useEffect, useRef, useState } from 'react'

export type OpsiPilih = { nilai: string; label: string; catatan?: string }

/**
 * Dropdown sendiri, bukan <select> bawaan. Alasannya bukan selera: <select>
 * bawaan tidak bisa menampilkan baris dua tingkat (nama + catatan), tidak bisa
 * dicari, dan tampilannya ditentukan sistem operasi — di Safari macOS jadi blok
 * abu-abu tebal yang bentrok dengan seluruh halaman.
 */
export default function Pilih({
  nilai,
  opsi,
  onPilih,
  placeholder = 'Pilih',
  id,
  nonaktif = false,
}: {
  nilai: string
  opsi: OpsiPilih[]
  onPilih: (nilai: string) => void
  placeholder?: string
  id?: string
  nonaktif?: boolean
}) {
  const [buka, setBuka] = useState(false)
  const [cari, setCari] = useState('')
  const [sorot, setSorot] = useState(0)
  const bungkus = useRef<HTMLDivElement | null>(null)

  const pakaiCari = opsi.length > 7
  const tersaring = pakaiCari
    ? opsi.filter((o) => o.label.toLowerCase().includes(cari.trim().toLowerCase()))
    : opsi

  const terpilih = opsi.find((o) => o.nilai === nilai)

  // Klik di luar menutup panel. Tanpa ini panel menggantung terus dan menutupi
  // kolom di bawahnya begitu staf pindah fokus.
  useEffect(() => {
    if (!buka) return
    function diLuar(e: MouseEvent) {
      if (bungkus.current && !bungkus.current.contains(e.target as Node)) tutup()
    }
    document.addEventListener('mousedown', diLuar)
    return () => document.removeEventListener('mousedown', diLuar)
  }, [buka])

  // Panel ditutup lewat aksi, bukan lewat effect: mengosongkan pencarian di
  // tempat kejadiannya menghindari render tambahan tiap kali panel berganti.
  function tutup() {
    setBuka(false)
    setCari('')
    setSorot(0)
  }

  function pilih(v: string) {
    onPilih(v)
    tutup()
  }

  function tombolPapanKetik(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      tutup()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!buka) {
        setBuka(true)
        return
      }
      setSorot((n) => {
        const arah = e.key === 'ArrowDown' ? 1 : -1
        const total = tersaring.length
        if (total === 0) return 0
        return (n + arah + total) % total
      })
      return
    }
    if (e.key === 'Enter' && buka) {
      e.preventDefault()
      const target = tersaring[sorot]
      if (target) pilih(target.nilai)
    }
  }

  return (
    <div ref={bungkus} className="relative" onKeyDown={tombolPapanKetik}>
      <button
        id={id}
        type="button"
        disabled={nonaktif}
        aria-haspopup="listbox"
        aria-expanded={buka}
        onClick={() => (buka ? tutup() : setBuka(true))}
        className="kolom-isian flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={terpilih ? 'truncate text-ink' : 'truncate text-ink-soft'}>
          {terpilih ? terpilih.label : placeholder}
        </span>
        <span aria-hidden className="shrink-0 text-ink-soft">
          {buka ? '▴' : '▾'}
        </span>
      </button>

      {buka ? (
        <div className="kartu absolute z-20 mt-1 w-full overflow-hidden p-0 shadow-lg">
          {pakaiCari ? (
            <div className="border-b border-line p-2">
              <input
                autoFocus
                value={cari}
                onChange={(e) => {
                  setCari(e.target.value)
                  setSorot(0)
                }}
                placeholder="Cari"
                className="kolom-isian w-full text-sm"
              />
            </div>
          ) : null}

          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {tersaring.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-ink-soft">Tidak ada yang cocok.</li>
            ) : (
              tersaring.map((o, i) => (
                <li key={o.nilai}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.nilai === nilai}
                    onMouseEnter={() => setSorot(i)}
                    onClick={() => pilih(o.nilai)}
                    className={
                      'w-full px-3 py-2.5 text-left transition-colors ' +
                      (i === sorot ? 'bg-canvas' : '') +
                      (o.nilai === nilai ? ' font-medium' : '')
                    }
                  >
                    <span className="block truncate text-sm text-ink">{o.label}</span>
                    {o.catatan ? (
                      <span className="mt-0.5 block truncate text-xs text-ink-soft">{o.catatan}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
