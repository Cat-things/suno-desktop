import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/ipc-channels'
import type { UpdateChannel } from '../shared/settings'
import type { Logger } from './logger'

interface UpdaterEvents {
  state: [UpdateState]
}

const FIRST_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Auto-updates from GitHub Releases via electron-updater. Disabled for dev and portable builds
 * (electron-updater cannot replace a portable exe).
 */
export class Updater extends EventEmitter<UpdaterEvents> {
  private state: UpdateState
  private interval: NodeJS.Timeout | null = null
  readonly enabled: boolean

  constructor(
    private readonly log: Logger,
    options: { readonly portable: boolean }
  ) {
    super()
    this.enabled = app.isPackaged && !options.portable && process.platform === 'win32'
    this.state = this.enabled
      ? { status: 'idle' }
      : {
          status: 'disabled',
          message: options.portable
            ? 'Portable builds do not auto-update. Download new versions from GitHub.'
            : 'Updates are only checked in installed builds.'
        }
  }

  get current(): UpdateState {
    return this.state
  }

  private set(state: UpdateState): void {
    this.state = state
    this.emit('state', state)
  }

  start(channel: UpdateChannel): void {
    if (!this.enabled) return
    autoUpdater.logger = {
      info: (m: unknown) => {
        this.log.info(String(m))
      },
      warn: (m: unknown) => {
        this.log.warn(String(m))
      },
      error: (m: unknown) => {
        this.log.error(String(m))
      },
      debug: (m: unknown) => {
        this.log.debug(String(m))
      }
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    this.setChannel(channel)

    autoUpdater.on('checking-for-update', () => {
      this.set({ status: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      this.set({ status: 'not-available' })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.set({
        status: 'downloading',
        version: this.state.version,
        percent: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (error) => {
      this.set({ status: 'error', message: error.message })
    })

    setTimeout(() => {
      this.check()
    }, FIRST_CHECK_DELAY_MS)
    this.interval = setInterval(() => {
      this.check()
    }, CHECK_INTERVAL_MS)
  }

  setChannel(channel: UpdateChannel): void {
    if (!this.enabled) return
    autoUpdater.allowPrerelease = channel === 'beta'
    autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest'
    // Setting `channel` turns on downgrades; switching back to stable should not reinstall older builds.
    autoUpdater.allowDowngrade = false
  }

  check(): void {
    if (!this.enabled) {
      this.emit('state', this.state)
      return
    }
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  install(): void {
    if (this.enabled && this.state.status === 'downloaded') autoUpdater.quitAndInstall()
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval)
  }
}
