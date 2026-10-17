import type { SunoDesktopUiApi } from '../../shared/ipc-channels'

declare global {
  interface Window {
    readonly sunoDesktopUI: SunoDesktopUiApi
  }
}

export {}
