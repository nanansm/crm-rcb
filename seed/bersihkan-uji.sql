-- Data sisa E2E. Nomor uji selalu 62899xxxxxxxx, tag uji selalu berawalan
-- pola di bawah. Tanpa ini daftar tag di layar staf tenggelam oleh ratusan
-- tag sampah dan halaman Kontak/Broadcast jadi tidak terbaca.
DELETE FROM kontak_tag WHERE tag_id IN (
  SELECT id FROM tag WHERE nama LIKE 'tag-e2e-%' OR nama LIKE 'bc-%' OR nama LIKE 'st-%'
     OR nama LIKE 'dedup-%' OR nama LIKE 'zz-uji-%'
);
DELETE FROM tag WHERE nama LIKE 'tag-e2e-%' OR nama LIKE 'bc-%' OR nama LIKE 'st-%'
   OR nama LIKE 'dedup-%' OR nama LIKE 'zz-uji-%';
DELETE FROM pesan_chat WHERE nomor LIKE '62899%';
DELETE FROM kontak_tag WHERE kontak_nomor LIKE '62899%';
DELETE FROM takeover WHERE nomor LIKE '62899%';
DELETE FROM percakapan WHERE nomor LIKE '62899%';
DELETE FROM kontak WHERE nomor LIKE '62899%';
DELETE FROM pengiriman WHERE nomor LIKE '62899%';
DELETE FROM campaign WHERE template = 'hello_world';
DELETE FROM opt_out_log WHERE nomor LIKE '62899%';
DELETE FROM status_menunggu WHERE wamid LIKE 'wamid.62899%' OR wamid LIKE 'wamid.uji%';

-- Daftar tamu uji. Nama daftar E2E selalu berawalan 'daftar-e2e-'.
DELETE FROM daftar_kontak WHERE daftar_id IN (SELECT id FROM daftar WHERE nama LIKE 'daftar-e2e-%');
DELETE FROM daftar_kontak WHERE nomor LIKE '62899%';
DELETE FROM daftar WHERE nama LIKE 'daftar-e2e-%';
