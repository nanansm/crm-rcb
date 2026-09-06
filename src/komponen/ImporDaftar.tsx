import { useRef, useState, type ChangeEvent } from 'react'
import { bacaBaris, bacaCsv, type HasilBaca } from '../lib/nomor'

// Tiap nomor jadi DUA statement D1 (upsert kontak + tautan ke daftar), jadi
// potongan 200 berarti 400 statement per batch -- masih jauh di bawah batas
// D1.batch, sedangkan 500 nomor sudah 1.000 statement dan rawan ditolak.
const POTONGAN = 200
const angka = (n: number) => new Intl.NumberFormat('id-ID').format(n)

export type DaftarRingkas = {
  id: string
  nama: string
  keterangan: string
  jumlah: number
  dibuat: string
}

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 pr-3 text-ink-soft">{label}</td>
      <td className="py-1.5 text-right font-semibold text-ink">{nilai}</td>
    </tr>
  )
}

/**
 * Unggah ekspor reservasi jadi satu daftar tamu yang bisa dipilih di Broadcast.
 * Filenya dibaca di perangkat staf; yang dikirim ke server cuma nomor yang sudah
 * lolos normalisasi, bukan seluruh isi ekspor PMS.
 */
export default function ImporDaftar({ onSelesai }: { onSelesai: () => void }) {
  const [nama, setNama] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [membaca, setMembaca] = useState(false)
  const [galatBaca, setGalatBaca] = useState('')
  const [hasil, setHasil] = useState<HasilBaca | null>(null)

  const [menyimpan, setMenyimpan] = useState(false)
  const [progres, setProgres] = useState<{ dikirim: number; total: number } | null>(null)
  const [galatSimpan, setGalatSimpan] = useState('')
  const [sukses, setSukses] = useState('')
  const inputFile = useRef<HTMLInputElement>(null)

  async function pilihFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setGalatBaca('')
    setGalatSimpan('')
    setSukses('')
    setHasil(null)
    setMembaca(true)
    try {
      let rows: Record<string, unknown>[]
      if (/\.csv$/i.test(file.name)) {
        // CSV dibaca sendiri: memuat pustaka spreadsheet 800 KB untuk file teks
        // biasa membuat halaman ini berat tanpa alasan.
        rows = bacaCsv(await file.text())
      } else {
        // Impor dinamis supaya `xlsx` tidak ikut terbawa di muatan awal aplikasi.
        const XLSX = await import('xlsx')
        const buku = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const sheet = buku.Sheets[buku.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      }
      setHasil(bacaBaris(rows))
      if (nama.trim() === '') setNama(file.name.replace(/\.[^.]+$/, '').slice(0, 60))
    } catch (err) {
      setGalatBaca(err instanceof Error ? err.message : 'File tidak terbaca.')
    } finally {
      setMembaca(false)
    }
  }

  function periksaForm(): string | null {
    const n = nama.trim()
    if (n.length < 3) return 'Nama daftar terlalu pendek, minimal 3 huruf.'
    if (n.length > 60) return 'Nama daftar maksimal 60 huruf.'
    if (keterangan.trim().length > 120) return 'Keterangan maksimal 120 huruf.'
    return null
  }

  async function simpan() {
    if (!hasil) return
    const salah = periksaForm()
    if (salah) {
      setGalatSimpan(salah)
      return
    }

    setGalatSimpan('')
    setMenyimpan(true)
    setProgres({ dikirim: 0, total: hasil.nomor.length })

    try {
      const resMulai = await fetch('/api/daftar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'mulai', nama: nama.trim(), keterangan: keterangan.trim() }),
      })
      const dataMulai = (await resMulai.json()) as { id?: string; error?: string }
      if (!resMulai.ok || !dataMulai.id) throw new Error(dataMulai.error || 'Gagal membuat daftar.')
      const id = dataMulai.id

      // Dipecah per 500 nomor. Gagal di tengah meninggalkan daftar dengan siap=0
      // di server, dan daftar seperti itu tidak pernah muncul di pilihan Broadcast.
      for (let i = 0; i < hasil.nomor.length; i += POTONGAN) {
        const potongan = hasil.nomor.slice(i, i + POTONGAN)
        const res = await fetch('/api/daftar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aksi: 'tambah', id, nomor: potongan }),
        })
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(d.error || 'Gagal menyimpan nomor.')
        }
        setProgres({ dikirim: Math.min(i + POTONGAN, hasil.nomor.length), total: hasil.nomor.length })
      }

      const resSelesai = await fetch('/api/daftar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'selesai', id }),
      })
      const dataSelesai = (await resSelesai.json()) as { jumlah?: number; error?: string }
      if (!resSelesai.ok) throw new Error(dataSelesai.error || 'Gagal mengunci daftar.')

      setSukses(
        `Daftar "${nama.trim()}" tersimpan dengan ${angka(dataSelesai.jumlah ?? 0)} nomor dan sudah bisa dipilih di Broadcast.`,
      )
      setNama('')
      setKeterangan('')
      setHasil(null)
      if (inputFile.current) inputFile.current.value = ''
      onSelesai()
    } catch (err) {
      setGalatSimpan(err instanceof Error ? err.message : 'Gagal menyimpan daftar.')
    } finally {
      setMenyimpan(false)
      setProgres(null)
    }
  }

  return (
    <div className="space-y-4">
      {sukses ? (
        <div className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ink">{sukses}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="daftarNama" className="mb-1 block text-sm font-medium text-ink">
            Nama daftar
          </label>
          <input
            id="daftarNama"
            value={nama}
            maxLength={60}
            onChange={(e) => setNama(e.target.value)}
            placeholder="Tamu menginap Juli–Agustus 2026"
            className="kolom-isian"
          />
        </div>
        <div>
          <label htmlFor="daftarKeterangan" className="mb-1 block text-sm font-medium text-ink">
            Keterangan <span className="text-ink-soft">(boleh kosong)</span>
          </label>
          <input
            id="daftarKeterangan"
            value={keterangan}
            maxLength={120}
            onChange={(e) => setKeterangan(e.target.value)}
            placeholder="Ekspor dari DIP, sudah check-out"
            className="kolom-isian"
          />
        </div>
      </div>

      <div>
        <label htmlFor="daftarFile" className="mb-1 block text-sm font-medium text-ink">
          File ekspor tamu (.xlsx / .xls / .csv)
        </label>
        <input
          id="daftarFile"
          ref={inputFile}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={pilihFile}
          className="w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-teal/10 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-teal"
        />
        <p className="mt-1 text-xs text-ink-soft">
          File dibaca di perangkat ini saja. Yang dikirim ke server cuma nomor yang sudah lolos periksa.
        </p>
      </div>

      {membaca ? <p className="text-sm text-ink-soft">Membaca file…</p> : null}

      {galatBaca ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-ink">{galatBaca}</div>
      ) : null}

      {hasil ? (
        <div className="space-y-3 rounded-lg border border-line p-4">
          <table className="w-full text-sm">
            <tbody>
              <Baris label="Kolom nomor yang dipakai" nilai={hasil.kolomNomor} />
              <Baris label="Kolom nama yang dipakai" nilai={hasil.kolomNama ?? '(tidak ada)'} />
              <Baris label="Baris di file" nilai={angka(hasil.barisFile)} />
              <Baris label="Nomor terbaca" nilai={angka(hasil.terbaca)} />
              <Baris label="Dobel di dalam file" nilai={angka(hasil.dobelDiFile)} />
              <Baris label="Format nomor rusak" nilai={angka(hasil.rusak)} />
              <Baris label="Kolom nomor kosong" nilai={angka(hasil.kosong)} />
            </tbody>
          </table>
          <p className="text-xs text-ink-soft">
            Periksa baris “kolom nomor yang dipakai”. Kalau kolomnya salah, ganti judul kolom di file jadi{' '}
            <span className="font-mono">nomor</span> lalu unggah lagi.
          </p>

          {galatSimpan ? (
            <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-ink">
              {galatSimpan}
            </div>
          ) : null}

          {progres ? (
            <p className="text-sm text-ink-soft">
              Menyimpan {angka(progres.dikirim)} dari {angka(progres.total)} nomor…
            </p>
          ) : null}

          <button
            type="button"
            onClick={simpan}
            disabled={menyimpan || hasil.terbaca === 0}
            className="tombol tombol-utama"
          >
            {menyimpan ? 'Menyimpan…' : 'Simpan daftar ini'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
