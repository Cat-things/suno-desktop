import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  net,
  Notification,
  session,
  type Session
} from 'electron'
import { APP_NAME, BRIDGE_API_VERSION, SUNO_PARTITION } from '../shared/constants'
import type { ReservedLink } from '../shared/deep-link'
import { IPC, type AppInfo } from '../shared/ipc-channels'
import type { Settings, ThemeSource } from '../shared/settings'
import iconPath from '../../resources/icon.png?asset'
import trayIcoPath from '../../resources/tray.ico?asset'
import trayPngPath from '../../resources/tray.png?asset'
import { appConfig } from './app-config'
import { handleAppProtocol } from './app-protocol'
import { handleDeepLink, registerProtocolClient } from './deep-links'
import { DownloadManager } from './downloads'
import { InjectionRegistry } from './injection/registry'
import { RichPresence } from './integrations/discord/rich-presence'
import { registerIpcHandlers } from './ipc/handlers'
import { IpcRouter, RoleRegistry } from './ipc/router'
import type { Logger } from './logger'
import { MediaController } from './media/media-controller'
import { ThumbarButtons } from './media/thumbar'
import { devServerUrl, isDev, isPortable, rendererRoot } from './paths'
import { hardenSunoSession } from './security'
import type { SettingsStore } from './settings-store'
import { applyLoginItem } from './startup'
import { SunoPlusPlusManager } from './sunoplusplus/manager'
import { AppTray } from './tray'
import { Updater } from './updater'
import { WindowStateStore } from './window-state-store'
import { MainWindow } from './windows/main-window'
import { SettingsWindow } from './windows/settings-window'

/** Composes the app once Electron is ready. */
export class AppController {
  private readonly roles = new RoleRegistry()
  private readonly media = new MediaController()
  private readonly injection = new InjectionRegistry()
  private readonly userData = app.getPath('userData')
  private readonly windowState: WindowStateStore
  private readonly sunoSession: Session
  private readonly mainWindow: MainWindow
  private readonly settingsWindow: SettingsWindow
  private readonly tray: AppTray
  private readonly thumbar: ThumbarButtons
  private readonly richPresence: RichPresence
  private readonly updater: Updater
  private readonly sunoPlusPlus: SunoPlusPlusManager
  private quitting = false
  private readonly hardwareAccelerationAtLaunch: boolean

