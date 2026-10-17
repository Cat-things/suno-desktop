import type { WebContents } from 'electron'
import { PLUGIN_WORLD_ID } from '../../shared/constants'
import { isSunoAppUrl } from '../../shared/url-policy'
import type { Logger } from '../logger'
import type { InjectionEntry, InjectionRegistry, InjectionTrigger } from './registry'

interface InsertedCss {
  readonly key: string
  readonly css: string
}

function wrapScript(entry: InjectionEntry): string {
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
  private ran = new Set<string>()
  private disposeRegistry: (() => void) | null = null

  constructor(
    private readonly contents: WebContents,
    private readonly registry: InjectionRegistry,
    private readonly log: Logger
  ) {}

  attach(): void {
    this.contents.on('dom-ready', () => {
      // New document: previously inserted CSS and executed scripts are gone.
      this.css = new Map()
      this.ran = new Set()
      void this.sync('load')
    })
    this.contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) void this.sync('route')
    })
    this.disposeRegistry = this.registry.onChange(() => {
      void this.sync(null)
    })
    this.contents.once('destroyed', () => {
      this.disposeRegistry?.()
    })
  }

  /** `trigger` is null when the registry changed: sync CSS and run newly added `load` scripts. */
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
        ? this.registry.scriptsFor(url, 'load').filter((e) => !this.ran.has(e.id))
        : this.registry.scriptsFor(url, trigger)
    for (const entry of scripts) await this.run(entry)
  }

  private async run(entry: InjectionEntry): Promise<void> {
    this.ran.add(entry.id)
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
