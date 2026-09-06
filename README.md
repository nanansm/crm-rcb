# crm-rcb

CRM + broadcast WhatsApp untuk Hotel Rancabango. Staf memakai satu halaman web untuk
melihat tamu yang pernah chat dengan AI agent, membuka riwayat percakapan, mengambil
alih balasan, dan mengirim promo lewat template resmi Meta.

Cloudflare Pages + Pages Functions + D1 + KV. Nomor WhatsApp yang dipakai sama dengan
nomor AI agent, jadi setiap perubahan di sini ikut menyentuh percakapan tamu yang
sedang berjalan.

## Jalan lokal

```
npm install
npm run dev        # antarmuka saja
npm run typecheck  # tsc app + functions
npm run lint
```

## Migrasi

```
npx wrangler d1 execute crm-rcb --remote --file migrations/0001_awal.sql
```

## Aturan repo

Repo ini publik. Token Meta, rahasia webhook n8n, dan kredensial lain hanya boleh
hidup sebagai secret di Cloudflare Pages, tidak pernah di dalam kode, komentar,
atau file contoh.
