-- Skema awal D1 untuk CRM + broadcast WhatsApp Hotel Rancabango.
-- Urutan tabel sengaja: induk (pengguna, kontak, tag, campaign) dulu,
-- baru tabel yang mereferensikannya, supaya bisa jalan dari database kosong.

CREATE TABLE IF NOT EXISTS pengguna (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sesi (
  token_hash TEXT PRIMARY KEY,
  pengguna_id INTEGER NOT NULL,
  kadaluarsa TEXT NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS kontak (
  nomor TEXT PRIMARY KEY,
  nama TEXT,
  catatan TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0,
  opt_out_pada TEXT,
  terakhir_bc TEXT,
  terakhir_pesan_masuk TEXT,
  dibuat TEXT NOT NULL,
  diperbarui TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kontak_opt_out ON kontak(opt_out);

CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT UNIQUE NOT NULL,
  warna TEXT
);

CREATE TABLE IF NOT EXISTS kontak_tag (
  kontak_nomor TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (kontak_nomor, tag_id),
  FOREIGN KEY (kontak_nomor) REFERENCES kontak(nomor) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS percakapan (
  nomor TEXT PRIMARY KEY,
  status_agent TEXT NOT NULL DEFAULT 'aktif',
  staf_id INTEGER,
  diambil_pada TEXT,
  terakhir_pesan_pada TEXT
);

CREATE INDEX IF NOT EXISTS percakapan_terakhir_pesan_pada ON percakapan(terakhir_pesan_pada);

CREATE TABLE IF NOT EXISTS pesan_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor TEXT NOT NULL,
  arah TEXT NOT NULL,
  pengirim TEXT NOT NULL,
  teks TEXT,
  -- UNIQUE: webhook Meta mengirim at-least-once, wamid dobel harus ditolak
  -- diam-diam (bukan error) supaya pesan tidak tercatat dua kali.
  wamid TEXT UNIQUE,
  waktu TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pesan_chat_nomor_waktu ON pesan_chat(nomor, waktu);

CREATE TABLE IF NOT EXISTS takeover (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor TEXT NOT NULL,
  staf_id INTEGER,
  diambil_pada TEXT,
  dikembalikan_pada TEXT
);

CREATE TABLE IF NOT EXISTS campaign (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  template TEXT NOT NULL,
  segmen_tag_id INTEGER,
  maks INTEGER NOT NULL,
  target INTEGER NOT NULL DEFAULT 0,
  terkirim INTEGER NOT NULL DEFAULT 0,
  gagal INTEGER NOT NULL DEFAULT 0,
  tertahan INTEGER NOT NULL DEFAULT 0,
  mulai TEXT NOT NULL,
  -- Kolom kunci, bukan data. Diisi 1 saat campaign masih berjalan, NULL selain itu,
  -- supaya indeks unik parsial di bawah cuma mengizinkan satu campaign aktif.
  aktif INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_aktif_tunggal ON campaign(aktif) WHERE aktif = 1;

CREATE TABLE IF NOT EXISTS pengiriman (
  wamid TEXT PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  nomor TEXT NOT NULL,
  status_terakhir TEXT NOT NULL DEFAULT 'terkirim',
  billable INTEGER,
  diperbarui TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pengiriman_campaign_id ON pengiriman(campaign_id);

-- Status dari Meta sering tiba SEBELUM baris wamid-nya sempat tercatat di tabel
-- `pengiriman`. Status yatim ditahan di sini dulu, lalu diterapkan begitu barisnya muncul.
CREATE TABLE IF NOT EXISTS status_menunggu (
  wamid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  billable INTEGER,
  waktu TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS status_menunggu_waktu ON status_menunggu(waktu);

CREATE TABLE IF NOT EXISTS opt_out_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor TEXT NOT NULL,
  sumber TEXT,
  waktu TEXT NOT NULL
);
