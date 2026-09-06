import { useEffect, useState } from 'react'
import Pilih from '../komponen/Pilih'
import GelembungWa, { type TombolPratinjau } from '../komponen/GelembungWa'
import UnggahGambar from '../komponen/UnggahGambar'

type Tombol = { tipe: 'situs' | 'balasan'; teks: string; url: string }

type Template = {
  nama: string
  judul?: string
  ringkas?: string
  berlaku_sampai?: string | null
  bahasa: string
  kategori?: string
  status?: string
  isi?: string
  footer?: string
  tombol?: Tombol | null
  punya_gambar?: boolean
}

const PANJANG_ISI_MIN = 30
const PANJANG_ISI_MAKS = 1024

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function tanggalIndo(iso: string | null | undefined): string {
  if (!iso) return 'tidak dibatasi'
  const [tahun, bulan, tanggal] = iso.split('-')
  return `${Number(tanggal)} ${NAMA_BULAN[Number(bulan) - 1] ?? bulan} ${tahun}`
}

/** Hari ini di zona Asia/Jakarta, sama dengan yang dipakai server buat validasi. */
function hariIniJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

const STATUS_TERBACA: Record<string, string> = {
  APPROVED: 'Siap dipakai',
  PENDING: 'Sedang diperiksa WhatsApp',
  REJECTED: 'Ditolak WhatsApp',
  PAUSED: 'Dijeda WhatsApp',
  DISABLED: 'Dimatikan WhatsApp',
}

type JenisTombol = 'tidak' | 'situs' | 'balasan'

interface Isian {
  judul: string
  ringkas: string
  isi: string
  footer: string
  kategori: string
  jenisTombol: JenisTombol
  tombolTeks: string
  tombolUrl: string
  berlakuSampai: string
  gambarUrl: string
}

const ISIAN_KOSONG: Isian = {
  judul: '',
  ringkas: '',
  isi: '',
  footer: '',
  kategori: 'MARKETING',
  jenisTombol: 'tidak',
  tombolTeks: '',
  tombolUrl: '',
  berlakuSampai: '',
  gambarUrl: '',
}

/**
 * Validasi yang sama persis dengan sisi server, dijalankan lagi di sini supaya
 * staf tahu salahnya SEBELUM template sungguhan diajukan. Pengajuan ke Meta
 * tidak bisa ditarik kembali, jadi umpan balik cepat di sini bukan kemewahan.
 * Server tetap penjaga terakhir.
 */
function periksaIsian(f: Isian): string | null {
  const judul = f.judul.trim()
  if (judul.length < 3) return 'Nama template terlalu pendek.'
  if (judul.length > 60) return 'Nama template terlalu panjang, maksimal 60 huruf.'

  if (f.ringkas.trim().length > 120) return 'Keterangan singkat maksimal 120 huruf.'

  const isi = f.isi.trim()
  if (isi.length < PANJANG_ISI_MIN) return 'Isi pesan terlalu pendek.'
  if (isi.length > PANJANG_ISI_MAKS) return 'Isi pesan maksimal 1.024 huruf.'
  if (isi.includes('{{') || isi.includes('}}')) {
    return 'Isi pesan tidak boleh memakai tanda {{ }}. Tulis kalimatnya lengkap.'
  }

  if (f.footer.trim().length > 60) return 'Footer maksimal 60 huruf.'

  if (f.jenisTombol !== 'tidak') {
    const teks = f.tombolTeks.trim()
    if (teks.length < 1 || teks.length > 25) {
      return 'Tulisan tombol wajib diisi, maksimal 25 huruf.'
    }
    if (f.jenisTombol === 'situs') {
      const url = f.tombolUrl.trim()
      if (!url.startsWith('https://')) return 'Link tombol harus diawali https://'
      if (url.includes('wa.me') || url.includes('api.whatsapp.com')) {
        return 'WhatsApp tidak mengizinkan link wa.me dipakai sebagai tombol. Pakai link website, atau ganti tombolnya jadi tombol balasan cepat.'
      }
    }
  }

  if (f.berlakuSampai && f.berlakuSampai < hariIniJakarta()) {
    return 'Masa berlaku tidak boleh tanggal yang sudah lewat.'
  }

  const gambar = f.gambarUrl.trim()
  if (gambar !== '' && !gambar.startsWith('https://')) {
    return 'Alamat gambar harus diawali https://'
  }

  return null
}

