import path from 'node:path'
import { app, dialog, Menu } from 'electron'
import { APP_ID, APP_NAME } from '../shared/constants'
import { findDeepLinkArg } from '../shared/deep-link'
import { AppController } from './app-controller'
import { registerAppSchemePrivileges } from './app-protocol'
import { createLogger } from './logger'
import { isDev } from './paths'
import { chromeUserAgent, hardenAllWebContents } from './security'
import { SettingsStore } from './settings-store'
import { launchedHidden } from './startup'

// One userData folder for dev and packaged builds: %APPDATA%/Suno Desktop.
// Unpackaged runs (tests) may point it elsewhere.
const userDataOverride = app.isPackaged ? undefined : process.env['SUNO_DESKTOP_USER_DATA_DIR']
app.setPath('userData', userDataOverride ?? path.join(app.getPath('appData'), APP_NAME))

const log = createLogger(path.join(app.getPath('userData'), 'logs'), {
  level: isDev ? 'debug' : 'info',
  toConsole: isDev
})

// Log instead of Electron's default modal error dialog; the app keeps running where it can.
process.on('uncaughtException', (error) => {
  log.error('uncaught exception', error)
})
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason)
})

function bootstrap(): void {
  log.info(`starting ${APP_NAME} ${app.getVersion()} (electron ${process.versions.electron})`)
  const settings = new SettingsStore(app.getPath('userData'), log.child('settings'))

  // Everything below must happen before `ready`.
  if (!settings.get().hardwareAcceleration) app.disableHardwareAcceleration()
  app.setAppUserModelId(APP_ID)
  registerAppSchemePrivileges()
  // Sandbox every renderer. The only exception: an unpackaged run started with --no-sandbox
  // (e.g. Linux CI as root), where Chromium's OS sandbox is off anyway and forcing it would
  // crash the network service. Every webContents still sets `sandbox: true` explicitly.
  if (app.isPackaged || !process.argv.includes('--no-sandbox')) app.enableSandbox()
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback)
  hardenAllWebContents(log.child('security'))
  // No default menu: its accelerators (reload, devtools) would bypass our shortcut handling.
  Menu.setApplicationMenu(null)

  let controller: AppController | null = null
  const pendingLinks: string[] = []
  const initialLink = findDeepLinkArg(process.argv)
  if (initialLink) pendingLinks.push(initialLink)

  const openLink = (link: string): void => {
    if (controller) controller.openDeepLink(link)
    else pendingLinks.push(link)
  }

  app.on('second-instance', (_event, argv) => {
    controller?.showWindow()
    const link = findDeepLinkArg(argv)
    if (link) openLink(link)
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    openLink(url)
  })

  app
    .whenReady()
    .then(() => {
      controller = new AppController(settings, log)
      controller.start(launchedHidden(process.argv, settings.get()))
      for (const link of pendingLinks.splice(0)) controller.openDeepLink(link)
    })
    .catch((error: unknown) => {
      log.error('startup failed', error)
      dialog.showErrorBox(APP_NAME, `Suno Desktop failed to start.\n\n${String(error)}`)
      app.exit(1)
    })
}

// A second launch forwards its arguments (including deep links) to the first instance and exits.
if (app.requestSingleInstanceLock()) bootstrap()
else app.quit()
