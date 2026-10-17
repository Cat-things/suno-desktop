import path from 'node:path'
import { APP_HOST, APP_SCHEME } from '../shared/constants'

/**
 * Maps `app://ui/<file>` to a file inside the bundled renderer directory, refusing anything that
 * would escape it.
 */
export function resolveAppAsset(rootDir: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  // The URL parser already collapsed literal dot segments; any left came from encoded slashes.
  if (pathname.split('/').includes('..')) return null
  const normalized = path.posix.normalize(pathname)
  if (normalized === '/') return null

  const root = path.resolve(rootDir)
  const full = path.resolve(root, `.${normalized}`)
  const relative = path.relative(root, full)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return full
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

export function mimeTypeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** CSP for local UI pages. No remote code, no inline scripts. */
export const LOCAL_UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')
