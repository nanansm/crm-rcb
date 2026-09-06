-- Broadcast promo hotel hampir selalu berisi gambar (foto kamar, flyer promo).
-- Template Meta menyimpan struktur headernya, tapi GAMBAR yang dipakai
-- ditentukan per pengiriman, jadi URL-nya disimpan di baris campaign.
ALTER TABLE campaign ADD COLUMN gambar_url TEXT;
