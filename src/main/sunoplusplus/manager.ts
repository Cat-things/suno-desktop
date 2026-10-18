import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '../../shared/settings'
import {
  SPP_ENTRY_ID,
  SPP_FEED_URL,
  SPP_LIMITS,
  SPP_OWNER,
  SPP_STOP_SCRIPT,
  applySppAction,
  compareVersions,
  sppAssetUrl,
  sppCatalogSchema,
  sppInjectionScript,
  sppReleaseSchema,
  type SppAction,
  type SppCatalog,
  type SppInfo,
  type SppRelease,
  type SppStatus
} from '../../shared/sunoplusplus'
import type { InjectionRegistry } from '../injection/registry'
import type { Logger } from '../logger'

/**
 * Suno++ in the app: downloads the desktop bundle from Suno++'s GitHub releases, checks it
 * against the release's desktop.json (size and SHA-256), keeps it in the user data folder and
 * registers it with the injection pipeline together with the user's choices. New Suno++ releases
 * are picked up while the app runs and replace the running version on the page without a reload.
 *
 * Off until the user turns it on, because it downloads code. No Electron imports, so it can be
 * tested with a fake network.
 */

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export interface SunoPlusPlusOptions {
  /** Where the installed copy lives (`<userData>/sunoplusplus`). */
  readonly dir: string
  readonly settings: {
    get(): Settings
    update(patch: Partial<Settings>): Settings
  }
  readonly injection: Pick<InjectionRegistry, 'register' | 'unregisterOwner' | 'runNow'>
  readonly log: Logger
  readonly appVersion: string
  /** `window.sunoDesktop` bridge API this app provides. */
  readonly bridgeApi: number
  readonly fetch: FetchLike
  readonly feedUrl?: string
  readonly assetUrl?: (version: string, file: string) => string
  readonly now?: () => number
  readonly checkIntervalMs?: number
  readonly firstCheckDelayMs?: number
}

interface Installed {
  readonly release: SppRelease
  readonly bundle: string
  readonly catalog: SppCatalog
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

function verify(data: Buffer, expected: { name: string; size: number; sha256: string }): void {
  if (data.length !== expected.size || sha256(data) !== expected.sha256) {
    throw new Error(`${expected.name} doesn't match desktop.json; not using it`)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return 'GitHub took too long to answer'
    if (error.name === 'ZodError' || error instanceof SyntaxError) {
      return "Suno++'s release files weren't in the expected format"
    }
    if (error instanceof TypeError) return "Couldn't reach GitHub"
    return error.message
  }
  return String(error)
}

export class SunoPlusPlusManager extends EventEmitter<{ info: [SppInfo] }> {
  private installed: Installed | null = null
  private status: SppStatus = 'idle'
  private latestVersion: string | null = null
  private lastChecked: number | null = null
  private message: string | null = null
  private checking: Promise<void> | null = null
  private injected = false
  private timers: NodeJS.Timeout[] = []
  private readonly feedUrl: string
  private readonly assetUrl: (version: string, file: string) => string
  private readonly now: () => number

  constructor(private readonly options: SunoPlusPlusOptions) {
    super()
    this.feedUrl = options.feedUrl ?? SPP_FEED_URL
    this.assetUrl = options.assetUrl ?? sppAssetUrl
    this.now = options.now ?? Date.now
  }

  /** Loads the installed copy (if any), injects it when Suno++ is on and schedules checks. */
  async start(): Promise<void> {
    this.installed = await this.loadInstalled()
    this.apply()
    this.schedule()
    this.emitInfo()
  }

  dispose(): void {
    this.clearTimers()
  }

  info(): SppInfo {
    const settings = this.options.settings.get()
    return {
      enabled: settings.sunoPlusPlusEnabled,
      autoUpdate: settings.sunoPlusPlusAutoUpdate,
      status: settings.sunoPlusPlusEnabled ? this.status : 'off',
      installedVersion: this.installed?.release.version ?? null,
      latestVersion: this.latestVersion,
      lastChecked: this.lastChecked,
      message: this.message,
      catalog: this.installed?.catalog ?? null,
      state: settings.sunoPlusPlus
    }
  }

  catalog(): SppCatalog | null {
    return this.installed?.catalog ?? null
  }

  /** Call on every settings change. */
  onSettingsChanged(next: Settings, previous: Settings): void {
    const toggled = next.sunoPlusPlusEnabled !== previous.sunoPlusPlusEnabled
    const stateChanged = JSON.stringify(next.sunoPlusPlus) !== JSON.stringify(previous.sunoPlusPlus)
    const autoChanged = next.sunoPlusPlusAutoUpdate !== previous.sunoPlusPlusAutoUpdate
    if (toggled || stateChanged) this.apply()
    if (toggled || autoChanged) this.schedule()
    if (toggled || stateChanged || autoChanged) this.emitInfo()
  }

  /** Applies a change from the settings window to the user's choices. */
  act(action: SppAction): SppInfo {
    const settings = this.options.settings.get()
    this.options.settings.update({ sunoPlusPlus: applySppAction(settings.sunoPlusPlus, action) })
    return this.info()
  }