  constructor(
    private readonly settings: SettingsStore,
    private readonly log: Logger
  ) {
    this.hardwareAccelerationAtLaunch = settings.get().hardwareAcceleration
    // Before any window exists, so the first frame already uses the chosen Light / Dark / Auto.
    nativeTheme.themeSource = settings.get().theme
    handleAppProtocol(rendererRoot(), log.child('protocol'))

    this.sunoSession = session.fromPartition(SUNO_PARTITION)
    hardenSunoSession(this.sunoSession, {
      log: log.child('permissions'),
      getParentWindow: () => this.mainWindow.window
    })
    registerProtocolClient(log)
    applyLoginItem(settings.get(), log)

    const devToolsAllowed = (): boolean => isDev || this.settings.get().allowDevTools
    this.windowState = new WindowStateStore(this.userData, log)
    this.settingsWindow = new SettingsWindow({ roles: this.roles, icon: iconPath, devToolsAllowed })
    this.mainWindow = new MainWindow({
      settings,
      windowState: this.windowState,
      roles: this.roles,
      session: this.sunoSession,
      injection: this.injection,
      log: log.child('window'),
      icon: iconPath,
      appVersion: app.getVersion(),
      devToolsAllowed,
      openSettings: () => {
        this.openSettings()
      },
      shouldHideOnClose: () => this.settings.get().closeToTray,
      onHiddenToTray: () => {
        this.onHiddenToTray()
      },
      onQuitRequested: () => {
        this.quit()
      }
    })
    this.media.setTarget(this.mainWindow.contents)

    this.thumbar = new ThumbarButtons(this.mainWindow.window, (command) => {
      this.media.command(command)
    })
    this.tray = new AppTray({
      icon: process.platform === 'win32' ? trayIcoPath : trayPngPath,
      isWindowVisible: () => this.mainWindow.isVisible(),
      toggleWindow: () => {
        this.mainWindow.toggleVisibility()
      },
      onCommand: (command) => {
        this.media.command(command)
      },
      openSettings: () => {
        this.openSettings()
      },
      quit: () => {
        this.quit()
      }
    })

    new DownloadManager({
      session: this.sunoSession,
      settings,
      getWindow: () => this.mainWindow.window,
      icon: iconPath,
      log: log.child('downloads')
    })

    this.richPresence = new RichPresence({
      clientId: appConfig.discordClientId,
      log: log.child('discord'),
      getPageUrl: () => this.mainWindow.currentUrl()
    })
    this.richPresence.setEnabled(settings.get().discordRichPresence)

    this.updater = new Updater(log.child('updater'), { portable: isPortable() })
    this.updater.on('state', (state) => {
      this.settingsWindow.contents?.send(IPC.updateState, state)
      if (state.status === 'downloaded') this.notifyUpdateReady(state.version)
    })

    this.sunoPlusPlus = new SunoPlusPlusManager({
      dir: path.join(this.userData, 'sunoplusplus'),
      settings,
      injection: this.injection,
      log: log.child('suno++'),
      appVersion: app.getVersion(),
      bridgeApi: BRIDGE_API_VERSION,
      fetch: (url, init) => net.fetch(url, init)
    })
    this.sunoPlusPlus.on('info', (info) => {
      this.settingsWindow.contents?.send(IPC.sunoPlusPlusInfo, info)
    })

    this.wireEvents()
    registerIpcHandlers(new IpcRouter(this.roles, { devServerUrl }, log.child('ipc')), {
      log,
      mainWindow: this.mainWindow,
      settings,
      media: this.media,
      updater: this.updater,
      sunoPlusPlus: this.sunoPlusPlus,
      openSettings: () => {
        this.openSettings()
      },
      appInfo: () => this.appInfo(),
      chooseDownloadFolder: () => this.chooseDownloadFolder(),
      clearSession: () => this.clearSession(),
      resetAppSettings: () => this.resetAppSettings(),
      relaunch: () => {
        this.relaunch()
      },
      onboardingState: () => ({ theme: this.settings.get().theme, version: app.getVersion() }),
      setTheme: (theme: ThemeSource) => {
        this.settings.update({ theme })
      },
      finishOnboarding: () => {
        this.settings.update({ onboardingCompleted: true })
        this.mainWindow.hideOnboarding()
      }
    })
    this.updater.start(settings.get().updateChannel)
    this.exposeTestHooks()
  }

  /** Handles for tests/e2e. Never present in packaged builds. */
  private exposeTestHooks(): void {
    if (app.isPackaged || process.env['SUNO_DESKTOP_E2E'] !== '1') return
    Object.assign(globalThis, {
      __sunoDesktopE2E: {
        settings: this.settings,
        injection: this.injection,
        sunoPlusPlus: this.sunoPlusPlus,
        media: this.media,
        mainWindow: this.mainWindow,
        openDeepLink: (url: string) => {
          this.openDeepLink(url)
        },
        openSettings: () => {
          this.openSettings()
        }
      }
    })
  }

  private wireEvents(): void {
    const win = this.mainWindow.window
    this.media.on('changed', (snapshot) => {
      this.tray.update(snapshot)
      this.thumbar.update(snapshot)
      this.richPresence.update(snapshot)
    })
    win.on('show', () => {
      this.tray.refresh()
      // Thumbnail buttons only stick once the window has a taskbar button.
      this.thumbar.update(this.media.current, true)
    })
    win.on('hide', () => {
      this.tray.refresh()
    })
    this.settings.on('changed', (next, previous) => {
      this.onSettingsChanged(next, previous)
    })
    nativeTheme.on('updated', () => {
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      for (const contents of this.roles.withRole([
        'titlebar',
        'settings',
        'offline',
        'onboarding'
      ])) {
        contents.send(IPC.themeChanged, theme)
      }
    })

    app.on('before-quit', () => {
      this.quitting = true
      this.mainWindow.markQuitting()
      this.settings.flush()
      this.windowState.flush()
      this.richPresence.dispose()
      this.updater.dispose()
      this.sunoPlusPlus.dispose()
    })
    app.on('window-all-closed', () => {
      app.quit()
    })
  }

