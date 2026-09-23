-- Perbaikan data: MAX(x, NULL) di pesan.ts (sebelum perbaikan ini) meng-NULL-kan
-- terakhir_pesan_masuk untuk kontak yang lahir dari unggahan daftar lalu chat.
-- Aman dijalankan berulang: baris yang sudah >= MAX(pesan_chat) tidak disentuh.
UPDATE kontak
SET terakhir_pesan_masuk = (
  SELECT MAX(p.waktu) FROM pesan_chat p WHERE p.nomor = kontak.nomor AND p.arah = 'masuk'
)
WHERE EXISTS (SELECT 1 FROM pesan_chat p WHERE p.nomor = kontak.nomor AND p.arah = 'masuk')
  AND (
    terakhir_pesan_masuk IS NULL
    OR terakhir_pesan_masuk < (SELECT MAX(p.waktu) FROM pesan_chat p WHERE p.nomor = kontak.nomor AND p.arah = 'masuk')
  );

UPDATE percakapan
SET terakhir_pesan_pada = (SELECT MAX(p.waktu) FROM pesan_chat p WHERE p.nomor = percakapan.nomor)
WHERE terakhir_pesan_pada IS NULL
  AND EXISTS (SELECT 1 FROM pesan_chat p WHERE p.nomor = percakapan.nomor);
