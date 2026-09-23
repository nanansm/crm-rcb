import { guard, json, type Env } from './_lib/auth'

/** Pintu masuk/keluar sesi — dilewatkan tanpa cookie sesi. */
const PUBLIC_PATHS = new Set(['/api/login', '/api/logout'])

// Dipanggil mesin (n8n), bukan browser — belum ada filenya sekarang, tapi jalurnya
// sudah dikecualikan di sini. Endpoint-endpoint ini akan mengesahkan dirinya sendiri
// lewat header rahasia di fase berikutnya.
const MACHINE_PATHS = new Set([
  '/api/pesan-masuk',
  '/api/balasan-agent',
  '/api/status-callback',
  '/api/campaign/progress-callback',
  '/api/status-agent',
])

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const path = new URL(context.request.url).pathname

  // Aset statis Pages (non-/api/) tidak disentuh middleware ini.
  if (!path.startsWith('/api/')) return context.next()

  if (PUBLIC_PATHS.has(path) || MACHINE_PATHS.has(path)) {
    return withSecurityHeaders(await context.next())
  }

  const hasil = await guard(context.request, context.env)
  if (!hasil.ok) {
    return withSecurityHeaders(json({ error: 'unauthorized' }, { status: 401 }))
  }

  return withSecurityHeaders(await context.next())
}
