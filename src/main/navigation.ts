import { shell, type BrowserWindowConstructorOptions, type Event, type WebContents } from 'electron'
import { SUNO_PARTITION } from '../shared/constants'
import { classifyNavigation, classifyPopup, isSafeExternalUrl } from '../shared/url-policy'
import type { Logger } from './logger'

export interface NavigationGuardOptions {
  readonly log: Logger
  /** Loads a first-party URL in the main view (for target=_blank links). */
  readonly openInMainView: (url: string) => void
  readonly popupOptions: () => BrowserWindowConstructorOptions
  readonly onPopupCreated?: (contents: WebContents) => void
}

export function openExternalSafely(url: string, log: Logger): void {
  if (!isSafeExternalUrl(url)) {
    log.warn('refused to open unsafe external URL', url)
    return
  }
  shell.openExternal(url).catch((error: unknown) => {
    log.warn('openExternal failed', error)
  })
}

function enforce(contents: WebContents, url: string, event: Event, log: Logger): void {
  const action = classifyNavigation(url)
  if (action === 'allow') return
  event.preventDefault()
  if (action === 'external') openExternalSafely(url, log)
  else if (action === 'download') contents.downloadURL(url)
  else log.warn('blocked navigation', url)
}

/**
 * Applies the allowlist to a webContents showing suno.com (the main view or an auth popup):
 * first-party and login pages stay in the app, the rest opens in the default browser.
 */
export function guardSunoNavigation(contents: WebContents, options: NavigationGuardOptions): void {
  const { log } = options

  contents.on('will-navigate', (event) => {
    if (event.isMainFrame) enforce(contents, event.url, event, log)
  })
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame) enforce(contents, event.url, event, log)
  })

  contents.setWindowOpenHandler(({ url, disposition }) => {
    switch (classifyPopup(url, disposition)) {
      case 'popup':
        return {
          action: 'allow',
          overrideBrowserWindowOptions: options.popupOptions()
        }
      case 'navigate':
        options.openInMainView(url)
        break
      case 'download':
        contents.downloadURL(url)
        break
      case 'external':
        openExternalSafely(url, log)
        break
      case 'block':
        log.warn('blocked popup', url)
        break
    }
    return { action: 'deny' }
  })

  contents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false)
    guardSunoNavigation(child.webContents, options)
    options.onPopupCreated?.(child.webContents)
  })
}

/** Popups share the persistent suno.com session (OAuth needs it) and never get a preload. */
export function authPopupWebPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    partition: SUNO_PARTITION,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: true
  }
}
