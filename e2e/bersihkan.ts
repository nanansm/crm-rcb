import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const jalankan = promisify(execFile)

/**
 * Dijalankan Playwright setelah seluruh suite selesai. Tanpa ini setiap run
 * meninggalkan puluhan tag dan kontak uji di D1 lokal — setelah beberapa run,
 * layar Kontak dan Broadcast tenggelam oleh ratusan chip tag sampah dan tidak
 * bisa dipakai menilai desainnya lagi.
 */
export default async function bersihkan() {
  try {
    await jalankan(
      'npx',
      ['wrangler', 'd1', 'execute', 'crm-rcb', '--local', '--file', 'seed/bersihkan-uji.sql'],
      { cwd: process.cwd(), timeout: 120_000 },
    )
  } catch (err) {
    // Pembersihan gagal tidak boleh menggagalkan hasil tes -- cukup terlihat di log.
    console.warn('Pembersihan data uji gagal:', err instanceof Error ? err.message : err)
  }
}
