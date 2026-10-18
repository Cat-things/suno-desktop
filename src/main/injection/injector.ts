import type { WebContents } from 'electron'
import { PLUGIN_WORLD_ID } from '../../shared/constants'
import { isSunoAppUrl } from '../../shared/url-policy'
import type { Logger } from '../logger'
import type { InjectionEntry, InjectionRegistry, InjectionTrigger, OneShotScript } from './registry'

interface InsertedCss {
  readonly key: string
  readonly css: string
}

function wrapScript(entry: Pick<InjectionEntry, 'id' | 'js'>): string {
  // Each script is isolated in its own try/catch so one broken plugin cannot break the others.
  return `(() => {\ntry {\n${entry.js ?? ''}\n} catch (error) {\nconsole.error('[suno-desktop] injection ' + ${JSON.stringify(entry.id)} + ' failed', error)\n}\n})()`
}

/**
 * Applies registry entries to the suno.com view: CSS follows the current URL on every load and
 * client-side route change; scripts run on the triggers they asked for. Scripts never run on
 * non-suno.com pages (for example while a login provider is shown).
 */
export class Injector {
  private css = new Map<string, InsertedCss>()
  /** Entry id → the code that ran for it on this document, so changed code runs again. */
  private ran = new Map<string, string>()
  private disposeRegistry: (() => void) | null = null
  private disposeRun: (() => void) | null = null

  constructor(
    private readonly contents: WebContents,
    private readonly registry: InjectionRegistry,
    private readonly log: Logger
  ) {}

  attach(): void {
    this.contents.on('dom-ready', () => {
      // New document: previously inserted CSS and executed scripts are gone.
      this.css = new Map()
      this.ran = new Map()
      void this.sync('load')
    })
    this.contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) void this.sync('route')
    })
    this.disposeRegistry = this.registry.onChange(() => {
      void this.sync(null)
    })
    this.disposeRun = this.registry.onRun((script) => {
      if (!this.contents.isDestroyed() && isSunoAppUrl(this.contents.getURL()))
        void this.run(script)
    })
    this.contents.once('destroyed', () => {
      this.disposeRegistry?.()
      this.disposeRun?.()
    })
  }

  /**
   * `trigger` is null when the registry changed: sync CSS and run `load` scripts that are new or
   * whose code changed since they last ran on this document.
   */
  private async sync(trigger: InjectionTrigger | null): Promise<void> {
    if (this.contents.isDestroyed()) return
    const url = this.contents.getURL()
    const matching = isSunoAppUrl(url) ? this.registry.matching(url) : []

    for (const [id, inserted] of this.css) {
      const entry = matching.find((e) => e.id === id)
      if (entry?.css !== inserted.css) {
        this.css.delete(id)
        await this.contents.removeInsertedCSS(inserted.key).catch(() => undefined)
      }
    }
    for (const entry of matching) {
      if (entry.css === undefined || this.css.has(entry.id)) continue
      try {
        const key = await this.contents.insertCSS(entry.css, { cssOrigin: 'author' })
        this.css.set(entry.id, { key, css: entry.css })
      } catch (error) {
        this.log.warn(`insertCSS failed for ${entry.id}`, error)
      }
    }

    if (!isSunoAppUrl(url)) return
    const scripts =
      trigger === null
        ? this.registry.scriptsFor(url, 'load').filter((e) => this.ran.get(e.id) !== e.js)
        : this.registry.scriptsFor(url, trigger)
    for (const entry of scripts) await this.run(entry)
  }

  private async run(entry: InjectionEntry | OneShotScript): Promise<void> {
    if ('runOn' in entry) this.ran.set(entry.id, entry.js ?? '')
    const code = wrapScript(entry)
    try {
      if (entry.world === 'main') {
        await this.contents.executeJavaScript(code)
      } else {
        await this.contents.executeJavaScriptInIsolatedWorld(PLUGIN_WORLD_ID, [
          { code, url: `suno-desktop-plugin://${entry.owner}/${entry.id}.js` }
        ])
      }
    } catch (error) {
      this.log.warn(`script ${entry.id} failed`, error)
    }
  }
}
