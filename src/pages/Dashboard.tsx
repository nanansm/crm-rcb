import { useEffect, useState } from 'react'
import Grafik, { type TitikGrafik } from '../komponen/Grafik'

type Ringkasan = {
  diperbarui: string
  nomor: { display: string; nama_terverifikasi: string; kualitas: string; status: string }
  bulan_ini: { terkirim: number; sampai: number; dibaca: number; biaya: number; biaya_asli: boolean }
  harian: TitikGrafik[]
  kuota: { terpakai: number; sisa: number; batas: number }
  perlu_tindakan: { nunggu_dibalas: number; nunggu_lewat_ambang: number; jendela_hampir_tutup: number }
  percakapan: { diambil_alih: number; masuk_24jam: number; dalam_jendela: number }
  kontak: { total: number; baru_7hari: number; opt_out: number; opt_out_bulan_ini: number }
  campaign_aktif: {
    id: number
    status: string
    template: string
    target: number
    terkirim: number
    gagal: number
    tertahan: number
  } | null
  gagal?: string[]
}

const KUALITAS: Record<string, { warna: string; judul: string; arti: string }> = {
  GREEN: {
    warna: 'bg-ok',
    judul: 'Sehat',
    arti: 'Nomor dipercaya WhatsApp. Pengiriman promo aman berjalan seperti biasa.',
  },
  YELLOW: {
    warna: 'bg-warn',
    judul: 'Perlu diawasi',
    arti: 'Ada tamu yang memblokir atau melaporkan. Tunda broadcast besar sampai warnanya pulih.',
  },
  RED: {
    warna: 'bg-bad',
    judul: 'Bermasalah',
    arti: 'Meta bisa membatasi nomor ini. Hentikan promo, layani tamu yang sudah chat lebih dulu.',
  },
}

function bacaKualitas(kode: string) {
  return (
    KUALITAS[kode?.toUpperCase()] ?? {
      warna: 'bg-mist',
      judul: 'Tidak terbaca',
      arti: 'Meta tidak menjawab saat status nomor ditanyakan. Angka lain di layar ini tetap sahih.',
    }
  )
}

function rupiah(n: number): string {
  return `Rp${n.toLocaleString('id-ID')}`
}

