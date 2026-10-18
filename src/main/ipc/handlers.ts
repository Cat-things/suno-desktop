import { IPC, type AppInfo, type OnboardingState } from '../../shared/ipc-channels'
import type { Settings, ThemeSource } from '../../shared/settings'
import type { Logger } from '../logger'
import type { MediaController } from '../media/media-controller'
import { openExternalSafely } from '../navigation'
import type { SettingsStore } from '../settings-store'
import type { SunoPlusPlusManager } from '../sunoplusplus/manager'
import type { Updater } from '../updater'
import type { MainWindow } from '../windows/main-window'
import type { IpcRouter } from './router'

export interface IpcContext {
  readonly log: Logger
  readonly mainWindow: MainWindow
  readonly settings: SettingsStore
  readonly media: MediaController
  readonly updater: Updater
  readonly sunoPlusPlus: SunoPlusPlusManager
  readonly openSettings: () => void
  readonly appInfo: () => AppInfo
  readonly chooseDownloadFolder: () => Promise<Settings>
  readonly clearSession: () => Promise<boolean>
  readonly resetAppSettings: () => Promise<boolean>
  readonly relaunch: () => void
  readonly onboardingState: () => OnboardingState
  readonly setTheme: (theme: ThemeSource) => void
  readonly finishOnboarding: () => void
}

/** Wires every IPC channel main accepts. Validation happens in the router before these run. */
export function registerIpcHandlers(router: IpcRouter, ctx: IpcContext): void {
  const { mainWindow } = ctx

  router.handle(IPC.navBack, () => {
    mainWindow.back()
  })
  router.handle(IPC.navForward, () => {
    mainWindow.forward()
  })
  router.handle(IPC.navReload, () => {
    mainWindow.reload()
  })
  router.handle(IPC.navHome, () => {
    mainWindow.goHome()
  })
  router.handle(IPC.navRetry, () => {
    mainWindow.retry()
  })
  router.handle(IPC.navGetState, () => mainWindow.navState())
  router.handle(IPC.openSettings, () => {
    ctx.openSettings()
  })

  router.handle(IPC.settingsGet, () => ctx.settings.get())
  router.handle(IPC.settingsUpdate, (patch) => ctx.settings.update(patch))
  router.handle(IPC.settingsChooseDownloadFolder, () => ctx.chooseDownloadFolder())
  router.handle(IPC.settingsResetApp, () => ctx.resetAppSettings())
  router.handle(IPC.sessionClear, () => ctx.clearSession())

  router.handle(IPC.appGetInfo, () => ctx.appInfo())
  router.handle(IPC.appRelaunch, () => {
    ctx.relaunch()
  })
  router.handle(IPC.appOpenExternal, (url) => {
    openExternalSafely(url, ctx.log)
  })

  router.handle(IPC.updateCheck, () => {
    ctx.updater.check()
  })
  router.handle(IPC.updateInstall, () => {
    ctx.updater.install()
  })
  router.handle(IPC.updateGetState, () => ctx.updater.current)

  router.handle(IPC.sunoPlusPlusGetInfo, () => ctx.sunoPlusPlus.info())
  router.handle(IPC.sunoPlusPlusCheck, async () => {
    await ctx.sunoPlusPlus.check()
    return ctx.sunoPlusPlus.info()
  })
  router.handle(IPC.sunoPlusPlusAction, (action) => ctx.sunoPlusPlus.act(action))
  router.handle(IPC.offlineGetInfo, () => mainWindow.offlineInfo())

  router.handle(IPC.onboardingGetState, () => ctx.onboardingState())
  router.handle(IPC.onboardingSetTheme, (theme) => {
    ctx.setTheme(theme)
  })
  router.handle(IPC.onboardingFinish, () => {
    ctx.finishOnboarding()
  })

  router.on(IPC.mediaUpdate, (snapshot) => {
    ctx.media.update(snapshot)
  })
}
