/**
 * IPC channel names and payload types. No runtime dependencies so preloads stay small;
 * the zod validators that main applies to every message live in `ipc-schemas.ts`.
 */

import type { MediaCommand, MediaSnapshot } from './media'
import type { BridgeEventName, BridgeEventMap } from './bridge'
import type { Settings, SettingsPatch } from './settings'

export const IPC = {
  // Local UI -> main (invoke)
  navBack: 'nav:back',
  navForward: 'nav:forward',
  navReload: 'nav:reload',
  navHome: 'nav:home',
  navRetry: 'nav:retry',
  navGetState: 'nav:get-state',
  openSettings: 'app:open-settings',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseDownloadFolder: 'settings:choose-download-folder',
  sessionClear: 'session:clear',
  appGetInfo: 'app:get-info',
  appRelaunch: 'app:relaunch',
  appOpenExternal: 'app:open-external',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateGetState: 'update:get-state',
  pluginsList: 'plugins:list',
  offlineGetInfo: 'offline:get-info',

  // Main -> local UI (send)
  navState: 'nav:state',
  settingsChanged: 'settings:changed',
  updateState: 'update:state',
  offlineInfo: 'offline:info',
  themeChanged: 'ui:theme',

  // suno.com preload -> main (send)
  mediaUpdate: 'media:update',

  // Main -> suno.com preload (send)
  mediaCommand: 'media:command',
  bridgeEvent: 'bridge:event'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface NavState {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly isLoading: boolean
  readonly title: string
  readonly url: string
}

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electron: string
  readonly chrome: string
  readonly platform: string
  readonly arch: string
  readonly isPackaged: boolean
  readonly isPortable: boolean
  readonly pluginsDir: string
  readonly discordConfigured: boolean
  readonly pluginsAvailable: boolean
  /** Hardware acceleration as applied at launch; differs from settings until a restart. */
  readonly hardwareAccelerationAtLaunch: boolean
}

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  readonly status: UpdateStatus
  readonly version?: string
  /** 0-100 while downloading. */
  readonly percent?: number
  readonly message?: string
}

export interface OfflineInfo {
  readonly kind: 'load-failed' | 'crashed'
  readonly url: string
  readonly errorCode: number
  readonly errorDescription: string
}

export interface PluginSummary {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly enabled: boolean
}

export interface BridgeEventMessage<E extends BridgeEventName = BridgeEventName> {
  readonly event: E
  readonly payload: BridgeEventMap[E]
}

/** API the local UI preload exposes as `window.sunoDesktopUI`. Not available to suno.com. */
export interface SunoDesktopUiApi {
  readonly nav: {
    back(): Promise<void>
    forward(): Promise<void>
    reload(): Promise<void>
    home(): Promise<void>
    retry(): Promise<void>
    getState(): Promise<NavState>
    onState(listener: (state: NavState) => void): () => void
  }
  readonly app: {
    openSettings(): Promise<void>
    getInfo(): Promise<AppInfo>
    relaunch(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  readonly settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    chooseDownloadFolder(): Promise<Settings>
    clearSession(): Promise<boolean>
    onChanged(listener: (settings: Settings) => void): () => void
  }
  readonly updates: {
    check(): Promise<void>
    install(): Promise<void>
    getState(): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
  }
  readonly plugins: {
    list(): Promise<readonly PluginSummary[]>
  }
  readonly offline: {
    getInfo(): Promise<OfflineInfo | null>
    onInfo(listener: (info: OfflineInfo) => void): () => void
  }
}

export type { MediaCommand, MediaSnapshot }
