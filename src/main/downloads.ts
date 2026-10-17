import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  Notification,
  shell,
  type BrowserWindow,
  type DownloadItem,
  type Session
} from 'electron'
import { APP_NAME } from '../shared/constants'
import { sanitizeFilename, uniqueFilename } from './filenames'
import type { Logger } from './logger'
import type { SettingsStore } from './settings-store'

export interface DownloadDeps {
  readonly session: Session
  readonly settings: SettingsStore
  readonly getWindow: () => BrowserWindow | null
  readonly icon: string
  readonly log: Logger
}

/**
 * Downloads from suno.com: native save dialog or the configured folder, a taskbar progress bar,
 * and a toast with "Show in folder" when done.
 */
export class DownloadManager {
  private readonly active = new Set<DownloadItem>()

  constructor(private readonly deps: DownloadDeps) {
    deps.session.on('will-download', (_event, item) => {
      this.prepare(item)
      this.track(item)
    })
  }

  private targetFolder(): string {
    return this.deps.settings.get().downloadFolder ?? app.getPath('downloads')
  }

  private prepare(item: DownloadItem): void {
    const settings = this.deps.settings.get()
    const name = sanitizeFilename(item.getFilename())
    const folder = this.targetFolder()

    if (!settings.downloadAskWhereToSave) {
      try {
        fs.mkdirSync(folder, { recursive: true })
        const unique = uniqueFilename(name, (candidate) =>
          fs.existsSync(path.join(folder, candidate))
        )
        item.setSavePath(path.join(folder, unique))
        return
      } catch (error) {
        this.deps.log.warn(`download folder ${folder} unusable; asking instead`, error)
      }
    }
    // No save path set: Electron shows the native save dialog with these options.
    item.setSaveDialogOptions({
      title: 'Save download',
      defaultPath: path.join(folder, name),
      buttonLabel: 'Save'
    })
  }

  private track(item: DownloadItem): void {
    this.active.add(item)
    this.updateProgress()
    item.on('updated', () => {
      this.updateProgress()
    })
    item.once('done', (_event, state) => {
      this.active.delete(item)
      this.updateProgress()
      const file = item.getSavePath()
      if (state === 'completed') {
        this.deps.log.info('download completed', path.basename(file))
        this.notifyDone(file)
      } else if (state === 'interrupted') {
        this.deps.log.warn('download interrupted', item.getFilename())
        this.notify('Download failed', `${item.getFilename()} could not be downloaded.`)
      }
    })
  }

  private updateProgress(): void {
    const window = this.deps.getWindow()
    if (!window || window.isDestroyed()) return
    if (this.active.size === 0) {
      window.setProgressBar(-1)
      return
    }
    let received = 0
    let total = 0
    let unknown = false
    let paused = true
    for (const item of this.active) {
      const size = item.getTotalBytes()
      if (size <= 0) unknown = true
      received += item.getReceivedBytes()
      total += size
      if (!item.isPaused()) paused = false
    }
    if (unknown || total === 0) window.setProgressBar(2, { mode: 'indeterminate' })
    else window.setProgressBar(received / total, { mode: paused ? 'paused' : 'normal' })
  }

  private notifyDone(file: string): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: 'Download complete',
      body: path.basename(file),
      icon: this.deps.icon,
      actions: [{ type: 'button', text: 'Show in folder' }]
    })
    const reveal = (): void => {
      shell.showItemInFolder(file)
    }
    notification.on('click', reveal)
    notification.on('action', reveal)
    notification.show()
  }

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return
    new Notification({ title: title || APP_NAME, body, icon: this.deps.icon }).show()
  }
}
