import { useEffect, useState } from 'react'
import type { DaftarRingkas } from '../komponen/ImporDaftar'
import Pilih from '../komponen/Pilih'
import PilihTag from '../komponen/PilihTag'
import TahanKirim from '../komponen/TahanKirim'
import UnggahGambar from '../komponen/UnggahGambar'

type Tag = { id: number; nama: string; jumlah_kontak: number }

type Template = { nama: string; judul?: string; bahasa: string; isi: string; punya_gambar?: boolean }

type Progress = {
  status: string
  terkirim: number
  target: number
  persen: number
  gagal: number
  tertahan: number
}

type Hitung = {
  uji?: boolean
  nomor_uji?: string | null
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
  1: 'Pilih templat',
  2: 'Pilih daftar & jumlah',
  3: 'Periksa & kirim',
}

/**
 * Kode galat server diterjemahkan ke kalimat yang bisa ditindaklanjuti staf.
 * Kode mentah di layar bikin mereka menelepon Moté untuk hal yang sebenarnya
 * bisa mereka benahi sendiri dalam satu menit.
 */
const PESAN_GALAT: Record<string, string> = {
  masih_ada_yang_jalan: 'Masih ada broadcast yang berjalan. Tunggu selesai atau hentikan dulu.',
  target_kosong: 'Tidak ada penerima yang layak dikirimi setelah penyaringan.',
  nomor_uji_belum_diatur:
    'Nomor uji belum dipasang di pengaturan server, jadi mode uji tidak bisa dipakai.',
  template_tidak_ditemukan:
    'Templat ini sudah tidak ada di WhatsApp. Muat ulang halaman lalu pilih templat lain.',
  template_belum_disetujui:
    'Templat ini sedang tidak disetujui WhatsApp, jadi semua pesannya akan ditolak. Pilih templat lain.',
  template_pakai_variabel:
    'Templat ini memakai isian yang berubah per orang. Kirim Pesan hanya bisa mengirim satu isi yang sama ke semua tamu.',
  template_wajib_gambar: 'Templat ini berkepala gambar, jadi gambarnya wajib diisi dulu.',
  template_tidak_pakai_gambar:
    'Templat ini tidak berkepala gambar, jadi gambar yang dipasang tidak akan terkirim. Hapus dulu gambarnya.',
  gambar_url_wajib_https: 'Alamat gambar harus diawali https.',
  gambar_url_tidak_valid: 'Alamat gambar tidak terbaca.',
  gagal_menghubungi_meta: 'WhatsApp sedang tidak bisa dihubungi. Coba lagi sebentar lagi.',
  gagal_menghubungi_n8n: 'Mesin pengirim sedang tidak bisa dihubungi. Coba lagi sebentar lagi.',
  n8n_belum_dikonfigurasi: 'Mesin pengirim belum dipasang di lingkungan ini.',
}

const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID')
const angka = (n: number) => n.toLocaleString('id-ID')

/**
 * `maks` yang dikirim ke server. -1 = mode uji (satu pesan ke nomor tim),
 * 0 = seluruh tamu yang lolos saring. Angka lain = batas atas jumlah tamu.
 */
type Preset = { maks: number; label: string; keterangan: string }

const PRESET: Preset[] = [
  { maks: -1, label: 'Uji dulu', keterangan: '1 pesan ke nomor tim, tidak ada tamu yang menerima' },
  { maks: 25, label: '25 tamu', keterangan: 'Kirim ke 25 tamu pertama yang lolos saring' },
  { maks: 200, label: '200 tamu', keterangan: 'Kirim ke 200 tamu pertama yang lolos saring' },
  { maks: 1000, label: '1.000 tamu', keterangan: 'Kirim ke 1.000 tamu pertama yang lolos saring' },
  { maks: 0, label: 'Semua tamu', keterangan: 'Kirim ke seluruh tamu yang lolos saring' },
]

