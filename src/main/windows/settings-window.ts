import os from 'node:os'
import { BrowserWindow, nativeTheme } from 'electron'
import { APP_NAME, TITLEBAR_HEIGHT } from '../../shared/constants'
import type { RoleRegistry } from '../ipc/router'
import { matchShortcut } from '../shortcuts'
import { supportsMica, titleBarOverlayColors, windowBackground } from './layout'
import { loadLocalPage, localUiWebPreferences } from './local-ui'

export interface SettingsWindowDeps {
  readonly roles: RoleRegistry
  readonly icon: string
  readonly devToolsAllowed: () => boolean
}

/** Local settings UI in its own window. Never injected into suno.com. */
export class SettingsWindow {
  private window: BrowserWindow | null = null

  constructor(private readonly deps: SettingsWindowDeps) {}

  get contents(): Electron.WebContents | null {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null
  }

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore()
      this.window.show()
      this.window.focus()
      return
    }
    const mica = supportsMica(process.platform, os.release())
    const dark = nativeTheme.shouldUseDarkColors
    const win = new BrowserWindow({
      width: 880,
      height: 640,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: `Settings – ${APP_NAME}`,
      icon: this.deps.icon,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...titleBarOverlayColors(dark, mica), height: TITLEBAR_HEIGHT },
      ...(mica ? { backgroundMaterial: 'mica' as const } : {}),
      backgroundColor: windowBackground(dark, mica),
      webPreferences: localUiWebPreferences()
    })
    this.window = win
    this.deps.roles.assign(win.webContents, 'settings')

    const onTheme = (): void => {
      if (win.isDestroyed() || process.platform === 'darwin') return
      const isDark = nativeTheme.shouldUseDarkColors
      win.setTitleBarOverlay({ ...titleBarOverlayColors(isDark, mica), height: TITLEBAR_HEIGHT })
      if (!mica) win.setBackgroundColor(windowBackground(isDark, false))
    }
    nativeTheme.on('updated', onTheme)
    win.on('closed', () => {
      nativeTheme.off('updated', onTheme)
      this.window = null
    })
    win.webContents.on('before-input-event', (event, input) => {
      const action = matchShortcut(input)
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        win.close()
      } else if (action === 'toggleDevTools' && this.deps.devToolsAllowed()) {
        event.preventDefault()
        win.webContents.toggleDevTools()
      } else if (action === 'reload' || action === 'hardReload') {
        event.preventDefault()
      }
    })
    win.once('ready-to-show', () => {
      win.show()
    })
    void loadLocalPage(win.webContents, 'settings')
  }
}