function jamMenit(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Angka({
  label,
  nilai,
  catatan,
}: {
  label: string
  nilai: number | string
  catatan?: string
}) {
  return (
    <div className="kartu p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="font-display mt-1 text-2xl text-ink">{nilai}</p>
      {catatan ? <p className="mt-0.5 text-xs text-ink-soft">{catatan}</p> : null}
    </div>
  )
}

/** Pindah halaman lewat hash; App menyimak `hashchange`. */
function bukaInbox() {
  window.location.hash = 'inbox'
}

export default function Dashboard({ nama }: { nama: string }) {
  const [data, setData] = useState<Ringkasan | null>(null)
  const [galat, setGalat] = useState('')
  const [versi, setVersi] = useState(0)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gagal'))))
      .then((d: Ringkasan) => {
        setData(d)
        setGalat('')
      })
      .catch(() => setGalat('Ringkasan gagal dimuat.'))
  }, [versi])

  // Angka ini menentukan apakah ada tamu yang sedang menunggu, jadi tidak boleh
  // basi hanya karena layar dibiarkan terbuka. Tab yang tidak dilihat dilewati.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setVersi((n) => n + 1)
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  if (galat && !data) return <p className="text-sm text-bad">{galat}</p>
  if (!data) return <p className="text-sm text-ink-soft">Memuat...</p>

  const kualitas = bacaKualitas(data.nomor.kualitas)
  const adaYangMenunggu = data.perlu_tindakan.nunggu_dibalas > 0
  const menungguLama = data.perlu_tindakan.nunggu_lewat_ambang > 0
  const persenKuota = Math.min(100, Math.round((data.kuota.terpakai / data.kuota.batas) * 100))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-ink">Ringkasan</h1>
        <p className="text-sm text-ink-soft">
          Halo, {nama}. Data terakhir diperbarui {jamMenit(data.diperbarui)}.
        </p>
      </div>

      {galat ? <p className="text-sm text-warn">{galat} Angka di bawah dari pemuatan sebelumnya.</p> : null}

      {/* Tamu yang menunggu didahulukan di atas semua angka lain: nomor ini tidak
          punya WhatsApp Web, jadi kalau tidak muncul di sini, tidak muncul di mana pun. */}
      <div
        className={
          'kartu p-5 ' + (menungguLama ? 'border-bad' : adaYangMenunggu ? 'border-warn' : '')
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">Tamu menunggu dibalas</p>
            <p
              className={
                'font-display mt-1 text-3xl ' +
                (menungguLama ? 'text-bad' : adaYangMenunggu ? 'text-ink' : 'text-ink-soft')
              }
            >
              {data.perlu_tindakan.nunggu_dibalas}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {!adaYangMenunggu ? (
                'Tidak ada percakapan yang diambil alih dan dibiarkan menggantung.'
              ) : menungguLama ? (
                <>
                  <span className="text-bad">
                    {data.perlu_tindakan.nunggu_lewat_ambang} sudah lewat 15 menit.
                  </span>{' '}
                  Percakapan ini dipegang staf, jadi agent tidak akan menjawabnya.
                </>
              ) : (
                'Percakapan ini dipegang staf, jadi agent tidak akan menjawabnya.'
              )}
            </p>
          </div>
          {adaYangMenunggu ? (
            <button type="button" onClick={bukaInbox} className="tombol tombol-utama text-sm">
              Buka Inbox
            </button>
          ) : null}
        </div>

        {data.perlu_tindakan.jendela_hampir_tutup > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-sm text-warn">
            {data.perlu_tindakan.jendela_hampir_tutup} percakapan sisa jendela balasnya kurang dari 2 jam.
            Lewat 24 jam, balasan gratis terkunci dan tamu cuma bisa dihubungi lewat template berbayar.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Angka label="Terkirim bulan ini" nilai={data.bulan_ini.terkirim} catatan="pesan promo" />
        <Angka label="Sampai ke HP tamu" nilai={data.bulan_ini.sampai} catatan="pesan promo" />
        <Angka label="Dibaca" nilai={data.bulan_ini.dibaca} catatan="pesan promo" />
        <Angka
          label="Tagihan Meta bulan ini"
          nilai={rupiah(data.bulan_ini.biaya)}
          catatan={
            data.bulan_ini.biaya_asli
              ? 'angka asli dari WhatsApp, promo + percakapan agent'
              : 'perkiraan tarif × jumlah — Meta belum menjawab'
          }
        />
      </div>

      <div className="kartu p-5">
        <p className="font-medium text-ink">Kesehatan nomor WhatsApp</p>
        <div className="mt-3 flex gap-3">
          <span aria-hidden className={'mt-1.5 inline-block size-3 shrink-0 rounded-full ' + kualitas.warna} />
          <div>
            <p className="font-medium text-ink">
              {kualitas.judul}
              {data.nomor.display ? ` — ${data.nomor.display}` : ''}
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">{kualitas.arti}</p>
            {data.nomor.status ? (
              <p className="mt-0.5 text-xs text-ink-soft">
                {data.nomor.nama_terverifikasi
                  ? `${data.nomor.nama_terverifikasi} · ${data.nomor.status.toLowerCase()}`
                  : data.nomor.status.toLowerCase()}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="kartu p-5">
        <p className="font-medium text-ink">Lalu lintas pesan 30 hari terakhir</p>
        <p className="mt-0.5 mb-3 text-sm text-ink-soft">
          Semua pesan nomor ini, termasuk balasan agent ke tamu yang chat sendiri — bukan promo saja.
        </p>
        <Grafik titik={data.harian} />
      </div>

      <div className="kartu p-5">
        <p className="font-medium text-ink">Jatah kirim 24 jam terakhir</p>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-canvas-2">
          <div
            className={'h-full rounded-full ' + (persenKuota >= 90 ? 'bg-bad' : 'bg-gold')}
            style={{ width: `${Math.max(persenKuota, data.kuota.terpakai > 0 ? 2 : 0)}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          <span className="text-ink">{data.kuota.terpakai}</span> nomor sudah dikirimi promo, sisa{' '}
          <span className="text-ink">{data.kuota.sisa}</span> dari jatah {data.kuota.batas} nomor per 24 jam.
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Yang dihitung nomor unik, bukan jumlah pesan. Batas ini dari Meta dan berlaku selama nomor belum
          lolos Business Verification. Balasan ke tamu yang chat duluan tidak ikut terhitung.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="kartu p-5">
          <p className="font-medium text-ink">Broadcast berjalan</p>
          {!data.campaign_aktif ? (
            <p className="mt-1 text-sm text-ink-soft">Tidak ada broadcast yang sedang jalan.</p>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-ink-soft">
              <p className="text-ink">{data.campaign_aktif.template}</p>
              <p>
                {data.campaign_aktif.terkirim} dari {data.campaign_aktif.target} terkirim ·{' '}
                {data.campaign_aktif.gagal} gagal · {data.campaign_aktif.tertahan} tertahan
              </p>
            </div>
          )}
        </div>

        <div className="kartu p-5">
          <p className="font-medium text-ink">Basis kontak</p>
          <div className="mt-2 space-y-1 text-sm text-ink-soft">
            <p>
              <span className="text-ink">{data.kontak.total}</span> kontak terkumpul,{' '}
              {data.kontak.baru_7hari} baru 7 hari terakhir.
            </p>
            <p>
              {data.kontak.opt_out} menolak dihubungi ({data.kontak.opt_out_bulan_ini} bulan ini).
            </p>
            <p>
              {data.percakapan.diambil_alih} percakapan dipegang staf · {data.percakapan.masuk_24jam} pesan
              tamu masuk 24 jam terakhir.
            </p>
          </div>
        </div>
      </div>

      {data.gagal && data.gagal.length > 0 ? (
        <p className="text-xs text-warn">
          Sebagian data tidak bisa diambil dari Meta: {data.gagal.join(' · ')}. Angka yang berasal dari
          database sendiri tetap benar.
        </p>
      ) : null}
    </div>
  )
}
