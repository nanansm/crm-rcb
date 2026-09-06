import { defineConfig } from '@playwright/test'

const PORT = 8788

export default defineConfig({
  testDir: './e2e',
  // Data uji dibersihkan setelah suite selesai, lihat e2e/bersihkan.ts
  globalTeardown: './e2e/bersihkan.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Semua uji berjalan di stack lokal: vite build lalu wrangler pages dev,
  // dengan D1 dan KV lokal. Tidak ada uji yang menyentuh produksi.
  webServer: {
    command: 'npm run dev:cf',
    url: `http://127.0.0.1:${PORT}/api/me`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
