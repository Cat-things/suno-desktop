import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { EMPTY_MEDIA_SNAPSHOT, type MediaCommand, type MediaSnapshot } from '../../shared/media'

interface MediaEvents {
  changed: [next: MediaSnapshot, previous: MediaSnapshot]
}

/**
 * Holds the latest media state reported by the suno.com preload and sends playback commands
 * back. Commands go through navigator.mediaSession action handlers in the page (see
 * src/preload/page-world.ts), never through Suno-specific DOM selectors.
 */
export class MediaController extends EventEmitter<MediaEvents> {
  private snapshot: MediaSnapshot = EMPTY_MEDIA_SNAPSHOT
  private target: WebContents | null = null

  get current(): MediaSnapshot {
    return this.snapshot
  }

  setTarget(contents: WebContents): void {
    this.target = contents
    // A new document starts without media; the preload reports again once something plays.
    contents.on('did-navigate', () => {
      this.update(EMPTY_MEDIA_SNAPSHOT)
    })
    contents.on('render-process-gone', () => {
      this.update(EMPTY_MEDIA_SNAPSHOT)
    })
  }

  update(next: MediaSnapshot): void {
    const previous = this.snapshot
    if (JSON.stringify(previous) === JSON.stringify(next)) return
    this.snapshot = next
    this.emit('changed', next, previous)
  }

  command(command: MediaCommand): void {
    if (this.target && !this.target.isDestroyed()) this.target.send(IPC.mediaCommand, command)
  }
}
