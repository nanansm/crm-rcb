-- Data uji untuk pengembangan LOKAL saja. Jangan pernah dijalankan ke D1 produksi.
-- Akun ini sengaja bukan akun staf sungguhan: sandi 'uji-lokal-123'.
DELETE FROM sesi;
DELETE FROM pesan_chat;
DELETE FROM percakapan;
DELETE FROM kontak_tag;
DELETE FROM kontak;
DELETE FROM pengguna;

INSERT INTO pengguna (id, nama, email, password_hash, aktif) VALUES
  (1, 'Staf Uji', 'e2e@lokal.test', '6bVlFT7mXFsVaRxHKiSU0g:mwYm9utZhvZ9Q5of7CA-zp0KkdEaUEknBjY9d3tmi2M', 1),
  (2, 'Staf Nonaktif', 'nonaktif@lokal.test', '6bVlFT7mXFsVaRxHKiSU0g:mwYm9utZhvZ9Q5of7CA-zp0KkdEaUEknBjY9d3tmi2M', 0);
