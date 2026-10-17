import fs from 'node:fs'
import { nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { MediaCommand, MediaSnapshot } from '../../shared/media'
import nextIcon from '../../../resources/thumbar/next.png?asset'
import nextIcon2x from '../../../resources/thumbar/next@2x.png?asset'
import pauseIcon from '../../../resources/thumbar/pause.png?asset'
import pauseIcon2x from '../../../resources/thumbar/pause@2x.png?asset'
import playIcon from '../../../resources/thumbar/play.png?asset'
import playIcon2x from '../../../resources/thumbar/play@2x.png?asset'
import previousIcon from '../../../resources/thumbar/previous.png?asset'
import previousIcon2x from '../../../resources/thumbar/previous@2x.png?asset'

function icon(path1x: string, path2x: string): NativeImage {
  const image = nativeImage.createFromPath(path1x)
  try {
    image.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path2x) })
  } catch {
    // 1x is enough if the 2x file is missing.
  }
  return image
}

/** Taskbar thumbnail toolbar (Windows only): previous, play/pause, next. */
export class ThumbarButtons {
  private readonly icons = {
    previous: icon(previousIcon, previousIcon2x),
    play: icon(playIcon, playIcon2x),
    pause: icon(pauseIcon, pauseIcon2x),
    next: icon(nextIcon, nextIcon2x)
  }
  private lastKey = ''

  constructor(
    private readonly window: BrowserWindow,
    private readonly onCommand: (command: MediaCommand) => void
  ) {}

  update(snapshot: MediaSnapshot, force = false): void {
    if (process.platform !== 'win32' || this.window.isDestroyed()) return
    const playing = snapshot.playbackState === 'playing'
    const hasMedia = snapshot.playbackState !== 'none'
    const key = JSON.stringify([playing, hasMedia, snapshot.canGoNext, snapshot.canGoPrevious])
    if (!force && key === this.lastKey) return
    this.lastKey = key
    this.window.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: this.icons.previous,
        flags: snapshot.canGoPrevious ? [] : ['disabled'],
        click: () => {
          this.onCommand('previous')
        }
      },
      {
        tooltip: playing ? 'Pause' : 'Play',
        icon: playing ? this.icons.pause : this.icons.play,
        flags: hasMedia ? [] : ['disabled'],
        click: () => {
          this.onCommand('toggle')
        }
      },
      {
        tooltip: 'Next',
        icon: this.icons.next,
        flags: snapshot.canGoNext ? [] : ['disabled'],
        click: () => {
          this.onCommand('next')
        }
      }
    ])
  }
}
