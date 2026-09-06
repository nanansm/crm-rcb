import { useEffect, useState } from 'react'
import Pilih from '../komponen/Pilih'
import PilihTag from '../komponen/PilihTag'

type Tag = { id: number; nama: string; jumlah_kontak: number }

type Template = { nama: string; bahasa: string; isi: string; punya_gambar?: boolean }

type Progress = {
  status: string
  terkirim: number
  target: number
  persen: number
  gagal: number
  tertahan: number
}

type Hitung = {
  total_cocok: number
  akan_dikirim: number
  sisa_kuota: number
  terpakai_kuota: number
  dibuang_opt_out: number
  dibuang_baru_dibc: number
  dipotong_kuota: number
}

type Campaign = {
  id: number
  status: string
  template: string
  target: number
  terkirim: number
  gagal: number
  tertahan: number
  aktif: number | null
}

// Tarif nyata pesan MARKETING Indonesia, diukur dari pricing_analytics Meta
// pada broadcast yang sudah jalan -- bukan angka bulat karangan.
const TARIF_MARKETING = 586

const LABEL_LANGKAH: Record<1 | 2 | 3, string> = {
  1: 'Isi pesan',
  2: 'Pilih penerima',
  3: 'Periksa & kirim',
}

export default function Broadcast() {
  const [langkah, setLangkah] = useState<1 | 2 | 3>(1)
  const [tag, setTag] = useState<Tag[]>([])
  const [template, setTemplate] = useState<Template[]>([])
  const [metaSiap, setMetaSiap] = useState(true)
  const [pilihTag, setPilihTag] = useState<number[]>([])
  const [semuaKontak, setSemuaKontak] = useState(false)
  const [pilihTemplate, setPilihTemplate] = useState('')
  const [gambarUrl, setGambarUrl] = useState('')
  const [gambarRusak, setGambarRusak] = useState(false)
  const [hitung, setHitung] = useState<Hitung | null>(null)
  const [riwayat, setRiwayat] = useState<Campaign[]>([])
  const [pesan, setPesan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [versi, setVersi] = useState(0)
  const [angkaKonfirmasi, setAngkaKonfirmasi] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [hentikanKonfirm, setHentikanKonfirm] = useState(false)

  useEffect(() => {
    fetch('/api/tag')
      .then((r) => r.json())
      .then((d: { tag: Tag[] }) => setTag(d.tag))
      .catch(() => setTag([]))
    fetch('/api/template')
      .then((r) => r.json())
      .then((d: { template?: Template[]; meta_belum_dikonfigurasi?: boolean }) => {
        setTemplate(d.template ?? [])
        setMetaSiap(!d.meta_belum_dikonfigurasi)
      })
      .catch(() => setTemplate([]))
  }, [])

  useEffect(() => {
    fetch('/api/campaign')
      .then((r) => r.json())
      .then((d: { campaign: Campaign[] }) => setRiwayat(d.campaign))
      .catch(() => setRiwayat([]))
  }, [versi])

  useEffect(() => {
    const q = new URLSearchParams()
    for (const id of pilihTag) q.append('tag', String(id))
    fetch(`/api/segmen/hitung${q.toString() ? `?${q}` : ''}`)
      .then((r) => r.json())
      .then((d: Hitung) => setHitung(d))
      .catch(() => setHitung(null))
  }, [pilihTag, versi])

  const berjalan = riwayat.find((c) => c.aktif)
  const templateTerpilih = template.find((t) => t.nama === pilihTemplate)
  // Template ber-header IMAGE DITOLAK Meta saat kirim kalau parameter gambar
  // tidak diisi, dan sebaliknya template tanpa header gambar ditolak kalau
  // dikirimi gambar. Dua-duanya dikunci di sini, bukan dibiarkan gagal di Meta.
  const butuhGambar = templateTerpilih?.punya_gambar === true
  const gambarTakDipakai = !!templateTerpilih && !butuhGambar && gambarUrl.trim() !== ''
  const gambarBermasalah =
    (butuhGambar && gambarUrl.trim() === '') || gambarTakDipakai || (gambarUrl !== '' && gambarRusak)

  // Polling progres campaign yang sedang berjalan — tanpa ini staf menekan
  // "Hentikan" berdasarkan angka basi dari load halaman pertama kali.
  useEffect(() => {
    if (!berjalan) {
      setProgress(null)
      return
    }
    let hidup = true
    let timer: number | undefined
    async function ambil() {
      if (document.hidden || !hidup) return
      try {
        const res = await fetch(`/api/campaign/${berjalan!.id}/progress`)
        // Sesi kedaluwarsa atau galat sesaat: jangan diperlakukan sebagai
        // "campaign sudah tidak berjalan" — itu menghentikan polling diam-diam
        // dan angka di layar beku lagi seperti sebelum perbaikan ini.
        if (!res.ok) return
        const d = (await res.json()) as Progress
        if (!hidup) return
        setProgress(d)
        if (d.status !== 'berjalan') {
          if (timer) window.clearInterval(timer)
          setVersi((n) => n + 1)
          return
        }
      } catch {
        // biarkan, coba lagi tick berikutnya — jangan hentikan campaign cuma karena polling gagal
      }
    }
    ambil()
    timer = window.setInterval(ambil, 5000)
    return () => {
      hidup = false
      if (timer) window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [berjalan?.id])

  async function kirim() {
    if (!pilihTemplate || !hitung || hitung.akan_dikirim === 0) return
    // Penjaga ganda: tombolnya memang sudah disabled, tapi kiriman tanpa segmen
    // terpilih artinya blast ke SELURUH kontak. Terlalu mahal untuk cuma
    // dijaga oleh satu atribut disabled.
    if (pilihTag.length === 0 && !semuaKontak) return
    setSibuk(true)
    setPesan('')
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: pilihTemplate,
          tag_ids: pilihTag,
          gambar_url: gambarUrl.trim() || undefined,
        }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; pesan?: string } | null
      if (!res.ok) {
        setPesan(
          d?.error === 'masih_ada_yang_jalan'
            ? 'Masih ada broadcast yang berjalan. Tunggu selesai atau hentikan dulu.'
            : d?.error === 'target_kosong'
              ? 'Tidak ada penerima yang layak dikirimi setelah penyaringan.'
              : d?.pesan || 'Broadcast gagal dimulai.',
        )
        return
      }
      setPesan('Broadcast dimulai.')
      setVersi((n) => n + 1)
    } finally {
      setSibuk(false)
      setAngkaKonfirmasi('')
      setLangkah(1)
    }
  }

  async function hentikan() {
    if (!hentikanKonfirm) {
      setHentikanKonfirm(true)
      return
    }
    setSibuk(true)
    try {
      await fetch('/api/campaign', { method: 'DELETE' })
      setVersi((n) => n + 1)
    } finally {
      setSibuk(false)
      setHentikanKonfirm(false)
    }
  }

  const bisaLanjutSegmen = (pilihTag.length > 0 || semuaKontak) && !!hitung && hitung.akan_dikirim > 0 && !berjalan

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Broadcast</h1>

      {!metaSiap ? (
        <p className="kartu p-4 text-sm text-warn">
          Kredensial Meta belum dipasang di lingkungan ini, jadi daftar template masih kosong dan
          pengiriman akan ditolak.
        </p>
      ) : null}

      {berjalan ? (
        <div className="kartu space-y-2 p-5">
          <p className="font-medium text-ink">Sedang berjalan: {berjalan.template}</p>
          <p className="text-sm text-ink-soft">
            {progress?.terkirim ?? berjalan.terkirim}/{progress?.target ?? berjalan.target} terkirim
            {progress ? ` (${progress.persen}%)` : ''} · {progress?.gagal ?? berjalan.gagal} gagal ·{' '}
            {progress?.tertahan ?? berjalan.tertahan} tertahan
          </p>
          {progress?.status === 'dihentikan_otomatis' ? (
            <p className="text-sm text-bad">
              Broadcast dihentikan otomatis — Meta menahan lima pengiriman beruntun. Jangan kirim ulang
              sebelum dicek.
            </p>
          ) : null}
          <button type="button" disabled={sibuk} onClick={hentikan} className="tombol tombol-garis text-sm">
            {hentikanKonfirm ? 'Yakin hentikan?' : 'Hentikan broadcast'}
          </button>
        </div>
      ) : null}

      <div className="kartu space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {([1, 2, 3] as const).map((n) => {
            const aktif = n === langkah
            const lewat = n < langkah
            return (
              <div key={n} className="flex items-center gap-2">
                {n > 1 ? (
                  <span aria-hidden className="text-ink-soft opacity-50">
                    ›
                  </span>
                ) : null}
                {lewat ? (
                  <button type="button" onClick={() => setLangkah(n)} className="text-ink-soft hover:text-ink">
                    {n} {LABEL_LANGKAH[n]}
                  </button>
                ) : (
                  <span className={aktif ? 'font-semibold text-ink' : 'text-ink-soft opacity-50'}>
                    {n} {LABEL_LANGKAH[n]}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {pesan ? <p className="text-sm text-ink">{pesan}</p> : null}

        {langkah === 1 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="template" className="text-sm font-medium text-ink">
                Template
              </label>
              <Pilih
                id="template"
                nilai={pilihTemplate}
                opsi={template.map((t) => ({
                  nilai: t.nama,
                  label: t.nama,
                  catatan: t.isi ? t.isi.slice(0, 60) : undefined,
                }))}
                onPilih={setPilihTemplate}
                placeholder="Pilih template yang sudah disetujui"
              />
              <div className="rounded-2xl bg-canvas border border-line p-3 max-w-md">
                {gambarUrl && !gambarRusak ? (
                  <img
                    src={gambarUrl}
                    onError={() => setGambarRusak(true)}
                    alt=""
                    className="mb-2 max-h-48 w-full rounded-xl object-cover"
                  />
                ) : null}
                {templateTerpilih ? (
                  templateTerpilih.isi ? (
                    <p className="text-sm text-ink whitespace-pre-wrap">{templateTerpilih.isi}</p>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Isi template tidak terbaca dari Meta. Jangan kirim sebelum kamu tahu isinya.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-ink-soft">Pilih template untuk melihat isi pesannya.</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="gambar-url" className="text-sm font-medium text-ink">
                {butuhGambar ? 'Gambar (wajib untuk template ini)' : 'Gambar (opsional)'}
              </label>
              <input
                id="gambar-url"
                type="url"
                value={gambarUrl}
                onChange={(e) => {
                  // Ganti alamat harus mulai bersih -- status "rusak" hanya
                  // berlaku untuk alamat yang barusan gagal dimuat.
                  setGambarRusak(false)
                  setGambarUrl(e.target.value)
                }}
                className="kolom-isian"
              />
              <p className="text-xs text-ink-soft">
                Wajib https dan bisa dibuka publik. Kosongkan kalau promo ini tanpa gambar.
              </p>
              {gambarUrl && gambarRusak ? (
                <p className="text-xs text-bad">Gambar tidak bisa dibuka. Periksa alamatnya sebelum lanjut.</p>
              ) : null}
              {butuhGambar && gambarUrl.trim() === '' ? (
                <p className="text-xs text-bad">
                  Template ini punya header gambar. Meta menolak pengirimannya kalau gambar dikosongkan.
                </p>
              ) : null}
              {gambarTakDipakai ? (
                <p className="text-xs text-bad">
                  Template ini tidak punya header gambar, jadi gambar akan ditolak Meta. Kosongkan
                  alamatnya atau pilih template bergambar.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={!pilihTemplate || gambarBermasalah}
              onClick={() => setLangkah(2)}
              className="tombol tombol-utama"
            >
              Lanjut
            </button>
          </div>
        ) : null}

        {langkah === 2 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">Segmen</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSemuaKontak(true)
                    setPilihTag([])
                  }}
                  className={
                    'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                    (semuaKontak ? 'border-teal bg-teal text-white' : 'border-line text-ink-soft hover:text-ink')
                  }
                >
                  Semua kontak
                </button>
              </div>
              <PilihTag
                tag={tag}
                terpilih={pilihTag}
                onUbah={(idBaru) => {
                  setSemuaKontak(false)
                  setPilihTag(idBaru)
                }}
              />
              {!semuaKontak && pilihTag.length === 0 ? (
                <p className="text-sm text-warn">
                  Pilih minimal satu segmen. Kirim ke semua kontak harus dipilih sengaja.
                </p>
              ) : null}
            </div>

            {hitung ? (
              <div className="rounded-2xl border border-line bg-canvas-2 p-4 text-sm">
                <p className="text-ink">
                  <span className="font-display text-xl">{hitung.akan_dikirim}</span> penerima akan dikirimi
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
                  <li>{hitung.total_cocok} kontak cocok dengan segmen</li>
                  {hitung.dibuang_opt_out > 0 ? (
                    <li>{hitung.dibuang_opt_out} dilewati karena menolak dihubungi</li>
                  ) : null}
                  {hitung.dibuang_baru_dibc > 0 ? (
                    <li>{hitung.dibuang_baru_dibc} dilewati karena baru dikirimi dalam 24 jam terakhir</li>
                  ) : null}
                  {hitung.dipotong_kuota > 0 ? <li>{hitung.dipotong_kuota} dipotong karena kuota harian</li> : null}
                  <li>sisa kuota hari ini {hitung.sisa_kuota} penerima</li>
                </ul>
              </div>
            ) : null}

            <div className="flex gap-2">
              <button type="button" onClick={() => setLangkah(1)} className="tombol tombol-garis">
                Kembali
              </button>
              <button
                type="button"
                disabled={!bisaLanjutSegmen}
                onClick={() => setLangkah(3)}
                className="tombol tombol-utama"
              >
                Lanjut
              </button>
            </div>
          </div>
        ) : null}

        {langkah === 3 && hitung ? (
          <div className="space-y-4">
            <button type="button" onClick={() => setLangkah(2)} className="tombol tombol-garis text-sm">
              Kembali
            </button>

            <div className="kartu space-y-2 p-4">
              <p className="text-ink">
                <span className="font-display text-xl">{hitung.akan_dikirim}</span> penerima aktif
              </p>
              <ul className="space-y-0.5 text-xs text-ink-soft">
                <li>{hitung.total_cocok} kontak cocok</li>
                {hitung.dibuang_opt_out > 0 ? <li>{hitung.dibuang_opt_out} menolak dihubungi</li> : null}
                {hitung.dibuang_baru_dibc > 0 ? (
                  <li>{hitung.dibuang_baru_dibc} baru dikirimi dalam 24 jam</li>
                ) : null}
                {hitung.dipotong_kuota > 0 ? <li>{hitung.dipotong_kuota} dipotong kuota harian</li> : null}
              </ul>
            </div>

            <div className="kartu space-y-2 p-4">
              <p className="text-sm font-medium text-ink">Pesan yang akan dikirim</p>
              <div className="rounded-2xl bg-canvas border border-line p-3 max-w-md">
                {gambarUrl && !gambarRusak ? (
                  <img
                    src={gambarUrl}
                    onError={() => setGambarRusak(true)}
                    alt=""
                    className="mb-2 max-h-48 w-full rounded-xl object-cover"
                  />
                ) : null}
                {templateTerpilih?.isi ? (
                  <p className="text-sm text-ink whitespace-pre-wrap">{templateTerpilih.isi}</p>
                ) : (
                  <p className="text-sm text-ink-soft">
                    Isi template tidak terbaca dari Meta. Jangan kirim sebelum kamu tahu isinya.
                  </p>
                )}
              </div>
            </div>

            <div className="kartu space-y-1 p-4">
              <p className="font-display text-xl text-ink">
                Rp {(hitung.akan_dikirim * TARIF_MARKETING).toLocaleString('id-ID')}
              </p>
              <p className="text-xs text-ink-soft">
                Perkiraan {hitung.akan_dikirim} pesan × Rp 586. Angka pastinya keluar dari Meta setelah kiriman
                selesai.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="konfirmasi-angka" className="text-sm font-medium text-ink">
                Ketik jumlah penerima untuk memastikan
              </label>
              <input
                id="konfirmasi-angka"
                type="text"
                inputMode="numeric"
                value={angkaKonfirmasi}
                onChange={(e) => setAngkaKonfirmasi(e.target.value)}
                className="kolom-isian"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={sibuk || gambarBermasalah || angkaKonfirmasi !== String(hitung.akan_dikirim)}
                onClick={kirim}
                className="tombol tombol-utama"
              >
                Kirim sekarang
              </button>
              <button
                type="button"
                onClick={() => {
                  setAngkaKonfirmasi('')
                  setLangkah(2)
                }}
                className="tombol tombol-garis"
              >
                Batal
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="kartu overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas-2 text-left text-xs text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-medium">Template</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Hasil</th>
            </tr>
          </thead>
          <tbody>
            {riwayat.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-ink-soft">
                  Belum ada broadcast.
                </td>
              </tr>
            ) : (
              riwayat.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink">{c.template}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{c.status}</td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {c.terkirim}/{c.target} terkirim · {c.gagal} gagal · {c.tertahan} tertahan
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
