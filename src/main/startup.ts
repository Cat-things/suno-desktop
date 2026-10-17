import { app } from 'electron'
import { APP_ID } from '../shared/constants'
import type { Settings } from '../shared/settings'
import type { Logger } from './logger'
import { executablePath } from './paths'

export const HIDDEN_ARG = '--hidden'

/** Launch-on-startup via the Windows Run key. Skipped in dev so electron.exe is never registered. */
export function applyLoginItem(settings: Settings, log: Logger): void {
  if (!app.isPackaged || process.platform !== 'win32') return
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchOnStartup,
      path: executablePath(),
      // Fixed value name so the uninstaller (build/installer.nsh) can remove it.
      name: APP_ID,
      args: settings.startMinimized ? [HIDDEN_ARG] : []
    })
  } catch (error) {
    log.warn('setLoginItemSettings failed', error)
  }
}

export function launchedHidden(argv: readonly string[], settings: Settings): boolean {
  return settings.startMinimized || argv.includes(HIDDEN_ARG)
}
