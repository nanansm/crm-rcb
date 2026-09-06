import { useRef, useState, type ChangeEvent } from 'react'

/**
 * Pemilih gambar promo. Staf memilih file dari HP/laptop; alamatnya yang muncul
 * di kolom hanya dipakai sebagai penanda, bukan sesuatu yang perlu mereka ketik.
 * Kolom alamat manual tetap disediakan untuk gambar yang sudah terlanjur ada di
 * tempat lain.
 */
export default function UnggahGambar({
  nilai,
  onUbah,
  wajib,
}: {
  nilai: string
  onUbah: (url: string) => void
  wajib?: boolean
}) {
  const [mengunggah, setMengunggah] = useState(false)
  const [galat, setGalat] = useState('')
  const [manual, setManual] = useState(false)
  const inputFile = useRef<HTMLInputElement>(null)

  async function pilih(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setGalat('')
    setMengunggah(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/unggah', { method: 'POST', body: form })
      const d = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!res.ok || !d?.url) {
        throw new Error(
          d?.error === 'penyimpanan_belum_dikonfigurasi' || d?.error === 'domain_media_belum_dikonfigurasi'
            ? 'Penyimpanan gambar belum dipasang di server ini.'
            : d?.error || 'Gambar gagal diunggah.',
        )
      }
      onUbah(d.url)
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gambar gagal diunggah.')
    } finally {
      setMengunggah(false)
      if (inputFile.current) inputFile.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">
        {wajib ? 'Gambar (wajib untuk template ini)' : 'Gambar promo'}{' '}
        {wajib ? null : <span className="text-ink-soft">(boleh kosong)</span>}
      </p>

      <input
        id="gambar-file"
        ref={inputFile}
        type="file"
        accept="image/jpeg,image/png"
        onChange={pilih}
        disabled={mengunggah}
        className="w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-teal/10 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-teal"
      />
      <p className="text-xs text-ink-soft">JPG atau PNG, maksimal 5 MB. Meta menolak jenis lain.</p>

      {mengunggah ? <p className="text-sm text-ink-soft">Mengunggah gambar…</p> : null}
      {galat ? <p className="text-sm text-bad">{galat}</p> : null}

      {nilai ? (
        <div className="flex items-center gap-3 rounded-lg border border-line p-2">
          <img src={nilai} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
          <p className="min-w-0 flex-1 truncate text-xs text-ink-soft">{nilai}</p>
          <button
            type="button"
            onClick={() => onUbah('')}
            className="shrink-0 text-xs font-semibold text-bad"
          >
            Hapus
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setManual((m) => !m)}
        className="text-xs font-medium text-ink-soft underline"
      >
        {manual ? 'Sembunyikan alamat gambar' : 'Punya alamat gambar sendiri?'}
      </button>

      {manual ? (
        <input
          id="gambar-url"
          type="url"
          value={nilai}
          onChange={(e) => onUbah(e.target.value)}
          placeholder="https://…"
          className="kolom-isian"
        />
      ) : null}
    </div>
  )
}
