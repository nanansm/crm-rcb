import type { ReactNode } from 'react'

export type TombolPratinjau = { teks: string; tipe: 'situs' | 'balasan' }

/**
 * Ubah teks WhatsApp jadi elemen React. Cuma dua format yang dikenal WhatsApp:
 * `*tebal*` dan `_miring_`. Tanpa pustaka dan tanpa HTML mentah -- teksnya
 * dibedah manual lalu dirender sebagai elemen biasa, jadi isian staf tidak
 * pernah bisa menyuntik markup.
 */
function renderTeksWhatsapp(teks: string): ReactNode[] {
  return teks.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((bagian, i) => {
    if (bagian.length > 2 && bagian.startsWith('*') && bagian.endsWith('*')) {
      return <strong key={i}>{bagian.slice(1, -1)}</strong>
    }
    if (bagian.length > 2 && bagian.startsWith('_') && bagian.endsWith('_')) {
      return <em key={i}>{bagian.slice(1, -1)}</em>
    }
    return bagian
  })
}

/**
 * Tiruan gelembung pesan WhatsApp. Ini satu-satunya cara staf melihat hasil
 * tulisannya sebelum template diajukan, dan pengajuan ke Meta tidak bisa
 * dibatalkan, jadi tampilannya sengaja dibuat semirip mungkin dengan layar tamu.
 */
export default function GelembungWa({
  isi,
  footer,
  gambarUrl,
  tombol,
}: {
  isi: string
  footer: string
  gambarUrl: string
  tombol: TombolPratinjau[]
}) {
  return (
    <div className="rounded-2xl bg-[#0b141a] p-3">
      <div className="mx-auto max-w-[320px] overflow-hidden rounded-2xl rounded-tl-sm bg-[#e7f8d8] shadow-sm">
        {gambarUrl ? <img src={gambarUrl} alt="" className="w-full" /> : null}
        <div className="px-3 pt-3 pb-2">
          <p className="text-[13.5px] leading-snug whitespace-pre-wrap text-slate-800">
            {renderTeksWhatsapp(isi)}
          </p>
          {footer ? <p className="mt-1.5 text-[11px] text-slate-500">{footer}</p> : null}
        </div>
        {tombol.map((t, i) => (
          <div
            key={i}
            className="flex min-h-[40px] items-center justify-center border-t border-black/5 text-[13.5px] font-medium text-[#00a5f4]"
          >
            {t.teks}
          </div>
        ))}
      </div>
    </div>
  )
}
