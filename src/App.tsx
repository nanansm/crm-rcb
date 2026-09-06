import { useEffect, useState } from 'react'
import Broadcast from './pages/Broadcast'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Kontak from './pages/Kontak'
import Login from './pages/Login'
import TemplatePage from './pages/Template'

type StatusSesi = 'memuat' | 'keluar' | 'masuk'

type Halaman = 'dashboard' | 'inbox' | 'kontak' | 'broadcast' | 'template' | 'pengaturan'

type ItemMenu = { id: Halaman; label: string; urut?: string }

/**
 * Menu dikelompokkan menurut urutan kerja, bukan menurut kemiripan teknis.
 * Ringkasan ditaruh paling atas dan jadi halaman pembuka: staf melihat dulu apa
 * yang perlu ditindak hari itu, baru masuk ke pekerjaannya.
 * Templat WAJIB berada SEBELUM Kirim Pesan dan diberi nomor: pengajuan templat
 * ke Meta baru disetujui berjam-jam sampai berhari-hari kemudian, jadi staf yang
 * membuka Kirim Pesan lebih dulu akan menemukan daftar templat kosong dan mentok.
 * Menjorokkan Templat ke bawah Kirim Pesan justru menyuruh urutan yang salah.
 */
const KELOMPOK: Array<{ judul: string; item: ItemMenu[] }> = [
  {
    judul: '',
    item: [{ id: 'dashboard', label: 'Ringkasan' }],
  },
  {
    judul: 'Pekerjaan harian',
    item: [
      { id: 'inbox', label: 'Inbox' },
      { id: 'kontak', label: 'Kontak & Daftar Tamu' },
    ],
  },
  {
    judul: 'Kirim pesan',
    item: [
      { id: 'template', label: 'Templat Pesan', urut: '1' },
      { id: 'broadcast', label: 'Kirim Pesan', urut: '2' },
    ],
  },
]

/** Halaman pembuka setelah login, dan tujuan kalau alamat di URL tidak dikenal. */
const HALAMAN_AWAL: Halaman = 'dashboard'

const MENU: ItemMenu[] = KELOMPOK.flatMap((k) => k.item)

type Staf = { nama: string }

const JUDUL_DASAR = 'CRM Rancabango'
const JEDA_BADGE_MS = 8000

/**
 * Badge jumlah tamu yang menunggu dibalas, ditulis ke judul tab.
 *
 * Dipasang di App, bukan di halaman Inbox: App tidak pernah dibongkar selama staf
 * masih login, jadi badge tetap terbaca dari Ringkasan, Kontak, dan Kirim Pesan --
 * justru di situlah gunanya, karena tab CRM biasanya tertimbun tab lain.
 * Berhenti menarik saat tab tidak terlihat supaya tidak membebani D1 percuma.
 */
function useBadgeMenunggu(aktif: boolean) {
  const [jumlah, setJumlah] = useState(0)

  useEffect(() => {
    if (!aktif) return
    let batal = false

    const tarik = () => {
      if (document.hidden) return
      fetch('/api/nunggu')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
        .then((d: { nunggu_dibalas: number }) => !batal && setJumlah(d.nunggu_dibalas))
        // Satu tarikan gagal tidak boleh mengosongkan badge -- angka lama tetap
        // dipakai sampai tarikan berikutnya berhasil.
        .catch(() => {})
    }

    tarik()
    const t = setInterval(tarik, JEDA_BADGE_MS)
    // Staf membuka lagi tab yang lama ditinggal: jangan menunggu sampai 8 detik
    // berikutnya untuk memperbarui angka yang mungkin sudah basi.
    document.addEventListener('visibilitychange', tarik)
    return () => {
      batal = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', tarik)
    }
  }, [aktif])

  // Digerbangi `aktif` juga: begitu staf keluar, judul tab tidak boleh menyimpan
  // sisa angka dari sesi sebelumnya walau nilainya masih tersimpan di state.
  useEffect(() => {
    document.title = aktif && jumlah > 0 ? `(${jumlah}) Inbox — ${JUDUL_DASAR}` : JUDUL_DASAR
  }, [aktif, jumlah])
}

