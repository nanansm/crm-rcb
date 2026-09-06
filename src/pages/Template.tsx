import { useEffect, useState } from 'react'
import Pilih from '../komponen/Pilih'

type Template = { nama: string; bahasa: string; kategori?: string; status?: string; isi?: string }

const CONTOH_ISI =
  'Halo {{1}}, ada penawaran menginap di Rancabango minggu ini. Balas pesan ini kalau mau tanya jadwal.'

export default function TemplatePage() {
  const [siap, setSiap] = useState<Template[]>([])
  const [menunggu, setMenunggu] = useState<Template[]>([])
  const [metaSiap, setMetaSiap] = useState(true)
  const [nama, setNama] = useState('')
  const [isi, setIsi] = useState(CONTOH_ISI)
  const [kategori, setKategori] = useState('MARKETING')
  const [gambarUrl, setGambarUrl] = useState('')
  const [gambarRusak, setGambarRusak] = useState(false)
  const [pesan, setPesan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [versi, setVersi] = useState(0)

  useEffect(() => {
    fetch('/api/template')
      .then((r) => r.json())
      .then(
        (d: {
          template?: Template[]
          menunggu?: Template[]
          meta_belum_dikonfigurasi?: boolean
        }) => {
          setSiap(d.template ?? [])
          setMenunggu(d.menunggu ?? [])
          setMetaSiap(!d.meta_belum_dikonfigurasi)
        },
      )
      .catch(() => setSiap([]))
  }, [versi])

  async function ajukan() {
    setSibuk(true)
    setPesan('')
    try {
      const res = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: nama.trim(),
          bahasa: 'id',
          kategori,
          isi,
          gambar_url: gambarUrl.trim() || undefined,
        }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; pesan?: string } | null
      if (!res.ok) {
        setPesan(d?.pesan || d?.error || 'Template gagal diajukan.')
        return
      }
      setPesan('Template diajukan. Meta biasanya menjawab dalam hitungan menit sampai jam.')
      setNama('')
      setVersi((n) => n + 1)
    } finally {
      setSibuk(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Template</h1>

      {!metaSiap ? (
        <p className="kartu p-4 text-sm text-warn">
          Kredensial Meta belum dipasang di lingkungan ini. Daftar template kosong dan pengajuan akan
          ditolak sampai kredensialnya terpasang.
        </p>
      ) : null}

      <div className="kartu space-y-4 p-5">
        <p className="font-medium text-ink">Ajukan template baru</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="nama" className="text-sm font-medium text-ink">
              Nama
            </label>
            <input
              id="nama"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="promo_menginap_akhir_pekan"
              className="kolom-isian"
            />
            <p className="text-xs text-ink-soft">Huruf kecil, angka, dan garis bawah saja.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="kategori" className="text-sm font-medium text-ink">
              Kategori
            </label>
            <Pilih
              id="kategori"
              nilai={kategori}
              onPilih={setKategori}
              opsi={[
                { nilai: 'MARKETING', label: 'MARKETING', catatan: 'Promo dan penawaran' },
                { nilai: 'UTILITY', label: 'UTILITY', catatan: 'Konfirmasi, pengingat, info pesanan' },
              ]}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="isi" className="text-sm font-medium text-ink">
            Isi pesan
          </label>
          <textarea
            id="isi"
            rows={4}
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            className="kolom-isian resize-none"
          />
          <p className="text-xs text-ink-soft">
            Tombol tautan ke wa.me ditolak Meta. Pakai tombol balasan cepat kalau butuh tombol.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="gambarUrl" className="text-sm font-medium text-ink">
            Gambar header (opsional)
          </label>
          <input
            id="gambarUrl"
            type="url"
            value={gambarUrl}
            onChange={(e) => {
                // Alamat baru: gambar lama belum tentu masih rusak, coba muat lagi.
                setGambarUrl(e.target.value)
                setGambarRusak(false)
              }}
            placeholder="https://…/promo.jpg"
            className="kolom-isian"
          />
          <p className="text-xs text-ink-soft">
            Isi kalau promo ini pakai gambar. Wajib https dan bisa dibuka publik.
          </p>
          {gambarUrl && !gambarRusak ? (
            <img
              src={gambarUrl}
              onError={() => setGambarRusak(true)}
              className="mt-2 max-h-40 rounded-xl border border-line"
              alt=""
            />
          ) : null}
        </div>

        {pesan ? <p className="text-sm text-ink">{pesan}</p> : null}

        <button type="button" disabled={sibuk || !nama.trim()} onClick={ajukan} className="tombol tombol-utama">
          Ajukan ke Meta
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="kartu p-5">
          <p className="font-medium text-ink">Siap dipakai</p>
          {siap.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">Belum ada template yang disetujui.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {siap.map((t) => (
                <li key={t.nama} className="border-t border-line pt-2 text-sm first:border-0 first:pt-0">
                  <p className="text-ink">{t.nama}</p>
                  <p className="text-xs text-ink-soft">{t.bahasa}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="kartu p-5">
          <p className="font-medium text-ink">Belum bisa dipakai</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            Template yang menunggu peninjauan, ditolak, atau dijeda Meta. Yang dijeda tetap muncul di
            daftar Meta tapi ditolak saat dipakai kirim.
          </p>
          {menunggu.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Tidak ada.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {menunggu.map((t) => (
                <li key={t.nama} className="border-t border-line pt-2 text-sm first:border-0 first:pt-0">
                  <p className="text-ink">{t.nama}</p>
                  <p className="text-xs text-ink-soft">{t.status}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
