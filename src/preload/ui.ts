/**
 * Preload for the bundled local UI (title bar, settings, offline page). Exposes a small typed API
 * as `window.sunoDesktopUI`. Main validates the sender and payload of every call.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { APP_HOST, APP_SCHEME } from '../shared/constants'
import { IPC, type IpcChannel, type SunoDesktopUiApi } from '../shared/ipc-channels'

// Results are typed by `SunoDesktopUiApi`; Promise<never> is assignable to each of those.
const invoke = (channel: IpcChannel, payload?: unknown): Promise<never> =>
  ipcRenderer.invoke(channel, payload) as Promise<never>

// Listener parameter types come from `SunoDesktopUiApi`; `never` accepts all of them.
function subscribe(channel: IpcChannel, listener: (value: never) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: unknown): void => {
    listener(value as never)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: SunoDesktopUiApi = {
  nav: {
    back: () => invoke(IPC.navBack),
    forward: () => invoke(IPC.navForward),
    reload: () => invoke(IPC.navReload),
    home: () => invoke(IPC.navHome),
    retry: () => invoke(IPC.navRetry),
    getState: () => invoke(IPC.navGetState),
    onState: (listener) => subscribe(IPC.navState, listener)
  },
  app: {
    openSettings: () => invoke(IPC.openSettings),
    getInfo: () => invoke(IPC.appGetInfo),
    relaunch: () => invoke(IPC.appRelaunch),
    openExternal: (url) => invoke(IPC.appOpenExternal, url)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    chooseDownloadFolder: () => invoke(IPC.settingsChooseDownloadFolder),
    resetApp: () => invoke(IPC.settingsResetApp),
    clearSession: () => invoke(IPC.sessionClear),
    onChanged: (listener) => subscribe(IPC.settingsChanged, listener)
  },
  updates: {
    check: () => invoke(IPC.updateCheck),
    install: () => invoke(IPC.updateInstall),
    getState: () => invoke(IPC.updateGetState),
    onState: (listener) => subscribe(IPC.updateState, listener)
  },
  sunoPlusPlus: {
    getInfo: () => invoke(IPC.sunoPlusPlusGetInfo),
    check: () => invoke(IPC.sunoPlusPlusCheck),
    act: (action) => invoke(IPC.sunoPlusPlusAction, action),
    onInfo: (listener) => subscribe(IPC.sunoPlusPlusInfo, listener)
  },
  onboarding: {
    getState: () => invoke(IPC.onboardingGetState),
    setTheme: (theme) => invoke(IPC.onboardingSetTheme, theme),
    finish: () => invoke(IPC.onboardingFinish)
  },
  offline: {
    getInfo: () => invoke(IPC.offlineGetInfo),
    onInfo: (listener) => subscribe(IPC.offlineInfo, listener)
  }
}

const argValue = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

const devOrigin = argValue('suno-desktop-dev-origin')

const trusted =
  (location.protocol === `${APP_SCHEME}:` && location.host === APP_HOST) ||
  (devOrigin !== undefined && location.origin === devOrigin)

/**
 * Main owns the theme (nativeTheme follows Windows) and pushes it here; CSS keys off
 * `<html data-theme>`. Applied as soon as <html> exists so the first paint is already right.
 */
function applyTheme(theme: string | undefined): void {
  if (theme !== 'dark' && theme !== 'light') return
  const set = (): boolean => {
    // The DOM typings say this is never null, but it is while a preload runs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!document.documentElement) return false
    document.documentElement.dataset['theme'] = theme
    return true
  }
  if (set()) return
  const observer = new MutationObserver(() => {
    if (set()) observer.disconnect()
  })
  observer.observe(document, { childList: true })
}

if (trusted) {
  contextBridge.exposeInMainWorld('sunoDesktopUI', api)
  applyTheme(argValue('suno-desktop-theme'))
  ipcRenderer.on(IPC.themeChanged, (_event, theme: unknown) => {
    applyTheme(typeof theme === 'string' ? theme : undefined)
  })
}