export default function Broadcast() {
  const [langkah, setLangkah] = useState<1 | 2 | 3>(1)
  const [tag, setTag] = useState<Tag[]>([])
  const [template, setTemplate] = useState<Template[]>([])
  const [metaSiap, setMetaSiap] = useState(true)
  const [pilihTag, setPilihTag] = useState<number[]>([])
  const [daftarTamu, setDaftarTamu] = useState<DaftarRingkas[]>([])
  const [pilihDaftar, setPilihDaftar] = useState('') // '' = semua tamu
  const [preset, setPreset] = useState<Preset | null>(null)
  const [menghitung, setMenghitung] = useState(false)
  const [galatHitung, setGalatHitung] = useState('')
  const [pilihTemplate, setPilihTemplate] = useState('')
  const [gambarUrl, setGambarUrl] = useState('')
  const [gambarRusak, setGambarRusak] = useState(false)
  const [hitung, setHitung] = useState<Hitung | null>(null)
  const [riwayat, setRiwayat] = useState<Campaign[]>([])
  const [pesan, setPesan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [versi, setVersi] = useState(0)
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
    fetch('/api/daftar')
      .then((r) => r.json())
      .then((d: { daftar: DaftarRingkas[] }) => setDaftarTamu(d.daftar))
      // Daftar gagal dimuat diperlakukan sama seperti belum ada daftar: pilihan
      // "Semua tamu" tetap jalan, jadi Broadcast tidak ikut mati.
      .catch(() => setDaftarTamu([]))
  }, [])

  useEffect(() => {
    fetch('/api/campaign')
      .then((r) => r.json())
      .then((d: { campaign: Campaign[] }) => setRiwayat(d.campaign))
      .catch(() => setRiwayat([]))
  }, [versi])

  // Sisa kuota & tarif dipakai kartu preset untuk menampilkan perkiraan rupiah
  // SEBELUM staf memilih jumlah, jadi angkanya diambil begitu langkah 2 dibuka.
  const [kuota, setKuota] = useState<{ sisa: number; terpakai: number } | null>(null)
  useEffect(() => {
    fetch('/api/segmen/hitung?maks=-1')
      .then((r) => r.json())
      .then((d: Hitung) => setKuota({ sisa: d.sisa_kuota, terpakai: d.terpakai_kuota }))
      .catch(() => setKuota(null))
  }, [versi])

  /**
   * Hitung penerima untuk satu preset lalu pindah ke layar konfirmasi. Angka di
   * layar konfirmasi WAJIB berasal dari server, bukan dari label preset: label
   * "200 tamu" tidak tahu berapa yang terbuang opt-out, jeda 24 jam, atau kuota.
   */
  async function hitungPreset(p: Preset) {
    setGalatHitung('')
    setMenghitung(true)
    setPreset(p)
    try {
      const q = new URLSearchParams()
      for (const id of pilihTag) q.append('tag', String(id))
      if (pilihDaftar) q.set('daftar', pilihDaftar)
      q.set('maks', String(p.maks))
      const res = await fetch(`/api/segmen/hitung?${q}`)
      if (!res.ok) throw new Error('gagal')
      const d = (await res.json()) as Hitung
      setHitung(d)
      setLangkah(3)
    } catch {
      setHitung(null)
      setPreset(null)
      setGalatHitung('Gagal menghitung jumlah penerima. Coba lagi.')
    } finally {
      setMenghitung(false)
    }
  }

  const berjalan = riwayat.find((c) => c.aktif)
  const templateTerpilih = template.find((t) => t.nama === pilihTemplate)
  // Template ber-header IMAGE DITOLAK Meta saat kirim kalau parameter gambar
  // tidak diisi, dan sebaliknya template tanpa header gambar ditolak kalau
  // dikirimi gambar. Dua-duanya dikunci di sini, bukan dibiarkan gagal di Meta.
  const butuhGambar = templateTerpilih?.punya_gambar === true
  const gambarTakDipakai = !!templateTerpilih && !butuhGambar && gambarUrl.trim() !== ''
  const gambarBermasalah =
    (butuhGambar && gambarUrl.trim() === '') || gambarTakDipakai || (gambarUrl !== '' && gambarRusak)

  // Meta cuma menyimpan nama template dalam bentuk huruf kecil bergaris bawah.
  // Staf mengenali judul yang mereka tulis sendiri, jadi judul yang dipakai di
  // layar; nama Meta tetap yang dikirim ke server.
  const judulTemplate = templateTerpilih?.judul || pilihTemplate
  const namaDaftar = daftarTamu.find((d) => d.id === pilihDaftar)?.nama ?? ''
  const jumlahDilewati = hitung
    ? hitung.dibuang_opt_out + hitung.dibuang_baru_dibc + hitung.dipotong_kuota
    : 0

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
    if (!pilihTemplate || !hitung || !preset || hitung.akan_dikirim === 0) return
    setSibuk(true)
    setPesan('')
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: pilihTemplate,
          tag_ids: pilihTag,
          daftar_id: pilihDaftar || undefined,
          maks: preset.maks,
          gambar_url: gambarUrl.trim() || undefined,
        }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; pesan?: string } | null
      if (!res.ok) {
        // Layar TIDAK dikembalikan ke langkah 1 di sini: sebagian besar galat di
        // bawah bisa dibereskan staf lalu ditekan kirim lagi, dan memulangkan
        // mereka ke awal berarti pilih templat, pilih daftar, dan hitung ulang.
        setPesan(PESAN_GALAT[d?.error ?? ''] ?? d?.pesan ?? 'Broadcast gagal dimulai.')
        return
      }
      setPesan(preset.maks === -1 ? 'Pesan uji dikirim ke nomor tim.' : 'Broadcast dimulai.')
      setVersi((n) => n + 1)
      setPreset(null)
      setHitung(null)
      setLangkah(1)
    } finally {
      setSibuk(false)
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


  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Kirim Pesan</h1>

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
                  label: t.judul || t.nama,
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
              <UnggahGambar
                nilai={gambarUrl}
                wajib={butuhGambar}
                onUbah={(url) => {
                  // Ganti alamat harus mulai bersih -- status "rusak" hanya
                  // berlaku untuk alamat yang barusan gagal dimuat.
                  setGambarRusak(false)
                  setGambarUrl(url)
                }}
              />
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
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="daftar" className="text-sm font-medium text-ink">
                Kirim ke daftar
              </label>
              <select
                id="daftar"
                value={pilihDaftar}
                onChange={(e) => setPilihDaftar(e.target.value)}
                className="kolom-isian"
              >
                <option value="">Semua tamu di CRM</option>
                {daftarTamu.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nama} ({angka(d.jumlah)} nomor)
                  </option>
                ))}
              </select>
              {daftarTamu.length === 0 ? (
                <p className="text-xs text-ink-soft">
                  Belum ada daftar tamu tersimpan. Unggah ekspor reservasi di menu Kontak kalau mau
                  menyasar sekelompok tamu tertentu.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">
                Saring lagi pakai tag <span className="text-ink-soft">(boleh dilewati)</span>
              </p>
              <PilihTag tag={tag} terpilih={pilihTag} onUbah={setPilihTag} />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">Kirim ke berapa tamu?</p>
              {kuota ? (
                <p className="text-xs text-ink-soft">
                  Sisa kuota nomor hari ini {angka(kuota.sisa)} penerima.
                </p>
              ) : null}
            </div>

            {galatHitung ? <p className="text-sm text-bad">{galatHitung}</p> : null}

            {menghitung ? (
              <p className="text-sm text-ink-soft">Menghitung tamu yang akan menerima pesan ini…</p>
            ) : (
              <div className="space-y-2">
                {PRESET.map((pr) => {
                  // Perkiraan rupiah tidak ditampilkan untuk mode uji: tidak ada
                  // tamu yang menerima, jadi angka biaya di situ cuma membingungkan.
                  let biaya = ''
                  let potongan = ''
                  if (pr.maks !== -1 && kuota) {
                    if (pr.maks === 0) {
                      biaya = `Perkiraan hingga ${rupiah(kuota.sisa * TARIF_MARKETING)}`
                      potongan =
                        'Kalau tamu yang lolos lebih banyak dari sisa kuota, kiriman dipotong otomatis dan sisanya bisa dikirim besok.'
                    } else {
                      const kenaPotong = pr.maks > kuota.sisa
                      const efektif = kenaPotong ? kuota.sisa : pr.maks
                      biaya = `Perkiraan ${rupiah(efektif * TARIF_MARKETING)}`
                      if (kenaPotong) {
                        potongan = `Sisa kuota hari ini cuma ${angka(kuota.sisa)}, jumlahnya akan dipotong dan sisanya bisa dikirim besok.`
                      }
                    }
                  }

                  return (
                    <button
                      key={pr.maks}
                      type="button"
                      disabled={!!berjalan}
                      onClick={() => hitungPreset(pr)}
                      className={
                        'w-full rounded-2xl border p-4 text-left transition-colors disabled:opacity-50 ' +
                        (pr.maks === -1 ? 'border-teal bg-teal/5' : 'border-line hover:border-teal')
                      }
                    >
                      <p className="font-medium text-ink">{pr.label}</p>
                      <p className="text-xs text-ink-soft">{pr.keterangan}</p>
                      {biaya ? <p className="mt-1 text-xs font-semibold text-teal">{biaya}</p> : null}
                      {potongan ? <p className="mt-1 text-xs text-warn">{potongan}</p> : null}
                    </button>
                  )
                })}
              </div>
            )}

            <button type="button" onClick={() => setLangkah(1)} className="tombol tombol-garis">
              Kembali
            </button>
          </div>
        ) : null}

        {langkah === 3 && hitung && preset ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => {
                setHitung(null)
                setPreset(null)
                setLangkah(2)
              }}
              className="tombol tombol-garis text-sm"
            >
              Kembali
            </button>

            <div className="kartu space-y-2 p-4">
              {hitung.uji ? (
                <>
                  <p className="text-ink">
                    Kirim <span className="font-semibold">{judulTemplate}</span> sebagai pesan uji ke nomor
                    tim{hitung.nomor_uji ? ` ${hitung.nomor_uji}` : ''}.
                  </p>
                  <p className="text-sm text-ink-soft">Tidak ada tamu yang menerima pesan ini.</p>
                </>
              ) : (
                <>
                  <p className="text-ink">
                    Kirim promo <span className="font-semibold">{judulTemplate}</span> ke{' '}
                    <span className="font-semibold">{angka(hitung.akan_dikirim)} tamu</span>
                    {namaDaftar ? ` dari daftar ${namaDaftar}` : ''}.
                  </p>
                  <p className="text-ink">
                    Perkiraan biaya sekitar{' '}
                    <span className="font-display text-xl">
                      {rupiah(hitung.akan_dikirim * TARIF_MARKETING)}
                    </span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    {angka(hitung.akan_dikirim)} pesan × Rp 586. Angka pastinya keluar dari Meta setelah
                    kiriman selesai.
                  </p>
                </>
              )}
            </div>

            {!hitung.uji && jumlahDilewati > 0 ? (
              <div className="kartu space-y-1 p-4">
                <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  Tamu yang dilewati
                </p>
                <ul className="space-y-0.5 text-sm text-ink-soft">
                  {hitung.dibuang_baru_dibc > 0 ? (
                    <li className="flex justify-between gap-3">
                      <span>baru saja dikirimi</span>
                      <span className="font-semibold text-ink">{angka(hitung.dibuang_baru_dibc)}</span>
                    </li>
                  ) : null}
                  {hitung.dibuang_opt_out > 0 ? (
                    <li className="flex justify-between gap-3">
                      <span>menolak dihubungi</span>
                      <span className="font-semibold text-ink">{angka(hitung.dibuang_opt_out)}</span>
                    </li>
                  ) : null}
                  {hitung.dipotong_kuota > 0 ? (
                    <li className="flex justify-between gap-3">
                      <span>dipotong kuota hari ini</span>
                      <span className="font-semibold text-ink">{angka(hitung.dipotong_kuota)}</span>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

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

            {hitung.akan_dikirim === 0 ? (
              <p className="text-sm text-bad">
                Tidak ada tamu yang layak dikirimi setelah penyaringan. Ganti daftar atau tunggu jeda 24 jam
                lewat.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-soft">
                  Tekan dan tahan tombol di bawah selama 3 detik untuk mengirim.
                </p>
                <TahanKirim
                  label={hitung.uji ? 'Tahan untuk kirim uji' : 'Tahan untuk kirim'}
                  disabled={sibuk || gambarBermasalah || !!berjalan}
                  onSelesai={kirim}
                />
              </>
            )}
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
