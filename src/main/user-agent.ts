/**
 * Builds a user agent that looks like stock Chrome. Electron's default adds `Electron/x` and the
 * app name, which makes some sign-in pages (notably Google) refuse to load.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function cleanUserAgent(userAgent: string, appTokens: readonly string[] = []): string {
  let ua = userAgent
  for (const token of ['Electron', ...appTokens]) {
    if (token.trim() === '') continue
    ua = ua.replace(new RegExp(`\\s*${escapeRegExp(token)}/\\S+`, 'gi'), '')
  }
  // Real Chrome reports a reduced version ("Chrome/140.0.0.0") since the UA reduction rollout.
  ua = ua.replace(/Chrome\/(\d+)\.\d+\.\d+\.\d+/, 'Chrome/$1.0.0.0')
  return ua.replace(/\s{2,}/g, ' ').trim()
}