function TombolPilihan({
  aktif,
  onKlik,
  children,
}: {
  aktif: boolean
  onKlik: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onKlik}
      aria-pressed={aktif}
      className={
        'min-h-[44px] rounded-xl border-2 px-3 text-sm font-medium ' +
        (aktif ? 'border-pine bg-pine/5 text-ink' : 'border-line text-ink-soft')
      }
    >
      {children}
    </button>
  )
}

function KartuTemplate({ t }: { t: Template }) {
  return (
    <li className="border-t border-line pt-2 text-sm first:border-0 first:pt-0">
      <p className="text-ink">{t.judul || t.nama}</p>
      {t.ringkas ? <p className="text-xs text-ink-soft">{t.ringkas}</p> : null}
      <p className="text-xs text-ink-soft">
        {STATUS_TERBACA[t.status ?? ''] ?? t.status ?? t.bahasa} · berlaku sampai{' '}
        {tanggalIndo(t.berlaku_sampai)}
        {t.punya_gambar ? ' · pakai gambar' : ''}
      </p>
    </li>
  )
}

export default function TemplatePage() {
  const [siap, setSiap] = useState<Template[]>([])
  const [menunggu, setMenunggu] = useState<Template[]>([])
  const [takDidukung, setTakDidukung] = useState<Template[]>([])
  const [metaSiap, setMetaSiap] = useState(true)
  const [form, setForm] = useState<Isian>(ISIAN_KOSONG)
  const [gambarRusak, setGambarRusak] = useState(false)
  const [galat, setGalat] = useState('')
  const [sukses, setSukses] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [versi, setVersi] = useState(0)

  useEffect(() => {
    fetch('/api/template')
      .then((r) => r.json())
      .then(
        (d: {
          template?: Template[]
          menunggu?: Template[]
          tak_didukung?: Template[]
          meta_belum_dikonfigurasi?: boolean
        }) => {
          setSiap(d.template ?? [])
          setMenunggu(d.menunggu ?? [])
          setTakDidukung(d.tak_didukung ?? [])
          setMetaSiap(!d.meta_belum_dikonfigurasi)
        },
      )
      .catch(() => setSiap([]))
  }, [versi])

  function ubah<K extends keyof Isian>(kunci: K, nilai: Isian[K]) {
    setForm((f) => ({ ...f, [kunci]: nilai }))
    setSukses('')
  }

  async function ajukan() {
    setGalat('')
    setSukses('')

    const salah = periksaIsian(form)
    if (salah) {
      setGalat(salah)
      return
    }

    setSibuk(true)
    try {
      const res = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          judul: form.judul.trim(),
          ringkas: form.ringkas.trim(),
          isi: form.isi.trim(),
          footer: form.footer.trim(),
          kategori: form.kategori,
          tombol:
            form.jenisTombol === 'tidak'
              ? null
              : {
                  tipe: form.jenisTombol,
                  teks: form.tombolTeks.trim(),
                  url: form.jenisTombol === 'situs' ? form.tombolUrl.trim() : '',
                },
          berlaku_sampai: form.berlakuSampai,
          gambar_url: form.gambarUrl.trim(),
        }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; nama?: string } | null
      if (!res.ok) {
        setGalat(d?.error || 'Template gagal diajukan.')
        return
      }
      setSukses(
        `Template "${form.judul.trim()}" sudah dikirim ke WhatsApp untuk diperiksa. Begitu disetujui, template ini muncul sendiri di pilihan Broadcast.`,
      )
      setForm(ISIAN_KOSONG)
      setGambarRusak(false)
      setVersi((n) => n + 1)
    } catch {
      setGalat('Template gagal diajukan. Jaringan bermasalah, coba lagi.')
    } finally {
      setSibuk(false)
    }
  }

  const tombolPratinjau: TombolPratinjau[] =
    form.jenisTombol !== 'tidak' && form.tombolTeks.trim() !== ''
      ? [{ teks: form.tombolTeks.trim(), tipe: form.jenisTombol }]
      : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-ink">Templat Pesan</h1>
        <p className="text-sm text-ink-soft">
          Template langsung diajukan ke WhatsApp begitu tombolnya ditekan dan tidak bisa ditarik
          kembali. Baca ulang tulisannya di pratinjau sebelum mengirim.
        </p>
      </div>

      {!metaSiap ? (
        <p className="kartu p-4 text-sm text-warn">
          Kredensial Meta belum dipasang di lingkungan ini. Daftar template kosong dan pengajuan akan
          ditolak sampai kredensialnya terpasang.
        </p>
      ) : null}

      {sukses ? <p className="kartu border-ok p-4 text-sm text-ink">{sukses}</p> : null}
      {galat ? <p className="kartu border-bad p-4 text-sm text-bad">{galat}</p> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="kartu min-w-0 flex-1 space-y-4 p-5">
          <p className="font-medium text-ink">Buat template baru</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="judul" className="text-sm font-medium text-ink">
                Nama template
              </label>
              <input
                id="judul"
                value={form.judul}
                onChange={(e) => ubah('judul', e.target.value)}
                maxLength={60}
                placeholder="Sapa Tamu Lama Review Google"
                className="kolom-isian"
              />
              <p className="text-xs text-ink-soft">
                Buat staf saja, tamu tidak melihat nama ini. Nama resminya di WhatsApp dibuat sendiri
                dari tulisan ini.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="kategori" className="text-sm font-medium text-ink">
                Jenis pesan
              </label>
              <Pilih
                id="kategori"
                nilai={form.kategori}
                onPilih={(v) => ubah('kategori', v)}
                opsi={[
                  { nilai: 'MARKETING', label: 'Promo', catatan: 'Penawaran, sapaan, ajakan' },
                  {
                    nilai: 'UTILITY',
                    label: 'Info transaksi',
                    catatan: 'Konfirmasi booking, pengingat, info pesanan',
                  },
                ]}
              />
              <p className="text-xs text-ink-soft">
                Salah jenis bikin WhatsApp menolak template. Ucapan terima kasih dan promo masuk
                Promo.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ringkas" className="text-sm font-medium text-ink">
              Keterangan singkat (boleh kosong)
            </label>
            <input
              id="ringkas"
              value={form.ringkas}
              onChange={(e) => ubah('ringkas', e.target.value)}
              maxLength={120}
              placeholder="Muncul di kartu template saat memilih template untuk broadcast"
              className="kolom-isian"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="isi" className="text-sm font-medium text-ink">
              Isi pesan
            </label>
            <textarea
              id="isi"
              rows={7}
              value={form.isi}
              onChange={(e) => ubah('isi', e.target.value)}
              maxLength={PANJANG_ISI_MAKS}
              placeholder="Tulis kalimat lengkap, seperti yang mau dibaca tamu."
              className="kolom-isian resize-none"
            />
            <div className="flex justify-between text-xs text-ink-soft">
              <span>Minimal {PANJANG_ISI_MIN} huruf. Jangan pakai tanda {'{{ }}'}.</span>
              <span>
                {form.isi.length}/{PANJANG_ISI_MAKS}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="footer" className="text-sm font-medium text-ink">
              Footer (boleh kosong)
            </label>
            <input
              id="footer"
              value={form.footer}
              onChange={(e) => ubah('footer', e.target.value)}
              maxLength={60}
              placeholder="Rancabango Hotel and Resort"
              className="kolom-isian"
            />
            <p className="text-xs text-ink-soft">
              Baris kecil abu-abu di bawah pesan. Biasanya nama hotel.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink">Tombol pesan</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <TombolPilihan
                aktif={form.jenisTombol === 'tidak'}
                onKlik={() => ubah('jenisTombol', 'tidak')}
              >
                Tanpa tombol
              </TombolPilihan>
              <TombolPilihan
                aktif={form.jenisTombol === 'situs'}
                onKlik={() => ubah('jenisTombol', 'situs')}
              >
                Buka link website
              </TombolPilihan>
              <TombolPilihan
                aktif={form.jenisTombol === 'balasan'}
                onKlik={() => ubah('jenisTombol', 'balasan')}
              >
                Tombol balasan cepat
              </TombolPilihan>
            </div>

            {form.jenisTombol === 'situs' ? (
              <div className="space-y-1.5 pt-2">
                <label htmlFor="tombolUrl" className="text-sm font-medium text-ink">
                  Link yang dibuka tombol
                </label>
                <input
                  id="tombolUrl"
                  value={form.tombolUrl}
                  onChange={(e) => ubah('tombolUrl', e.target.value)}
                  placeholder="https://g.page/r/…/review"
                  className="kolom-isian"
                />
                <p className="text-xs text-ink-soft">
                  Link ke wa.me ditolak WhatsApp. Link Google, website, atau booking engine diterima.
                </p>
              </div>
            ) : null}

            {form.jenisTombol !== 'tidak' ? (
              <div className="space-y-1.5 pt-2">
                <label htmlFor="tombolTeks" className="text-sm font-medium text-ink">
                  Tulisan di tombol
                </label>
                <input
                  id="tombolTeks"
                  value={form.tombolTeks}
                  onChange={(e) => ubah('tombolTeks', e.target.value)}
                  maxLength={25}
                  placeholder={form.jenisTombol === 'situs' ? 'Tulis Ulasan' : 'Saya Mau Tanya'}
                  className="kolom-isian"
                />
                <p className="text-xs text-ink-soft">
                  Tulisan yang tamu lihat di tombolnya, maksimal 25 huruf.
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="berlaku" className="text-sm font-medium text-ink">
                Berlaku sampai (boleh kosong)
              </label>
              <input
                id="berlaku"
                type="date"
                value={form.berlakuSampai}
                min={hariIniJakarta()}
                onChange={(e) => ubah('berlakuSampai', e.target.value)}
                className="kolom-isian"
              />
              <p className="text-xs text-ink-soft">
                Catatan buat staf saja. Kosongkan untuk template yang dipakai terus, misalnya ucapan
                terima kasih.
              </p>
            </div>

            <div className="space-y-1.5">
              <UnggahGambar
                nilai={form.gambarUrl}
                onUbah={(url) => {
                  // Alamat baru: gambar lama belum tentu masih rusak, coba muat lagi.
                  ubah('gambarUrl', url)
                  setGambarRusak(false)
                }}
              />
              {gambarRusak ? (
                <p className="text-xs text-bad">Gambar tidak bisa dibuka dari alamat itu.</p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            disabled={sibuk}
            onClick={ajukan}
            className="tombol tombol-utama w-full sm:w-auto"
          >
            {sibuk ? 'Mengirim ke WhatsApp...' : 'Ajukan template ke WhatsApp'}
          </button>
        </div>

        <div className="w-full shrink-0 lg:w-80">
          <p className="mb-2 text-xs font-medium text-ink-soft">Tampilan pesan di WhatsApp tamu</p>
          <GelembungWa
            isi={form.isi.trim() || 'Isi pesan akan muncul di sini.'}
            footer={form.footer.trim()}
            gambarUrl={gambarRusak ? '' : form.gambarUrl.trim()}
            tombol={tombolPratinjau}
          />
          {form.gambarUrl.trim() && !gambarRusak ? (
            <img
              src={form.gambarUrl.trim()}
              onError={() => setGambarRusak(true)}
              alt=""
              className="hidden"
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="kartu p-5">
          <p className="font-medium text-ink">Siap dipakai</p>
          {siap.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">Belum ada template yang disetujui.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {siap.map((t) => (
                <KartuTemplate key={t.nama} t={t} />
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
                <KartuTemplate key={t.nama} t={t} />
              ))}
            </ul>
          )}

          {takDidukung.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-sm font-medium text-ink">Disetujui tapi pakai isian berubah</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Isinya memuat {'{{1}}'} yang harus diisi per orang. Kirim Pesan mengirim satu isi yang
                sama ke semua tamu, jadi template ini tidak bisa dipakai dari sini.
              </p>
              <ul className="mt-2 space-y-2">
                {takDidukung.map((t) => (
                  <KartuTemplate key={t.nama} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
