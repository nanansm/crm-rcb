import { useState } from 'react'

type Props = { onMasuk: () => void }

export default function Login({ onMasuk }: Props) {
  const [email, setEmail] = useState('')
  const [sandi, setSandi] = useState('')
  const [galat, setGalat] = useState('')
  const [kirim, setKirim] = useState(false)

  async function masuk(e: React.FormEvent) {
    e.preventDefault()
    setGalat('')
    setKirim(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: sandi }),
      })
      if (res.ok) {
        onMasuk()
        return
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      setGalat(data?.error ?? 'Tidak bisa masuk. Coba lagi.')
    } catch {
      setGalat('Jaringan bermasalah. Coba lagi.')
    } finally {
      setKirim(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo/bird-teal.webp" alt="" className="h-9 w-9 object-contain" />
          <div>
            <p className="font-display text-lg leading-tight text-ink">CRM WhatsApp</p>
            <p className="text-sm text-ink-soft">Hotel Rancabango</p>
          </div>
        </div>

        <form onSubmit={masuk} className="kartu space-y-4 p-6">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="kolom-isian"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sandi" className="block text-sm font-medium text-ink">
              Kata sandi
            </label>
            <input
              id="sandi"
              type="password"
              autoComplete="current-password"
              required
              value={sandi}
              onChange={(e) => setSandi(e.target.value)}
              className="kolom-isian"
            />
          </div>

          {galat ? (
            <p role="alert" className="rounded-xl border border-line bg-canvas-2 px-3 py-2 text-sm text-bad">
              {galat}
            </p>
          ) : null}

          <button type="submit" disabled={kirim} className="tombol tombol-utama w-full">
            {kirim ? 'Memeriksa...' : 'Masuk'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-soft">
          Akun dibuat oleh admin. Lupa sandi, hubungi admin.
        </p>
      </div>
    </div>
  )
}
