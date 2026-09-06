-- Meta cuma menyimpan nama template dalam bentuk huruf kecil bergaris bawah
-- (`sapa_tamu_lama_review`). Staf hotel tidak mengetik nama itu dan tidak
-- mengenalinya di daftar, jadi judul yang mereka tulis, keterangan singkatnya,
-- dan masa berlakunya disimpan di sini lalu ditempelkan ke daftar template.
CREATE TABLE IF NOT EXISTS promo_meta (
  template TEXT PRIMARY KEY,
  judul TEXT NOT NULL,
  ringkas TEXT NOT NULL DEFAULT '',
  -- NULL = tidak dibatasi. Template ucapan terima kasih memang tidak punya
  -- tanggal berakhir, beda dengan promo musiman.
  berlaku_sampai TEXT,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
