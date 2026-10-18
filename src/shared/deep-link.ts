import { DEEP_LINK_SCHEME, SUNO_ORIGIN } from './constants'

/** Links reserved for Suno++: `plugin` for plugins, `theme` for themes. */
export interface ReservedLink<K extends 'plugin' | 'theme'> {
  readonly kind: K
  readonly action: string
  readonly params: Readonly<Record<string, string>>
}

export type DeepLink =
  | { readonly kind: 'open'; readonly url: string }
  | ReservedLink<'plugin'>
  | ReservedLink<'theme'>
  | { readonly kind: 'invalid'; readonly reason: string }

const MAX_LINK_LENGTH = 2048
const MAX_PATH_LENGTH = 1024
const MAX_PLUGIN_PARAMS = 20
const MAX_PARAM_LENGTH = 512
const PLUGIN_ACTION = /^[a-z][a-z0-9-]{0,63}$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const invalid = (reason: string): DeepLink => ({ kind: 'invalid', reason })

/**
 * Resolves a user-supplied path against suno.com and refuses anything that could escape the
 * origin (protocol-relative `//host`, backslashes, encoded tricks, control characters).
 */
export function resolveSunoPath(path: string): string | null {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path.includes('\\') || CONTROL_CHARS.test(path)) return null
  let resolved: URL
  try {
    resolved = new URL(path, SUNO_ORIGIN)
  } catch {
    return null
  }
  if (resolved.origin !== SUNO_ORIGIN) return null
  return resolved.href
}

/**
 * Parses `suno-desktop://` links.
 *
 * - `suno-desktop://open` and `suno-desktop://open?path=/song/xyz` open a suno.com page.
 * - `suno-desktop://plugin/<action>?...` and `suno-desktop://theme/<action>?...` are reserved for
 *   Suno++ plugins and themes. They are only parsed, never executed.
 */
export function parseDeepLink(raw: string): DeepLink {
  if (raw.length > MAX_LINK_LENGTH) return invalid('link too long')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return invalid('not a URL')
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return invalid('wrong scheme')
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return invalid('unexpected URL parts')
  }

  // `suno-desktop://open/` puts the route in the host, `suno-desktop:open` puts it in the path.
  const segments = `${url.host}${url.pathname}`
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
  const [route, ...rest] = segments

  switch (route) {
    case 'open': {
      if (rest.length > 0) return invalid('unexpected path after open')
      const target = resolveSunoPath(url.searchParams.get('path') ?? '/')
      return target ? { kind: 'open', url: target } : invalid('path is not a suno.com path')
    }
    case 'plugin':
    case 'theme': {
      const action = rest.join('/')
      if (!PLUGIN_ACTION.test(action)) return invalid(`bad ${route} action`)
      const entries = [...url.searchParams.entries()]
      if (entries.length > MAX_PLUGIN_PARAMS) return invalid('too many parameters')
      const params: Record<string, string> = {}
      for (const [key, value] of entries) {
        if (key.length > MAX_PARAM_LENGTH || value.length > MAX_PARAM_LENGTH) {
          return invalid('parameter too long')
        }
        params[key] = value
      }
      return { kind: route, action, params }
    }
    case undefined:
      return invalid('missing route')
    default:
      return invalid(`unknown route "${route}"`)
  }
}

/** Windows passes deep links as a command-line argument to the (second) instance. */
export function findDeepLinkArg(argv: readonly string[]): string | undefined {
  const prefix = `${DEEP_LINK_SCHEME}:`
  return argv.find((arg) => arg.toLowerCase().startsWith(prefix))
}
