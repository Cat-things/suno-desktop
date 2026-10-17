import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import { APP_SCHEME } from '../shared/constants'
import { LOCAL_UI_CSP, mimeTypeFor, resolveAppAsset } from './app-protocol-path'
import type { Logger } from './logger'

/** Must run before `app.ready`. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/**
 * Serves the bundled local UI from `app://ui/` on the default session. The suno.com session never
 * gets this handler, so remote pages cannot load local UI files.
 */
export function handleAppProtocol(rendererRoot: string, log: Logger): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppAsset(rendererRoot, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(new Uint8Array(body), {
        headers: {
          'content-type': mimeTypeFor(file),
          'content-security-policy': LOCAL_UI_CSP,
          'x-content-type-options': 'nosniff'
        }
      })
    } catch (error) {
      log.warn(`app:// cannot serve ${request.url}`, error)
      return new Response('Not found', { status: 404 })
    }
  })
}