  /** Shows the window unless the app was launched hidden (login item / start minimized). */
  start(hidden: boolean): void {
    void this.sunoPlusPlus.start()
    const win = this.mainWindow.window
    const onboarding = !this.settings.get().onboardingCompleted
    if (onboarding) this.mainWindow.showOnboarding()
    win.once('ready-to-show', () => {
      // A first launch always shows the window, whatever "start minimized" says.
      if (!hidden || onboarding) this.mainWindow.show()
      else if (!this.settings.get().closeToTray) this.mainWindow.showMinimized()
      else this.log.info('started hidden in the tray')
    })
  }

  showWindow(): void {
    this.mainWindow.show()
  }

  openDeepLink(raw: string): void {
    handleDeepLink(raw, {
      log: this.log.child('deep-link'),
      openUrl: (url) => {
        this.mainWindow.show()
        this.mainWindow.loadUrl(url)
      },
      sunoPlusPlus: (link) => {
        void this.handleSunoPlusPlusLink(link)
      }
    })
  }

  openSettings(): void {
    this.settingsWindow.open()
  }

  quit(): void {
    if (!this.quitting) app.quit()
  }

  private relaunch(): void {
    const portable = process.env['PORTABLE_EXECUTABLE_FILE']
    app.relaunch(portable ? { execPath: portable } : undefined)
    this.quit()
  }

  private onSettingsChanged(next: Settings, previous: Settings): void {
    if (
      next.launchOnStartup !== previous.launchOnStartup ||
      next.startMinimized !== previous.startMinimized
    ) {
      applyLoginItem(next, this.log)
    }
    if (next.discordRichPresence !== previous.discordRichPresence) {
      this.richPresence.setEnabled(next.discordRichPresence)
      if (next.discordRichPresence) this.richPresence.update(this.media.current)
    }
    if (next.zoomFactor !== previous.zoomFactor) this.mainWindow.applyZoom()
    if (next.theme !== previous.theme) nativeTheme.themeSource = next.theme
    if (!next.onboardingCompleted && previous.onboardingCompleted) {
      // "Reset app settings" brings the onboarding back right away.
      this.mainWindow.show()
      this.mainWindow.showOnboarding()
    }
    this.sunoPlusPlus.onSettingsChanged(next, previous)
    if (next.updateChannel !== previous.updateChannel) {
      this.updater.setChannel(next.updateChannel)
      this.updater.check()
    }
    this.settingsWindow.contents?.send(IPC.settingsChanged, next)
  }

  private onHiddenToTray(): void {
    this.tray.refresh()
    if (this.settings.get().trayHintShown || !Notification.isSupported()) return
    this.settings.update({ trayHintShown: true })
    new Notification({
      title: `${APP_NAME} is still running`,
      body: 'Music keeps playing. Use the tray icon to reopen or quit. You can turn this off in Settings.',
      icon: iconPath
    }).show()
  }

