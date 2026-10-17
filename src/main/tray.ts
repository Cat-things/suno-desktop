import { Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { MediaCommand, MediaSnapshot } from '../shared/media'

export interface TrayDeps {
  readonly icon: string
  readonly isWindowVisible: () => boolean
  readonly toggleWindow: () => void
  readonly onCommand: (command: MediaCommand) => void
  readonly openSettings: () => void
  readonly quit: () => void
}

/** Windows limits tray tooltips to 127 characters. */
const MAX_TOOLTIP = 127

export class AppTray {
  private readonly tray: Tray
  private snapshot: MediaSnapshot | null = null

  constructor(private readonly deps: TrayDeps) {
    this.tray = new Tray(nativeImage.createFromPath(deps.icon))
    this.tray.setToolTip(APP_NAME)
    this.tray.on('click', () => {
      deps.toggleWindow()
    })
    this.refresh()
  }

  update(snapshot: MediaSnapshot): void {
    this.snapshot = snapshot
    this.refresh()
  }

  /** Rebuild after the window was shown or hidden so the first item reads correctly. */
  refresh(): void {
    const s = this.snapshot
    const playing = s?.playbackState === 'playing'
    const hasMedia = s !== null && s.playbackState !== 'none'
    const song = s?.song
    const tooltip = song
      ? `${song.title}${song.artist ? ` – ${song.artist}` : ''}`.slice(0, MAX_TOOLTIP)
      : APP_NAME
    this.tray.setToolTip(tooltip)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: this.deps.isWindowVisible() ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`,
          click: () => {
            this.deps.toggleWindow()
          }
        },
        { type: 'separator' },
        ...(song ? [{ label: tooltip, enabled: false }] : []),
        {
          label: playing ? 'Pause' : 'Play',
          enabled: hasMedia,
          click: () => {
            this.deps.onCommand('toggle')
          }
        },
        {
          label: 'Next',
          enabled: s?.canGoNext ?? false,
          click: () => {
            this.deps.onCommand('next')
          }
        },
        {
          label: 'Previous',
          enabled: s?.canGoPrevious ?? false,
          click: () => {
            this.deps.onCommand('previous')
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          click: () => {
            this.deps.openSettings()
          }
        },
        {
          label: `Quit ${APP_NAME}`,
          click: () => {
            this.deps.quit()
          }
        }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
