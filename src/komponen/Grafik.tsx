export type TitikGrafik = { tanggal: string; terkirim: number; sampai: number }

const LEBAR = 800
const TINGGI = 200

/** '2026-09-05' -> '5/9'. Label sumbu, bukan tanggal lengkap: ruangnya sempit. */
function labelTanggal(iso: string): string {
  const [, bulan, hari] = iso.split('-')
  return `${Number(hari)}/${Number(bulan)}`
}

function garis(titik: TitikGrafik[], ambil: (t: TitikGrafik) => number, puncak: number): string {
  const langkah = titik.length > 1 ? LEBAR / (titik.length - 1) : 0
  return titik
    .map((t, i) => {
      const x = titik.length > 1 ? i * langkah : LEBAR / 2
      const y = TINGGI - (ambil(t) / puncak) * TINGGI
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * Grafik garis tanpa pustaka luar. Dua garis saja -- terkirim dan sampai --
 * karena selisih keduanya yang menandakan masalah pengiriman, dan sisanya cuma
 * menambah tinta. `preserveAspectRatio="none"` merentang grafik selebar kartu;
 * `vector-effect` menahan tebal garis supaya tidak ikut melar.
 */
export default function Grafik({ titik }: { titik: TitikGrafik[] }) {
  if (titik.length < 2) {
    return (
      <p className="text-sm text-ink-soft">
        Meta baru punya {titik.length === 0 ? 'nol hari' : 'satu hari'} data untuk nomor ini. Grafik muncul
        setelah ada minimal dua hari.
      </p>
    )
  }

  const puncak = Math.max(1, ...titik.map((t) => Math.max(t.terkirim, t.sampai)))
  const tengah = titik[Math.floor(titik.length / 2)]

  return (
    <div>
      <svg
        viewBox={`0 0 ${LEBAR} ${TINGGI}`}
        preserveAspectRatio="none"
        className="h-52 w-full"
        role="img"
        aria-label={`Lalu lintas pesan ${titik.length} hari, puncak ${puncak} pesan sehari`}
      >
        <line
          x1="0"
          y1={TINGGI}
          x2={LEBAR}
          y2={TINGGI}
          stroke="var(--color-line)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={garis(titik, (t) => t.terkirim, puncak)}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={garis(titik, (t) => t.sampai, puncak)}
          fill="none"
          stroke="var(--color-pine)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex justify-between text-xs text-ink-soft">
        <span>{labelTanggal(titik[0].tanggal)}</span>
        <span>{labelTanggal(tengah.tanggal)}</span>
        <span>{labelTanggal(titik[titik.length - 1].tanggal)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full bg-gold" />
          Terkirim
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full bg-pine" />
          Sampai ke HP tamu
        </span>
        <span>Puncak {puncak} pesan sehari</span>
      </div>
    </div>
  )
}
