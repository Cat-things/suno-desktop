import type { Rect } from '../../shared/window-state'

export interface Size {
  readonly width: number
  readonly height: number
}

/** The suno.com view sits under the custom title bar, or fills the window in fullscreen. */
export function contentViewBounds(window: Size, titlebarHeight: number, fullscreen: boolean): Rect {
  const top = fullscreen ? 0 : titlebarHeight
  return {
    x: 0,
    y: top,
    width: Math.max(0, window.width),
    height: Math.max(0, window.height - top)
  }
}

/** Mica (`backgroundMaterial`) needs Windows 11 22H2, build 22621 or newer. */
export function supportsMica(platform: string, release: string): boolean {
  if (platform !== 'win32') return false
  const [major, , build] = release.split('.').map((n) => Number.parseInt(n, 10))
  return major === 10 && (build ?? 0) >= 22621
}

export interface OverlayColors {
  readonly color: string
  readonly symbolColor: string
}

/** Colors for the native caption buttons drawn by `titleBarOverlay`. */
export function titleBarOverlayColors(dark: boolean, mica: boolean): OverlayColors {
  if (mica) return { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a' }
  return dark
    ? { color: '#202020', symbolColor: '#ffffff' }
    : { color: '#f3f3f3', symbolColor: '#1a1a1a' }
}

export function windowBackground(dark: boolean, mica: boolean): string {
  if (mica) return '#00000000'
  return dark ? '#202020' : '#f3f3f3'
}
