import { useEffect, useRef, useState } from 'react'

const DURASI_MS = 3000

/**
 * Tombol yang harus ditahan tiga detik. Sengaja bukan ketukan biasa: sekali
 * ditekan, ratusan pesan berbayar terkirim ke tamu sungguhan dan tidak ada
 * tombol batal di sisi Meta. Jeda niat ini yang menahan kepencet tak sengaja.
 * Jalan dengan sentuhan/tetikus (pointer event) dan papan ketik (spasi/enter).
 */
export default function TahanKirim({
  label,
  onSelesai,
  disabled,
}: {
  label: string
  onSelesai: () => void
  disabled?: boolean
}) {
  const [persen, setPersen] = useState(0)
  const [menahan, setMenahan] = useState(false)
  const frame = useRef<number | null>(null)
  const mulaiPada = useRef(0)
  const sudahSelesai = useRef(false)

  function berhenti() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setMenahan(false)
    setPersen(0)
  }

  function mulai() {
    if (disabled || frame.current !== null) return
    sudahSelesai.current = false
    setMenahan(true)
    mulaiPada.current = performance.now()

    const langkah = (sekarang: number) => {
      const p = Math.min(100, ((sekarang - mulaiPada.current) / DURASI_MS) * 100)
      setPersen(p)
      if (p >= 100) {
        frame.current = null
        sudahSelesai.current = true
        setMenahan(false)
        onSelesai()
        return
      }
      frame.current = requestAnimationFrame(langkah)
    }
    frame.current = requestAnimationFrame(langkah)
  }

  function lepas() {
    // Jari diangkat SETELAH batang penuh bukan pembatalan -- kirim sudah jalan.
    if (!sudahSelesai.current) berhenti()
  }

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={mulai}
      onPointerUp={lepas}
      onPointerCancel={lepas}
      onPointerLeave={lepas}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) mulai()
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') lepas()
      }}
      className="tombol tombol-utama relative touch-none select-none overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-black/20"
        style={{ width: `${persen}%`, transition: menahan ? 'none' : 'width 150ms ease-out' }}
      />
      <span className="relative">{menahan ? 'Tahan terus…' : label}</span>
    </button>
  )
}
