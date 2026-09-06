-- Daftar tamu hasil unggahan CSV/XLSX. Kontaknya sendiri tetap tinggal di tabel
-- `kontak` supaya tag, opt-out, dan riwayat chat tidak bercabang dua; tabel ini
-- cuma menyimpan KEANGGOTAAN: nomor mana ikut daftar mana.
CREATE TABLE IF NOT EXISTS daftar (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  keterangan TEXT NOT NULL DEFAULT '',
  jumlah INTEGER NOT NULL DEFAULT 0,
  -- 0 = unggahan masih berjalan. Daftar setengah jadi tidak boleh muncul di
  -- pilihan Broadcast: unggahan yang putus di tengah akan menyisakan baris
  -- ini selamanya, dan mengirim ke separuh daftar lebih buruk daripada gagal.
  siap INTEGER NOT NULL DEFAULT 0,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daftar_kontak (
  daftar_id TEXT NOT NULL REFERENCES daftar(id) ON DELETE CASCADE,
  nomor TEXT NOT NULL,
  PRIMARY KEY (daftar_id, nomor)
);

CREATE INDEX IF NOT EXISTS daftar_kontak_nomor ON daftar_kontak(nomor);
CREATE INDEX IF NOT EXISTS daftar_siap ON daftar(siap);

-- Dicatat supaya layar progres dan laporan bisa menyebut daftar mana yang dikirimi,
-- bukan cuma nama template.
ALTER TABLE campaign ADD COLUMN daftar_id TEXT;
