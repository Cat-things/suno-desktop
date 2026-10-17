import { nativeTheme, type WebContents, type WebPreferences } from 'electron'
import { devServerUrl, localPageUrl, preloadPath, type LocalPage } from '../paths'

/** webPreferences for bundled UI pages. Same sandboxing as remote content, different preload. */
export function localUiWebPreferences(): WebPreferences {
  return {
    preload: preloadPath('ui'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    additionalArguments: [
      `--suno-desktop-theme=${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`,
      ...(devServerUrl ? [`--suno-desktop-dev-origin=${new URL(devServerUrl).origin}`] : [])
    ]
  }
}

/** Loads a local page and stops it from ever navigating elsewhere. */
export function loadLocalPage(contents: WebContents, page: LocalPage): Promise<void> {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return contents.loadURL(localPageUrl(page))
}
