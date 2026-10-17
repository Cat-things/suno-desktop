/**
 * Decides where a URL may be opened. Pure and dependency-free so it can be unit tested.
 *
 * - First-party Suno hosts and the login providers Suno uses load inside the app.
 * - First-party media files are handed to the download manager.
 * - Everything else goes to the default browser, unless the scheme is unsafe.
 */

export type NavigationAction = 'allow' | 'download' | 'external' | 'block'

export type PopupAction = 'popup' | 'navigate' | 'download' | 'external' | 'block'

/** Domains owned by Suno, Inc. Subdomains are included (auth.suno.com hosts Clerk, cdn1.suno.ai hosts audio). */
export const FIRST_PARTY_DOMAINS: readonly string[] = ['suno.com', 'suno.ai']

/** Hosts where `window.sunoDesktop` and the media hook are installed. */
export const APP_DOMAINS: readonly string[] = ['suno.com']

interface AuthRule {
  readonly host: string
  /** When set, only these paths stay in the app. Used for hosts that also serve unrelated pages. */
  readonly paths?: readonly RegExp[]
}

const FACEBOOK_AUTH_PATHS: readonly RegExp[] = [
  /^\/(v\d+(\.\d+)?\/)?dialog\/oauth/,
  /^\/login(\.php)?(\/|$)/,
  /^\/checkpoint\//,
  /^\/two_step_verification\//,
  /^\/auth_platform\//,
  /^\/privacy\/consent\//
]

/**
 * Login providers offered on suno.com: Google, Apple, Discord, Microsoft, Facebook and LINE.
 * Clerk itself runs on auth.suno.com, which is already first-party. Phone login stays on suno.com.
 */
export const AUTH_RULES: readonly AuthRule[] = [
  { host: 'accounts.google.com' },
  { host: 'accounts.youtube.com' },
  { host: 'appleid.apple.com' },
  { host: 'idmsa.apple.com' },
  {
    host: 'discord.com',
    paths: [/^\/oauth2\//, /^\/login(\/|$)/, /^\/register(\/|$)/, /^\/api\/(v\d+\/)?oauth2\//]
  },
  { host: 'login.microsoftonline.com' },
  { host: 'login.microsoft.com' },
  { host: 'login.live.com' },
  { host: 'account.live.com' },
  { host: 'www.facebook.com', paths: FACEBOOK_AUTH_PATHS },
  { host: 'm.facebook.com', paths: FACEBOOK_AUTH_PATHS },
  { host: 'access.line.me' }
]

const DOWNLOADABLE_EXTENSIONS =
  /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|m4v|webm|mov|png|jpe?g|webp|gif|zip|mid|midi)$/i

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function parse(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function isFirstPartyHost(host: string): boolean {
  const h = host.toLowerCase()
  return FIRST_PARTY_DOMAINS.some((d) => hostMatches(h, d))
}

/** True for https URLs on suno.com or its subdomains (where the page bridge is exposed). */
export function isSunoAppUrl(raw: string): boolean {
  const url = parse(raw)
  if (url?.protocol !== 'https:' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return APP_DOMAINS.some((d) => hostMatches(host, d))
}

export function isFirstPartyUrl(raw: string): boolean {
  const url = parse(raw)
  return url?.protocol === 'https:' && url.port === '' && isFirstPartyHost(url.hostname)
}

export function isAuthUrl(raw: string): boolean {
  const url = parse(raw)
  if (url?.protocol !== 'https:' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  const rule = AUTH_RULES.find((r) => r.host === host)
  if (!rule) return false
  return rule.paths ? rule.paths.some((p) => p.test(url.pathname)) : true
}

/** Only these schemes may be passed to `shell.openExternal`. */
export function isSafeExternalUrl(raw: string): boolean {
  const url = parse(raw)
  if (!url || !EXTERNAL_SCHEMES.has(url.protocol)) return false
  // Credentials in URLs are a classic phishing trick (https://suno.com@evil.example).
  return url.username === '' && url.password === ''
}

function isFirstPartyDownload(url: URL): boolean {
  return DOWNLOADABLE_EXTENSIONS.test(url.pathname)
}

/** Decision for a top-level navigation in a window that shows suno.com. */
export function classifyNavigation(raw: string): NavigationAction {
  if (raw === 'about:blank') return 'allow'
  const url = parse(raw)
  if (!url) return 'block'
  if (url.protocol === 'https:' && url.username === '' && url.password === '') {
    if (isFirstPartyUrl(raw)) return isFirstPartyDownload(url) ? 'download' : 'allow'
    if (isAuthUrl(raw)) return 'allow'
  }
  return isSafeExternalUrl(raw) ? 'external' : 'block'
}

/**
 * Decision for `window.open` / `target=_blank`.
 *
 * `disposition` comes from Electron's window-open handler: `new-window` means a scripted popup
 * (OAuth flows need a real child window so `window.opener` keeps working), while tab dispositions
 * are plain links that should just navigate the main view.
 */
export function classifyPopup(raw: string, disposition: string): PopupAction {
  const scripted = disposition === 'new-window'
  // Some providers open a blank popup first and set its location afterwards.
  if (raw === '' || raw === 'about:blank') return scripted ? 'popup' : 'block'
  const nav = classifyNavigation(raw)
  switch (nav) {
    case 'allow':
      if (isAuthUrl(raw)) return 'popup'
      return scripted ? 'popup' : 'navigate'
    case 'download':
      return 'download'
    case 'external':
      return 'external'
    case 'block':
      return 'block'
  }
}
