import { useEffect, useRef, useState } from 'react'
import Pilih from '../komponen/Pilih'
import PilihTag from '../komponen/PilihTag'

type Tag = { id: number; nama: string; warna: string | null }
type TagHitung = Tag & { jumlah_kontak: number }

type Kontak = {
  nomor: string
  nama: string | null
  catatan: string | null
  opt_out: number
  terakhir_pesan_masuk: string | null
  dalam_jendela: boolean
  tag: Tag[]
}

const tanggal = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })

function labelTanggal(iso: string | null) {
  if (!iso) return 'Belum pernah chat'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : tanggal.format(d)
}

function KepingTag({ tag, onLepas }: { tag: Tag; onLepas?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink"
      style={tag.warna ? { borderColor: tag.warna } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: tag.warna || 'var(--color-teal)' }} />
      {tag.nama}
      {onLepas ? (
        <button type="button" onClick={onLepas} className="text-ink-soft hover:text-bad" aria-label={`Lepas tag ${tag.nama}`}>
          ×
        </button>
      ) : null}
    </span>
  )
}

export default function Kontak() {
  const [daftar, setDaftar] = useState<Kontak[]>([])
  const [total, setTotal] = useState(0)
  const [tag, setTag] = useState<TagHitung[]>([])
  const [cari, setCari] = useState('')
  const [saringTag, setSaringTag] = useState<number[]>([])
  const [dipilih, setDipilih] = useState<Kontak | null>(null)
  const [catatan, setCatatan] = useState('')
  const [tagBaru, setTagBaru] = useState('')
  const [galatDaftar, setGalatDaftar] = useState('')
  const [galatTagBaru, setGalatTagBaru] = useState('')
  const [memuat, setMemuat] = useState(true)
  const [versi, setVersi] = useState(0)

  // penanda "Tersimpan" sementara untuk catatan/tag/optout, dan galat per kontrol
  const [tersimpan, setTersimpan] = useState('')
  const [galatCatatan, setGalatCatatan] = useState('')
  const [galatTag, setGalatTag] = useState('')
  const [galatOptout, setGalatOptout] = useState('')
  const timeoutTersimpan = useRef<number | null>(null)

  useEffect(() => {
    // bersihkan timeout kalau komponen lepas sebelum 2 detik habis
    return () => {
      if (timeoutTersimpan.current) clearTimeout(timeoutTersimpan.current)
    }
  }, [])

  function tandaiTersimpan(nama: string) {
    setTersimpan(nama)
    if (timeoutTersimpan.current) clearTimeout(timeoutTersimpan.current)
    timeoutTersimpan.current = window.setTimeout(() => setTersimpan(''), 2000)
  }

  useEffect(() => {
    fetch('/api/tag')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
      .then((d: { tag: TagHitung[] }) => setTag(d.tag))
      .catch(() => setTag([]))
  }, [versi])

  useEffect(() => {
    let batal = false
    const t = setTimeout(() => {
      const q = new URLSearchParams()
      if (cari.trim()) q.set('cari', cari.trim())
      for (const id of saringTag) q.append('tag', String(id))
      fetch(`/api/kontak${q.toString() ? `?${q}` : ''}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
        .then((d: { kontak: Kontak[]; total: number }) => {
          if (batal) return
          setDaftar(d.kontak)
          setTotal(d.total)
          setGalatDaftar('')
        })
        .catch(() => !batal && setGalatDaftar('Daftar kontak gagal dimuat.'))
        .finally(() => !batal && setMemuat(false))
    }, 250)
    return () => {
      batal = true
      clearTimeout(t)
    }
  }, [cari, saringTag, versi])

  function pilih(k: Kontak) {
    setDipilih(k)
    setCatatan(k.catatan ?? '')
  }

  async function simpanCatatan() {
    if (!dipilih) return
    const res = await fetch(`/api/kontak/${encodeURIComponent(dipilih.nomor)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catatan }),
    })
    if (res.ok) {
      setGalatCatatan('')
      tandaiTersimpan('catatan')
      setVersi((n) => n + 1)
    } else {
      setGalatCatatan('Catatan gagal disimpan. Isinya belum tersimpan.')
    }
  }

  async function ubahOptOut(nilai: boolean) {
    if (!dipilih) return
    const res = await fetch(`/api/kontak/${encodeURIComponent(dipilih.nomor)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opt_out: nilai ? 1 : 0 }),
    })
    if (res.ok) {
      setDipilih({ ...dipilih, opt_out: nilai ? 1 : 0 })
      setGalatOptout('')
      tandaiTersimpan('optout')
      setVersi((n) => n + 1)
    } else {
      setGalatOptout('Status opt-out gagal disimpan. Perubahan belum tersimpan.')
    }
  }

  async function pasangTag(tagId: number) {
    if (!dipilih) return
    const res = await fetch(`/api/kontak/${encodeURIComponent(dipilih.nomor)}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: tagId }),
    })
    if (res.ok) {
      const d = (await res.json()) as { tag: Tag[] }
      setDipilih({ ...dipilih, tag: d.tag })
      setGalatTag('')
      tandaiTersimpan('tag')
      setVersi((n) => n + 1)
    } else {
      setGalatTag('Tag gagal dipasang. Perubahan belum tersimpan.')
    }
  }

  async function lepasTag(tagId: number) {
    if (!dipilih) return
    const res = await fetch(`/api/kontak/${encodeURIComponent(dipilih.nomor)}/tag?tag_id=${tagId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      const d = (await res.json()) as { tag: Tag[] }
      setDipilih({ ...dipilih, tag: d.tag })
      setGalatTag('')
      tandaiTersimpan('tag')
      setVersi((n) => n + 1)
    } else {
      setGalatTag('Tag gagal dilepas. Perubahan belum tersimpan.')
    }
  }

  async function buatTag() {
    const nama = tagBaru.trim()
    if (!nama) return
    const res = await fetch('/api/tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama }),
    })
    if (res.ok) {
      setTagBaru('')
      setGalatTagBaru('')
      setVersi((n) => n + 1)
    } else {
      const d = (await res.json().catch(() => null)) as { error?: string } | null
      setGalatTagBaru(d?.error === 'nama_sudah_ada' ? 'Tag dengan nama itu sudah ada.' : 'Tag gagal dibuat.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-ink">Kontak &amp; Segmen</h1>
        <p className="text-sm text-ink-soft">{total} kontak cocok</p>
      </div>

      <div className="kartu space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nomor atau nama"
            className="kolom-isian max-w-xs"
          />
          <div className="flex gap-2">
            <input
              value={tagBaru}
              onChange={(e) => setTagBaru(e.target.value)}
              placeholder="Tag baru"
              className="kolom-isian max-w-[10rem]"
            />
            <button type="button" onClick={buatTag} className="tombol tombol-garis">
              Tambah tag
            </button>
          </div>
          {galatTagBaru ? <p className="text-xs text-bad">{galatTagBaru}</p> : null}
        </div>

        <PilihTag
          tag={tag}
          terpilih={saringTag}
          onUbah={setSaringTag}
          kosong="Belum ada tag. Buat tag pertama lewat kolom di atas."
        />
        {saringTag.length > 1 ? (
          <p className="text-xs text-ink-soft">Kontak harus punya semua tag terpilih.</p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="kartu overflow-hidden">
          {galatDaftar ? <p className="px-4 pt-3 text-sm text-bad">{galatDaftar}</p> : null}
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-canvas-2 text-left text-xs text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">Kontak</th>
                  <th className="px-4 py-2 font-medium">Tag</th>
                  <th className="px-4 py-2 font-medium">Pesan terakhir</th>
                </tr>
              </thead>
              <tbody>
                {memuat ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-ink-soft">
                      Memuat...
                    </td>
                  </tr>
                ) : daftar.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-ink-soft">
                      Tidak ada kontak yang cocok.
                    </td>
                  </tr>
                ) : (
                  daftar.map((k) => (
                    <tr
                      key={k.nomor}
                      onClick={() => pilih(k)}
                      className={
                        'cursor-pointer border-t border-line ' +
                        (dipilih?.nomor === k.nomor ? 'bg-canvas-2' : 'hover:bg-canvas')
                      }
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{k.nama || k.nomor}</p>
                        <p className="text-xs text-ink-soft">{k.nomor}</p>
                        {k.opt_out ? <p className="text-xs text-warn">Menolak dihubungi</p> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {k.tag.map((t) => (
                            <KepingTag key={t.id} tag={t} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">{labelTanggal(k.terakhir_pesan_masuk)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="kartu p-5">
          {!dipilih ? (
            <p className="text-sm text-ink-soft">Pilih satu kontak untuk melihat detailnya.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-medium text-ink">{dipilih.nama || dipilih.nomor}</p>
                <p className="text-xs text-ink-soft">{dipilih.nomor}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink">Tag</p>
                <div className="flex flex-wrap gap-1">
                  {dipilih.tag.map((t) => (
                    <KepingTag key={t.id} tag={t} onLepas={() => lepasTag(t.id)} />
                  ))}
                  {dipilih.tag.length === 0 ? <span className="text-sm text-ink-soft">Belum ada</span> : null}
                </div>
                <div className="max-w-xs pt-1">
                  {/* Dropdown dicari, bukan deretan semua tag: begitu tag lewat
                      selusin, daftar mentahnya menenggelamkan panel detail. */}
                  <Pilih
                    nilai=""
                    opsi={tag
                      .filter((t) => !dipilih.tag.some((x) => x.id === t.id))
                      .map((t) => ({ nilai: String(t.id), label: t.nama }))}
                    onPilih={(v) => pasangTag(Number(v))}
                    placeholder="+ Tambah tag"
                  />
                </div>
                {tersimpan === 'tag' ? <p className="text-xs text-ok">Tersimpan</p> : null}
                {galatTag ? <p className="text-xs text-bad">{galatTag}</p> : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="catatan" className="text-sm font-medium text-ink">
                  Catatan
                </label>
                <textarea
                  id="catatan"
                  rows={4}
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  onBlur={simpanCatatan}
                  className="kolom-isian resize-none"
                />
                {tersimpan === 'catatan' ? (
                  <p className="text-xs text-ok">Tersimpan</p>
                ) : galatCatatan ? (
                  <p className="text-xs text-bad">{galatCatatan}</p>
                ) : (
                  <p className="text-xs text-ink-soft">Tersimpan saat kolom ditinggalkan.</p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={dipilih.opt_out === 1}
                  onChange={(e) => ubahOptOut(e.target.checked)}
                />
                Tandai menolak dihubungi
              </label>
              {tersimpan === 'optout' ? <p className="text-xs text-ok">Tersimpan</p> : null}
              {galatOptout ? <p className="text-xs text-bad">{galatOptout}</p> : null}
              <p className="text-xs text-ink-soft">
                Kontak bertanda ini dilewati saat broadcast dan tidak bisa dibalas manual.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
