import { useEffect, useState } from 'react'
import Broadcast from './pages/Broadcast'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Kontak from './pages/Kontak'
import Login from './pages/Login'
import TemplatePage from './pages/Template'

type StatusSesi = 'memuat' | 'keluar' | 'masuk'

type Halaman = 'dashboard' | 'inbox' | 'kontak' | 'broadcast' | 'template' | 'pengaturan'

const MENU: Array<{ id: Halaman; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'kontak', label: 'Kontak' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'template', label: 'Template' },
]

type Staf = { nama: string }

export default function App() {
  const [status, setStatus] = useState<StatusSesi>('memuat')
  const [staf, setStaf] = useState<Staf | null>(null)
  const [halaman, setHalaman] = useState<Halaman>(() => {
    const dariHash = window.location.hash.slice(1) as Halaman
    return MENU.some((item) => item.id === dariHash) ? dariHash : 'inbox'
  })

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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-white md:w-64 md:border-b-0 md:border-r">
        <div className="p-4">
          <p className="font-display text-lg text-ink">CRM Rancabango</p>
          <p className="text-sm text-ink-soft">Staf internal</p>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:px-3 md:pb-0">
          {MENU.map((item) => {
            const aktif = item.id === halaman
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setHalaman(item.id)}
                className={
                  'shrink-0 rounded-full px-3 py-1.5 text-left text-sm font-medium transition-colors md:rounded-lg ' +
                  (aktif
                    ? 'bg-teal text-white'
                    : 'text-ink-soft hover:bg-canvas-2 hover:text-ink')
                }
              >
                {item.label}
              </button>
            )
          })}
        </nav>

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