function Merek() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo/bird-teal.webp" alt="Rancabango" className="size-8 shrink-0 object-contain" />
      <div className="min-w-0">
        <p className="font-display truncate text-base leading-tight text-ink">customer management</p>
        <p className="truncate text-xs text-ink-soft">Staf internal</p>
      </div>
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<StatusSesi>('memuat')
  const [staf, setStaf] = useState<Staf | null>(null)
  const [menuTerbuka, setMenuTerbuka] = useState(false)
  const [halaman, setHalaman] = useState<Halaman>(() => {
    const dariHash = window.location.hash.slice(1) as Halaman
    return MENU.some((item) => item.id === dariHash) ? dariHash : HALAMAN_AWAL
  })

  useBadgeMenunggu(status === 'masuk')

  useEffect(() => {
    window.location.hash = halaman
  }, [halaman])

  // dengarkan tombol Back/Forward browser: alamat pindah tanpa lewat setHalaman
  useEffect(() => {
    const onHashChange = () => {
      const dariHash = window.location.hash.slice(1) as Halaman
      if (MENU.some((item) => item.id === dariHash)) setHalaman(dariHash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    let batal = false
    fetch('/api/me')
      .then((res) => (res.status === 401 || !res.ok ? null : res.json()))
      .then((data: Staf | null) => {
        if (batal) return
        if (data) {
          setStaf(data)
          setStatus('masuk')
        } else {
          setStatus('keluar')
        }
      })
      .catch(() => {
        if (!batal) setStatus('keluar')
      })
    return () => {
      batal = true
    }
  }, [])

  if (status === 'memuat') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas-2">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-teal" />
      </div>
    )
  }

  if (status === 'keluar') {
    return <Login onMasuk={() => setStatus('masuk')} />
  }

  const keluar = () => {
    fetch('/api/logout', { method: 'POST' }).finally(() => {
      setStaf(null)
      setStatus('keluar')
    })
  }

  const buka = (id: Halaman) => {
    setHalaman(id)
    setMenuTerbuka(false)
  }

  const daftarMenu = (
    <nav className="flex flex-col gap-4">
      {KELOMPOK.map((kelompok, i) => (
        <div key={kelompok.judul || `kelompok-${i}`} className="flex flex-col gap-1">
          {kelompok.judul ? (
            <p className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
              {kelompok.judul}
            </p>
          ) : null}
          {kelompok.item.map((item) => {
            const aktif = item.id === halaman
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => buka(item.id)}
                aria-current={aktif ? 'page' : undefined}
                className={
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ' +
                  (aktif ? 'bg-teal text-white' : 'text-ink-soft hover:bg-canvas-2 hover:text-ink')
                }
              >
                {item.urut ? (
                  <span
                    aria-hidden
                    className={
                      'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ' +
                      (aktif ? 'bg-white/20 text-white' : 'bg-canvas-2 text-ink-soft')
                    }
                  >
                    {item.urut}
                  </span>
                ) : null}
                {item.label}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-dvh flex-col bg-canvas md:flex-row">
      {/* Batang atas khusus layar kecil. Menu disembunyikan di balik tombol
          supaya isi halaman dapat seluruh lebar layar HP, bukan dipotong
          deretan menu yang harus digeser ke samping. */}
      <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 md:hidden">
        <Merek />
        <button
          type="button"
          onClick={() => setMenuTerbuka((b) => !b)}
          aria-expanded={menuTerbuka}
          aria-controls="menu-utama"
          aria-label={menuTerbuka ? 'Tutup menu' : 'Buka menu'}
          className="tombol tombol-garis flex size-11 shrink-0 items-center justify-center p-0"
        >
          <span aria-hidden className="relative block h-3.5 w-5">
            <span
              className={
                'absolute left-0 block h-0.5 w-5 rounded bg-ink transition-transform ' +
                (menuTerbuka ? 'top-1.5 rotate-45' : 'top-0')
              }
            />
            <span
              className={
                'absolute top-1.5 left-0 block h-0.5 w-5 rounded bg-ink transition-opacity ' +
                (menuTerbuka ? 'opacity-0' : 'opacity-100')
              }
            />
            <span
              className={
                'absolute left-0 block h-0.5 w-5 rounded bg-ink transition-transform ' +
                (menuTerbuka ? 'top-1.5 -rotate-45' : 'top-3')
              }
            />
          </span>
        </button>
      </header>

      {menuTerbuka ? (
        <div id="menu-utama" className="border-b border-line bg-white px-3 py-3 md:hidden">
          {daftarMenu}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
            <p className="truncate text-sm text-ink">{staf?.nama ?? 'Staf'}</p>
            <button type="button" onClick={keluar} className="tombol tombol-garis text-sm">
              Keluar
            </button>
          </div>
        </div>
      ) : null}

      <aside className="hidden shrink-0 flex-col border-line bg-white md:flex md:w-64 md:border-r">
        <div className="p-4">
          <Merek />
        </div>

        <div className="px-3">{daftarMenu}</div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line p-4">
          <p className="truncate text-sm text-ink">{staf?.nama ?? 'Staf'}</p>
          <button type="button" onClick={keluar} className="tombol tombol-garis text-sm">
            Keluar
          </button>
        </div>
      </aside>

      <main className="w-full flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[1400px]">
          {halaman === 'inbox' ? (
            <Inbox />
          ) : halaman === 'kontak' ? (
            <Kontak />
          ) : halaman === 'broadcast' ? (
            <Broadcast />
          ) : halaman === 'template' ? (
            <TemplatePage />
          ) : halaman === 'dashboard' ? (
            <Dashboard nama={staf?.nama ?? 'Staf'} />
          ) : (
            <div className="space-y-4">
              <h1 className="font-display text-2xl text-ink">
                {MENU.find((item) => item.id === halaman)?.label}
              </h1>
              <div className="kartu p-5">
                <p className="text-ink-soft">Belum dibangun.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
