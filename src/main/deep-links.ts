import path from 'node:path'
import { app } from 'electron'
import { DEEP_LINK_SCHEME } from '../shared/constants'
import { parseDeepLink } from '../shared/deep-link'
import type { Logger } from './logger'
import { executablePath } from './paths'
import type { PluginHost } from './plugins'

/**
 * Registers `suno-desktop://` for the current user. The NSIS installer registers it as well
 * (build/installer.nsh); doing it at runtime keeps portable builds working and fixes moved installs.
 */
export function registerProtocolClient(log: Logger): void {
  if (!app.isPackaged) {
    // Avoid pointing the OS at electron.exe from a dev checkout unless explicitly asked.
    if (process.env['SUNO_DESKTOP_REGISTER_PROTOCOL'] !== '1' || !process.argv[1]) return
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1])
    ])
    return
  }
  const ok = app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, executablePath(), [])
  if (!ok) log.warn('could not register the suno-desktop:// protocol')
}

export interface DeepLinkTargets {
  readonly log: Logger
  readonly openUrl: (url: string) => void
  readonly pluginHost: () => PluginHost | null
}

export function handleDeepLink(raw: string, targets: DeepLinkTargets): void {
  const link = parseDeepLink(raw)
  switch (link.kind) {
    case 'open':
      targets.log.info('deep link: open', link.url)
      targets.openUrl(link.url)
      break
    case 'plugin': {
      const host = targets.pluginHost()
      if (host) void host.handleDeepLink(link)
      break
    }
    case 'invalid':
      targets.log.warn(`ignored deep link: ${link.reason}`)
      break
  }
}
