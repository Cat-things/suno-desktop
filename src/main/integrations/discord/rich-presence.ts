import type { MediaSnapshot } from '../../../shared/media'
import type { Logger } from '../../logger'
import { DiscordIpcClient } from './client'
import { buildActivity, type DiscordActivity } from './presence'

/** Discord allows about 5 activity updates per 20 seconds. */
const MIN_UPDATE_INTERVAL_MS = 4500
const RECONNECT_MIN_MS = 15_000
const RECONNECT_MAX_MS = 120_000

export interface RichPresenceDeps {
  /** `null` while config/app.config.json still holds the placeholder. */
  readonly clientId: string | null
  readonly log: Logger
  readonly getPageUrl: () => string | undefined
}

/** Signature that ignores millisecond drift in timestamps so seeks, not ticks, trigger updates. */
function signature(activity: DiscordActivity | null): string {
  if (!activity) return 'none'
  const ts = activity.timestamps
  const rounded = ts
    ? { start: Math.round(ts.start / 3000), end: ts.end ? Math.round(ts.end / 3000) : 0 }
    : null
  return JSON.stringify({ ...activity, timestamps: rounded })
}

export class RichPresence {
  private client: DiscordIpcClient | null = null
  private enabled = false
  private snapshot: MediaSnapshot | null = null
  private sentSignature = ''
  private lastSentAt = 0
  private sendTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  /** Bumped on every enable/disable so a slow connect can tell it was superseded. */
  private generation = 0

  constructor(private readonly deps: RichPresenceDeps) {}

  get available(): boolean {
    return this.deps.clientId !== null
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.generation++
    if (!enabled) {
      this.stop()
      return
    }
    if (!this.deps.clientId) {
      this.deps.log.warn('Rich Presence enabled but no Discord client id is configured')
      return
    }
    this.reconnectDelay = RECONNECT_MIN_MS
    void this.connect()
  }

  update(snapshot: MediaSnapshot): void {
    this.snapshot = snapshot
    this.schedule()
  }

  dispose(): void {
    this.enabled = false
    this.stop()
  }

  private async connect(): Promise<void> {
    if (!this.enabled || !this.deps.clientId || this.client?.connected) return
    const generation = this.generation
    const client = new DiscordIpcClient(this.deps.clientId, this.deps.log)
    try {
      await client.connect()
    } catch (error) {
      this.deps.log.debug(`Discord unavailable: ${String(error)}`)
      this.retryLater()
      return
    }
    if (generation !== this.generation) {
      client.close()
      return
    }
    this.client = client
    this.reconnectDelay = RECONNECT_MIN_MS
    this.sentSignature = ''
    client.on('disconnected', () => {
      this.client = null
      this.retryLater()
    })
    this.schedule()
  }

  private retryLater(): void {
    if (!this.enabled || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2)
  }

  private schedule(): void {
    if (!this.client || this.sendTimer) return
    const wait = Math.max(0, this.lastSentAt + MIN_UPDATE_INTERVAL_MS - Date.now())
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null
      this.send()
    }, wait)
  }

  private send(): void {
    if (!this.client || !this.snapshot) return
    const activity = buildActivity(this.snapshot, {
      now: Date.now(),
      pageUrl: this.deps.getPageUrl()
    })
    const sig = signature(activity)
    if (sig === this.sentSignature) return
    this.sentSignature = sig
    this.lastSentAt = Date.now()
    this.client.setActivity(activity)
  }

  private stop(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.sendTimer = null
    this.reconnectTimer = null
    this.client?.close()
    this.client = null
    this.sentSignature = ''
  }
}
