import { useEffect, useRef, useState } from 'react'
import Pilih from '../komponen/Pilih'

type RingkasPercakapan = {
  nomor: string
  nama: string | null
  status_agent: string
  terakhir_pesan_pada: string | null
  cuplikan: string | null
  dalam_jendela: boolean
  arah_terakhir: string | null
  menunggu_dibalas: boolean
}

type Pesan = {
  id: number
  arah: string
  pengirim: string
  teks: string | null
  waktu: string
}

type Detail = {
  kontak: { nomor: string; nama: string | null; opt_out: number }
  percakapan: { status_agent: string; staf_id: number | null }
  dalam_jendela: boolean
  sisa_jendela_detik: number
  pesan: Pesan[]
}

type TemplateSiap = { nama: string; judul: string; isi: string; punya_gambar: boolean }

const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' })
const tanggal = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })

function labelWaktu(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hariIni = new Date().toDateString() === d.toDateString()
  return hariIni ? jam.format(d) : tanggal.format(d)
}

function sisaJendela(detik: number) {
  if (detik <= 0) return 'Jendela 24 jam tutup'
  const j = Math.floor(detik / 3600)
  const m = Math.floor((detik % 3600) / 60)
  return j > 0 ? `Sisa jendela ${j} jam ${m} menit` : `Sisa jendela ${m} menit`
}

function lamaMenunggu(iso: string | null) {
  if (!iso) return 'nunggu'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'nunggu'
  const menit = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  if (menit < 60) return `nunggu ${menit} menit`
  return `nunggu ${Math.floor(menit / 60)} jam`
}

