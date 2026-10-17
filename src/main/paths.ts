import path from 'node:path'
import { app } from 'electron'
import { APP_HOST, APP_SCHEME } from '../shared/constants'

export type LocalPage = 'titlebar' | 'settings' | 'offline'

export const isDev = !app.isPackaged

/** Set by electron-vite while `pnpm dev` runs. Never trusted in packaged builds. */
export const devServerUrl: string | undefined = isDev
  ? process.env.ELECTRON_RENDERER_URL
  : undefined

export function preloadPath(name: 'suno' | 'ui'): string {
  return path.join(__dirname, '../preload', `${name}.js`)
}

export function rendererRoot(): string {
  return path.join(__dirname, '../renderer')
}

export function localPageUrl(page: LocalPage): string {
  return devServerUrl ? `${devServerUrl}/${page}.html` : `${APP_SCHEME}://${APP_HOST}/${page}.html`
}

/** electron-builder's portable target extracts to a temp dir and sets this variable. */
export function isPortable(): boolean {
  return Boolean(process.env['PORTABLE_EXECUTABLE_FILE'])
}

/** The exe Windows should launch (for login items and the protocol handler). */
export function executablePath(): string {
  return process.env['PORTABLE_EXECUTABLE_FILE'] ?? process.execPath
}