  private notifyUpdateReady(version: string | undefined): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: 'Update ready',
      body: `${APP_NAME} ${version ?? ''} will be installed when you quit.`.replace('  ', ' '),
      icon: iconPath
    })
    notification.on('click', () => {
      this.openSettings()
    })
    notification.show()
  }

  /**
   * `suno-desktop://plugin/install?id=…` and `suno-desktop://theme/install?id=…` (from the Suno++
   * site or a friend). Everything in Suno++ is already reviewed and bundled, so "install" means
   * "turn on", and nothing happens without the user saying yes.
   */
  private async handleSunoPlusPlusLink(
    link: ReservedLink<'plugin'> | ReservedLink<'theme'>
  ): Promise<void> {
    this.mainWindow.show()
    const parent = this.mainWindow.window
    const what = link.kind
    const id = link.params['id']
    const ask = async (options: Electron.MessageBoxOptions): Promise<boolean> =>
      (
        await dialog.showMessageBox(parent, {
          title: APP_NAME,
          defaultId: 0,
          cancelId: 1,
          ...options
        })
      ).response === 0
    if ((link.action !== 'install' && link.action !== 'enable') || !id) {
      await dialog.showMessageBox(parent, {
        type: 'info',
        title: APP_NAME,
        message: "This Suno++ link isn't supported",
        detail: 'It may need a newer version of Suno Desktop.'
      })
      return
    }
    if (!this.settings.get().sunoPlusPlusEnabled) {
      const turnOn = await ask({
        type: 'question',
        buttons: ['Turn on Suno++', 'Cancel'],
        message: 'Turn on Suno++?',
        detail:
          `This link adds a community ${what}. Suno++ downloads community plugins and themes ` +
          'from GitHub (github.com/Cat-things/sunoplusplus) and keeps them up to date. ' +
          'Each one stays off until you turn it on.'
      })
      if (!turnOn) return
      this.settings.update({ sunoPlusPlusEnabled: true })
    }
    await this.sunoPlusPlus.check()
    const catalog = this.sunoPlusPlus.catalog()
    const item =
      what === 'plugin'
        ? catalog?.plugins.find((p) => p.id === id)
        : catalog?.themes.find((t) => t.id === id)
    if (!item) {
      await dialog.showMessageBox(parent, {
        type: 'info',
        title: APP_NAME,
        message: `Couldn't find that ${what}`,
        detail: catalog
          ? `"${id}" isn't in Suno++ ${catalog.sunoplusplusVersion}. If it was just added, try again later.`
          : "Suno++ couldn't be downloaded. Check your connection and try again in Settings → Plugins."
      })
      return
    }
    const yes = await ask({
      type: 'question',
      buttons: [what === 'plugin' ? 'Turn on' : 'Use theme', 'Cancel'],
      message: what === 'plugin' ? `Turn on ${item.name}?` : `Use the ${item.name} theme?`,
      detail: `${item.description}\n\nBy ${item.authors.map((a) => a.name).join(', ')} · version ${item.version}`
    })
    if (!yes) return
    this.sunoPlusPlus.act(
      what === 'plugin'
        ? { type: 'setPluginEnabled', id: item.id, enabled: true }
        : { type: 'setTheme', id: item.id }
    )
  }

  private appInfo(): AppInfo {
    return {
      name: APP_NAME,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      isPortable: isPortable(),
      discordConfigured: appConfig.discordClientId !== null,
      hardwareAccelerationAtLaunch: this.hardwareAccelerationAtLaunch
    }
  }

  private async chooseDownloadFolder(): Promise<Settings> {
    const parent = this.settingsWindowBrowser()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose download folder',
      defaultPath: this.settings.get().downloadFolder ?? app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    const folder = result.filePaths[0]
    if (!result.canceled && folder) {
      return this.settings.update({ downloadFolder: folder, downloadAskWhereToSave: false })
    }
    return this.settings.get()
  }

  private settingsWindowBrowser(): BrowserWindow | undefined {
    const contents = this.settingsWindow.contents
    return contents ? (BrowserWindow.fromWebContents(contents) ?? undefined) : undefined
  }

  /**
   * Puts every app setting back to its default and brings back the onboarding. Suno's own data
   * (login, cookies, cache) lives in the persist:suno session and is not touched.
   */
  private async resetAppSettings(): Promise<boolean> {
    const parent = this.settingsWindowBrowser()
    const message: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Reset settings', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: APP_NAME,
      message: 'Reset Suno Desktop settings?',
      detail:
        'All app settings go back to their defaults and the welcome screen runs again. ' +
        'You stay signed in to Suno, and your songs and downloads are not touched.'
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, message)
      : await dialog.showMessageBox(message)
    if (response !== 0) return false
    this.settings.reset()
    this.log.info('app settings reset by user')
    return true
  }

  private async clearSession(): Promise<boolean> {
    const parent = this.settingsWindowBrowser()
    const message: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Clear and log out', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: APP_NAME,
      message: 'Clear session and log out?',
      detail:
        'This signs you out of Suno and removes cookies, cache and site data stored by the app.'
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, message)
      : await dialog.showMessageBox(message)
    if (response !== 0) return false
    await this.sunoSession.clearStorageData()
    await this.sunoSession.clearCache()
    await this.sunoSession.clearAuthCache()
    this.log.info('session cleared by user')
    this.mainWindow.goHome()
    return true
  }
}