export default function Inbox() {
  const [daftar, setDaftar] = useState<RingkasPercakapan[]>([])
  const [cari, setCari] = useState('')
  const [dipilih, setDipilih] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [galat, setGalat] = useState('')
  const [draf, setDraf] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [galatBalas, setGalatBalas] = useState('')
  const [muatUlang, setMuatUlang] = useState(0)
  const [versiDaftar, setVersiDaftar] = useState(0)
  const [daftarTemplate, setDaftarTemplate] = useState<TemplateSiap[] | null>(null)
  const [galatTemplate, setGalatTemplate] = useState(false)
  const [pilihTemplate, setPilihTemplate] = useState('')
  const [infoTemplate, setInfoTemplate] = useState('')
  const kotakPesan = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let batal = false
    const t = setTimeout(() => {
      const q = cari.trim() ? `?cari=${encodeURIComponent(cari.trim())}` : ''
      fetch(`/api/percakapan${q}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
        .then((d: { percakapan: RingkasPercakapan[] }) => {
          if (batal) return
          setDaftar(d.percakapan)
          setGalat('')
        })
        .catch(() => !batal && setGalat('Daftar percakapan gagal dimuat.'))
        .finally(() => !batal && setMemuat(false))
    }, 250)
    return () => {
      batal = true
      clearTimeout(t)
    }
    // versiDaftar cuma dipakai supaya effect ini jalan lagi tiap segarkan()
    // dipanggil — nilainya sendiri tidak dibaca.
  }, [cari, versiDaftar])

  useEffect(() => {
    if (!dipilih) return
    let batal = false
    fetch(`/api/percakapan/${encodeURIComponent(dipilih)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
      .then((d: Detail) => !batal && setDetail(d))
      // Polling tiap 8 detik: satu tarikan gagal TIDAK boleh menghapus chat yang
      // sedang dibaca staf. Biarkan isi lama tetap tampil, tarikan berikutnya
      // yang memperbaiki.
      .catch(() => {})
    return () => {
      batal = true
    }
  }, [dipilih, muatUlang])

  useEffect(() => {
    setPilihTemplate('')
    setInfoTemplate('')
    setDaftarTemplate(null)
    setGalatTemplate(false)
  }, [dipilih])

  // Lazy-load: cuma ditarik begitu benar-benar dibutuhkan (jendela tutup,
  // sudah diambil alih, tamu belum opt-out), bukan tiap percakapan dibuka.
  useEffect(() => {
    if (!detail) return
    if (detail.kontak.opt_out) return
    if (detail.percakapan.status_agent !== 'diambil_alih') return
    if (detail.dalam_jendela) return
    if (daftarTemplate !== null) return

    let batal = false
    fetch('/api/template')
      .then((res) => {
        if (!res.ok) throw new Error('gagal_muat_template')
        return res.json() as Promise<{ template?: TemplateSiap[] }>
      })
      .then((body) => {
        if (batal) return
        setDaftarTemplate((body.template ?? []).filter((t) => !t.punya_gambar))
      })
      .catch(() => {
        if (batal) return
        setDaftarTemplate([])
        setGalatTemplate(true)
      })

    return () => {
      batal = true
    }
  }, [detail, daftarTemplate])

  // Layar ini satu-satunya jalan staf membalas tamu (nomor Cloud API, tanpa
  // WhatsApp Web) — harus hidup sendiri, tidak boleh nunggu staf klik.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || sibuk) return
      setVersiDaftar((n) => n + 1)
      if (dipilih) setMuatUlang((n) => n + 1)
    }, 8000)
    return () => clearInterval(t)
  }, [dipilih, sibuk])

  // Dipakai untuk baris penanda di atas daftar. Sengaja dihitung dari `daftar`
  // yang sudah tersaring kotak cari: baris ini menerangkan daftar yang terlihat.
  const jumlahMenunggu = daftar.filter((p) => p.menunggu_dibalas).length

  // Badge judul tab TIDAK ditulis dari sini. Dulu iya, dan akibatnya dua: badge
  // hilang begitu staf pindah halaman (komponen ini dibongkar), dan angkanya ikut
  // menyusut saat staf mengetik di kotak cari karena `daftar` sudah tersaring.
  // Sekarang ditulis di App.tsx dari angka utuh -- lihat `src/App.tsx`.

  const nomorTerakhirDigulir = useRef<string | null>(null)
  const jumlahPesan = detail?.pesan.length ?? 0

  useEffect(() => {
    const kotak = kotakPesan.current
    if (!kotak || !dipilih) return

    // Percakapan baru dibuka: selalu mulai dari pesan terbaru.
    const gantiPercakapan = nomorTerakhirDigulir.current !== dipilih
    // Pesan menyusul saat polling: cuma ikut turun kalau staf memang sedang
    // berada di dasar. Kalau dia lagi scroll ke atas membaca riwayat, menyeret
    // layarnya ke bawah tiap 8 detik jauh lebih menyebalkan daripada berguna.
    const diDasar = kotak.scrollHeight - kotak.scrollTop - kotak.clientHeight < 80

    if (gantiPercakapan || diDasar) {
      kotak.scrollTop = kotak.scrollHeight
      nomorTerakhirDigulir.current = dipilih
    }
  }, [dipilih, jumlahPesan])

  const segarkan = () => {
    // setCari((c) => c) LAMA nulis nilai yang SAMA — React bail-out render,
    // effect di atas (dependency [cari]) tidak pernah jalan ulang. Makanya
    // pakai counter versiDaftar yang nilainya selalu BEDA tiap dipanggil.
    setMuatUlang((n) => n + 1)
    setVersiDaftar((n) => n + 1)
  }

  async function ubahPenanganan(jalur: 'ambil-alih' | 'kembalikan') {
    if (!dipilih) return
    setSibuk(true)
    setGalatBalas('')
    try {
      const res = await fetch(`/api/percakapan/${encodeURIComponent(dipilih)}/${jalur}`, { method: 'POST' })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        setGalatBalas(
          d?.error === 'sudah_dipegang'
            ? 'Percakapan ini sedang dipegang staf lain.'
            : 'Perubahan gagal. Coba lagi.',
        )
        return
      }
      segarkan()
    } finally {
      setSibuk(false)
    }
  }

  async function kirimBalasan() {
    if (!dipilih || !draf.trim()) return
    setSibuk(true)
    setGalatBalas('')
    try {
      const res = await fetch(`/api/percakapan/${encodeURIComponent(dipilih)}/balas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teks: draf.trim() }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string; pesan?: string } | null
        setGalatBalas(
          d?.error === 'di_luar_jendela'
            ? 'Jendela 24 jam sudah tutup. Kirim template untuk membuka percakapan.'
            : d?.pesan || 'Pesan gagal dikirim. Belum ada yang tersimpan.',
        )
        return
      }
      setDraf('')
      segarkan()
    } finally {
      setSibuk(false)
    }
  }

  async function kirimTemplateKeTamu() {
    if (!dipilih || !pilihTemplate || sibuk) return
    setSibuk(true)
    setGalatBalas('')
    setInfoTemplate('')
    try {
      const res = await fetch(`/api/percakapan/${encodeURIComponent(dipilih)}/kirim-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: pilihTemplate }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; pesan?: string } | null
        const pesan =
          body?.error === 'template_wajib_gambar'
            ? 'Template ini butuh gambar. Kirim lewat halaman Broadcast.'
            : body?.error === 'belum_diambil_alih'
              ? 'Ambil alih dulu sebelum mengirim.'
              : body?.error === 'opt_out'
                ? 'Tamu menolak dihubungi.'
                : body?.error === 'gagal_kirim'
                  ? body.pesan === 'meta_belum_dikonfigurasi'
                    ? 'Kredensial Meta belum dipasang.'
                    : 'Template gagal dikirim. Belum ada yang tersimpan.'
                  : body?.pesan || body?.error || 'Template gagal dikirim.'
        setGalatBalas(pesan)
        return
      }
      // res.json() sengaja TIDAK dipanggil di jalur sukses -- wamid tidak
      // dipakai UI, dan body 200 yang gagal di-parse jangan sampai jatuh ke
      // catch generik lalu bilang "belum ada yang tersimpan" padahal Meta
      // sudah terima.
      setPilihTemplate('')
      setInfoTemplate('Template terkirim. Kolom balasan terbuka lagi begitu tamu membalas.')
      segarkan()
    } catch {
      setGalatBalas('Template gagal dikirim. Belum ada yang tersimpan.')
    } finally {
      setSibuk(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-ink">Inbox</h1>
        <p className="text-sm text-ink-soft">{daftar.length} percakapan</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="kartu flex max-h-[70vh] flex-col overflow-hidden">
          <div className="border-b border-line p-3">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari nomor atau nama"
              className="kolom-isian"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {memuat ? (
              <p className="p-4 text-sm text-ink-soft">Memuat...</p>
            ) : galat ? (
              <p className="p-4 text-sm text-bad">{galat}</p>
            ) : daftar.length === 0 ? (
              <p className="p-4 text-sm text-ink-soft">
                Belum ada percakapan. Baris muncul sendiri setelah tamu chat ke nomor agent.
              </p>
            ) : (
              <ul>
                {jumlahMenunggu > 0 ? (
                  <li className="border-b border-line bg-canvas-2 px-4 py-2 text-sm font-medium text-bad">
                    {jumlahMenunggu} tamu nunggu dibalas
                  </li>
                ) : null}
                {daftar.map((p) => (
                  <li key={p.nomor}>
                    <button
                      type="button"
                      onClick={() => {
                        // Kosongkan di sini, bukan di effect: isi percakapan
                        // tamu sebelumnya tidak boleh sempat terbaca sebagai
                        // milik tamu yang baru dibuka.
                        if (p.nomor !== dipilih) setDetail(null)
                        setDipilih(p.nomor)
                        setDraf('')
                        setGalatBalas('')
                      }}
                      className={
                        'w-full border-b border-line px-4 py-3 text-left transition-colors ' +
                        (p.nomor === dipilih ? 'bg-canvas-2' : 'hover:bg-canvas')
                      }
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={
                            'flex items-center gap-1.5 truncate ' +
                            (p.menunggu_dibalas ? 'font-semibold text-ink' : 'font-medium text-ink')
                          }
                        >
                          {p.menunggu_dibalas ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-bad" />
                          ) : null}
                          <span className="truncate">{p.nama || p.nomor}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-soft">
                          {labelWaktu(p.terakhir_pesan_pada)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-soft">{p.cuplikan || '—'}</p>
                      {p.menunggu_dibalas ? (
                        <p className="mt-0.5 text-xs text-bad">{lamaMenunggu(p.terakhir_pesan_pada)}</p>
                      ) : null}
                      <div className="mt-1.5 flex gap-1.5">
                        {p.status_agent === 'diambil_alih' ? (
                          <span className="rounded-full bg-canvas-2 px-2 py-0.5 text-xs text-warn">
                            Dipegang staf
                          </span>
                        ) : null}
                        {!p.dalam_jendela ? (
                          <span className="rounded-full bg-canvas-2 px-2 py-0.5 text-xs text-ink-soft">
                            Di luar 24 jam
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="kartu flex max-h-[70vh] flex-col overflow-hidden">
          {!detail ? (
            <p className="p-5 text-sm text-ink-soft">Pilih satu percakapan untuk membaca riwayatnya.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <div>
                  <p className="font-medium text-ink">{detail.kontak.nama || detail.kontak.nomor}</p>
                  <p className="text-xs text-ink-soft">{detail.kontak.nomor}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className={'text-xs ' + (detail.dalam_jendela ? 'text-ink-soft' : 'text-warn')}>
                    {sisaJendela(detail.sisa_jendela_detik)}
                  </p>
                  {detail.percakapan.status_agent === 'diambil_alih' ? (
                    <button
                      type="button"
                      disabled={sibuk}
                      onClick={() => ubahPenanganan('kembalikan')}
                      className="tombol tombol-garis text-sm"
                    >
                      Kembalikan ke agent
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={sibuk}
                      onClick={() => ubahPenanganan('ambil-alih')}
                      className="tombol tombol-utama text-sm"
                    >
                      Ambil alih
                    </button>
                  )}
                </div>
              </div>

              <div
                ref={kotakPesan}
                data-testid="jendela-chat"
                className="flex-1 space-y-2 overflow-y-auto bg-canvas px-5 py-4"
              >
                {detail.pesan.map((m) => {
                  const dariTamu = m.arah === 'masuk'
                  return (
                    <div key={m.id} className={dariTamu ? 'flex' : 'flex justify-end'}>
                      <div
                        className={
                          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ' +
                          (dariTamu
                            ? 'border border-line bg-white text-ink'
                            : 'bg-teal text-white')
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{m.teks || '(tanpa teks)'}</p>
                        <p className={'mt-1 text-[11px] ' + (dariTamu ? 'text-ink-soft' : 'text-white/70')}>
                          {m.pengirim === 'staf' ? 'Staf · ' : m.pengirim === 'agent' ? 'Agent · ' : ''}
                          {labelWaktu(m.waktu)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2 border-t border-line px-5 py-3">
                {galatBalas ? <p className="text-sm text-bad">{galatBalas}</p> : null}

                {detail.kontak.opt_out ? (
                  <p className="text-sm text-warn">
                    Tamu ini menolak dihubungi. Balasan dikunci.
                  </p>
                ) : detail.percakapan.status_agent !== 'diambil_alih' ? (
                  <p className="text-sm text-ink-soft">
                    Agent masih menangani percakapan ini. Ambil alih dulu sebelum membalas, supaya
                    tamu tidak menerima dua jawaban.
                  </p>
                ) : !detail.dalam_jendela ? (
                  <div className="space-y-2">
                    <p className="text-sm text-warn">
                      Jendela 24 jam tutup. Teks bebas ditolak WhatsApp. Kirim template untuk membuka
                      percakapan lagi.
                    </p>
                    {infoTemplate ? <p className="text-sm text-ok">{infoTemplate}</p> : null}
                    {daftarTemplate === null ? (
                      <p className="text-xs text-ink-soft">Memuat template…</p>
                    ) : galatTemplate ? (
                      <p className="text-sm text-bad">
                        Daftar template gagal dimuat. Coba muat ulang halaman.
                      </p>
                    ) : daftarTemplate.length === 0 ? (
                      <p className="text-sm text-ink-soft" data-testid="template-kosong">
                        Belum ada template siap kirim (disetujui, tanpa variabel, tanpa gambar). Template
                        bergambar dikirim lewat halaman Broadcast.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-end gap-2">
                          <Pilih
                            id="template-inbox"
                            nilai={pilihTemplate}
                            opsi={daftarTemplate.map((t) => ({
                              nilai: t.nama,
                              label: t.judul || t.nama,
                              catatan: t.isi ? t.isi.slice(0, 60) : undefined,
                            }))}
                            onPilih={setPilihTemplate}
                            placeholder="Pilih template"
                          />
                          <button
                            type="button"
                            disabled={sibuk || !pilihTemplate}
                            onClick={kirimTemplateKeTamu}
                            data-testid="tombol-kirim-template"
                            className="tombol tombol-utama shrink-0"
                          >
                            Kirim Template
                          </button>
                        </div>
                        {pilihTemplate ? (
                          <p className="whitespace-pre-wrap text-xs text-ink-soft">
                            {daftarTemplate.find((t) => t.nama === pilihTemplate)?.isi ?? ''}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={draf}
                        onChange={(e) => setDraf(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            if (!sibuk && draf.trim()) kirimBalasan()
                          }
                        }}
                        rows={2}
                        placeholder="Tulis balasan"
                        className="kolom-isian resize-none"
                      />
                      <button
                        type="button"
                        disabled={sibuk || !draf.trim()}
                        onClick={kirimBalasan}
                        className="tombol tombol-utama shrink-0"
                      >
                        Kirim
                      </button>
                    </div>
                    <p className="text-xs text-ink-soft">Enter kirim · Shift+Enter baris baru</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
