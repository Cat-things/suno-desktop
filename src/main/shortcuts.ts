/** Keyboard shortcuts handled on `before-input-event`, so they work without a visible menu. */

export type ShortcutAction =
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'openSettings'
  | 'toggleFullscreen'
  | 'toggleDevTools'

export interface KeyInput {
  readonly type: string
  readonly key: string
  readonly code?: string
  readonly control: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly meta: boolean
}

export function matchShortcut(input: KeyInput): ShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const { key, shift, alt } = input
  const code = input.code ?? ''
  const ctrl = input.control || input.meta
  const lower = key.toLowerCase()

  if (ctrl && !alt) {
    if (lower === 'r') return shift ? 'hardReload' : 'reload'
    if (key === 'F5') return 'hardReload'
    if (key === '+' || key === '=' || code === 'NumpadAdd') return 'zoomIn'
    if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'zoomOut'
    if (!shift && (key === '0' || code === 'Numpad0' || code === 'Digit0')) return 'zoomReset'
    if (!shift && key === ',') return 'openSettings'
    if (shift && lower === 'i') return 'toggleDevTools'
    return null
  }
  if (alt && !ctrl && !shift) {
    if (key === 'ArrowLeft') return 'back'
    if (key === 'ArrowRight') return 'forward'
    return null
  }
  if (!ctrl && !alt && !shift) {
    switch (key) {
      case 'F5':
        return 'reload'
      case 'F11':
        return 'toggleFullscreen'
      case 'F12':
        return 'toggleDevTools'
      case 'BrowserBack':
        return 'back'
      case 'BrowserForward':
        return 'forward'
    }
  }
  return null
}