  /**
   * Checks the feed and installs a newer compatible release. Runs one check at a time; calling
   * it during a check returns the running one. Does nothing while Suno++ is off.
   */
  check(): Promise<void> {
    if (!this.options.settings.get().sunoPlusPlusEnabled) return Promise.resolve()
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(): Promise<void> {
    const { log } = this.options
    this.status = 'checking'
    this.message = null
    this.emitInfo()
    try {
      const feed = await this.download(this.feedUrl, SPP_LIMITS.feed)
      const release = sppReleaseSchema.parse(JSON.parse(feed.toString('utf8')))
      this.lastChecked = this.now()
      this.latestVersion = release.version
      const current = this.installed?.release.version
      if (current !== undefined && compareVersions(release.version, current) <= 0) {
        this.status = 'idle'
        return
      }
      if (
        release.bridgeApi > this.options.bridgeApi ||
        compareVersions(release.minDesktopVersion, this.options.appVersion) > 0
      ) {
        this.message = `Suno++ ${release.version} needs a newer Suno Desktop. Update the app to get it.`
        this.status = 'idle'
        log.info(`Suno++ ${release.version} needs Suno Desktop ${release.minDesktopVersion}+`)
        return
      }

      this.status = 'downloading'
      this.emitInfo()
      const { bundle, catalog } = release.files
      const bundleBytes = await this.download(
        this.assetUrl(release.version, bundle.name),
        bundle.size
      )
      verify(bundleBytes, bundle)
      const catalogBytes = await this.download(
        this.assetUrl(release.version, catalog.name),
        catalog.size
      )
      verify(catalogBytes, catalog)
      const parsedCatalog = sppCatalogSchema.parse(JSON.parse(catalogBytes.toString('utf8')))

      await this.writeInstalled(release, bundleBytes, catalogBytes)
      this.installed = { release, bundle: bundleBytes.toString('utf8'), catalog: parsedCatalog }
      log.info(`installed Suno++ ${release.version}${current ? ` (was ${current})` : ''}`)
      this.apply()
      this.status = 'idle'
    } catch (error) {
      this.status = 'error'
      this.message = describe(error)
      log.warn('Suno++ update check failed', error)
    } finally {
      this.emitInfo()
    }
  }

  private async download(url: string, maxBytes: number): Promise<Buffer> {
    const response = await this.options.fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok)
      throw new Error(`GitHub answered ${response.status} for ${path.basename(url)}`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > maxBytes) throw new Error(`${path.basename(url)} is larger than expected`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > maxBytes) throw new Error(`${path.basename(url)} is larger than expected`)
    return data
  }

  /** Registers the bundle with the user's choices, or stops it on the open page when off. */
  private apply(): void {
    const settings = this.options.settings.get()
    const { injection } = this.options
    if (settings.sunoPlusPlusEnabled && this.installed) {
      injection.register({
        id: SPP_ENTRY_ID,
        owner: SPP_OWNER,
        matches: ['https://suno.com/*'],
        world: 'isolated',
        runOn: ['load'],
        js: sppInjectionScript(settings.sunoPlusPlus, this.installed.bundle)
      })
      this.injected = true
    } else if (this.injected) {
      injection.unregisterOwner(SPP_OWNER)
      injection.runNow({
        id: 'sunoplusplus.stop',
        owner: SPP_OWNER,
        world: 'isolated',
        js: SPP_STOP_SCRIPT
      })
      this.injected = false
    }
  }

  private schedule(): void {
    this.clearTimers()
    const settings = this.options.settings.get()
    if (!settings.sunoPlusPlusEnabled) return
    // Turning Suno++ on is consent to download it, whatever the auto-update setting says.
    if (!this.installed) void this.check()
    if (!settings.sunoPlusPlusAutoUpdate) return
    const every = this.options.checkIntervalMs ?? 6 * 60 * 60 * 1000
    if (this.installed) {
      this.timers.push(
        setTimeout(() => void this.check(), this.options.firstCheckDelayMs ?? 15_000)
      )
    }
    this.timers.push(setInterval(() => void this.check(), every))
    for (const timer of this.timers) timer.unref()
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  private emitInfo(): void {
    this.emit('info', this.info())
  }

  // --- disk -------------------------------------------------------------------------------------

  private async loadInstalled(): Promise<Installed | null> {
    // `previous` only exists if the app stopped in the middle of swapping in an update.
    for (const folder of ['current', 'previous']) {
      const dir = path.join(this.options.dir, folder)
      try {
        const release = sppReleaseSchema.parse(
          JSON.parse(await readFile(path.join(dir, 'desktop.json'), 'utf8'))
        )
        const bundle = await readFile(path.join(dir, release.files.bundle.name))
        verify(bundle, release.files.bundle)
        const catalogBytes = await readFile(path.join(dir, release.files.catalog.name))
        verify(catalogBytes, release.files.catalog)
        const catalog = sppCatalogSchema.parse(JSON.parse(catalogBytes.toString('utf8')))
        return { release, bundle: bundle.toString('utf8'), catalog }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.options.log.warn(`ignoring the Suno++ copy in ${folder}`, error)
        }
      }
    }
    return null
  }

  private async writeInstalled(
    release: SppRelease,
    bundle: Buffer,
    catalog: Buffer
  ): Promise<void> {
    const { dir } = this.options
    const staging = path.join(dir, `staging-${String(this.now())}`)
    const current = path.join(dir, 'current')
    const previous = path.join(dir, 'previous')
    await mkdir(staging, { recursive: true })
    await writeFile(path.join(staging, release.files.bundle.name), bundle)
    await writeFile(path.join(staging, release.files.catalog.name), catalog)
    await writeFile(path.join(staging, 'desktop.json'), `${JSON.stringify(release, null, 2)}\n`)
    await rm(previous, { recursive: true, force: true })
    await rename(current, previous).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await rename(staging, current)
    await rm(previous, { recursive: true, force: true })
  }
}
