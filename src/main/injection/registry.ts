import { isSunoAppUrl } from '../../shared/url-policy'

/**
 * Registry for scripts and styles injected into suno.com. Suno++ (src/main/sunoplusplus/) is
 * its user. See docs/PLUGIN_HOOKS.md.
 */

export type InjectionWorld = 'main' | 'isolated'

/** `load`: after each full page load (dom-ready). `route`: after each client-side navigation. */
export type InjectionTrigger = 'load' | 'route'

export interface InjectionEntry {
  /** Unique id, e.g. "suno-plus-plus.style-recs". */
  readonly id: string
  /** Who registered it (plugin id), for listing and bulk removal. */
  readonly owner: string
  /** URL globs where `*` matches anything, e.g. "https://suno.com/create*". */
  readonly matches: readonly string[]
  readonly css?: string
  readonly js?: string
  /** World for `js`. `isolated` runs in a dedicated plugin world, not the preload's. */
  readonly world: InjectionWorld
  /** When `js` runs. CSS is kept in sync with `matches` on both triggers regardless. */
  readonly runOn: readonly InjectionTrigger[]
}

/** A script to run once on the open suno.com page, see `InjectionRegistry.runNow`. */
export interface OneShotScript {
  readonly id: string
  readonly owner: string
  readonly js: string
  readonly world: InjectionWorld
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const MAX_SOURCE = 1024 * 1024

export function matchUrlPattern(pattern: string, rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const target = `${url.origin}${url.pathname}${url.search}`
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  )
  return regex.test(target)
}

/** Patterns must be anchored to a suno.com origin so nothing leaks onto login pages. */
export function isAllowedPattern(pattern: string): boolean {
  const star = pattern.indexOf('*')
  const head = star === -1 ? pattern : pattern.slice(0, star)
  const match = /^https:\/\/([a-z0-9.-]+)\//i.exec(head)
  return match?.[1] !== undefined && isSunoAppUrl(`https://${match[1]}/`)
}

export function validateEntry(entry: InjectionEntry): string | null {
  if (!ID.test(entry.id)) return 'invalid id'
  if (!ID.test(entry.owner)) return 'invalid owner'
  if (entry.css === undefined && entry.js === undefined) return 'entry needs css or js'
  if ((entry.css?.length ?? 0) > MAX_SOURCE || (entry.js?.length ?? 0) > MAX_SOURCE) {
    return 'source too large'
  }
  if (entry.matches.length === 0) return 'entry needs at least one match pattern'
  const bad = entry.matches.find((p) => !isAllowedPattern(p))
  if (bad !== undefined) return `pattern "${bad}" is not anchored to suno.com`
  if (entry.js !== undefined && entry.runOn.length === 0) return 'js entry needs a trigger'
  return null
}

export type RegistryListener = () => void
export type RunListener = (script: OneShotScript) => void

export class InjectionRegistry {
  private readonly entries = new Map<string, InjectionEntry>()
  private readonly listeners = new Set<RegistryListener>()
  private readonly runListeners = new Set<RunListener>()

  /** Adds or replaces an entry. Returns a function that removes it. */
  register(entry: InjectionEntry): () => void {
    const error = validateEntry(entry)
    if (error) throw new Error(`Cannot register injection "${entry.id}": ${error}`)
    this.entries.set(entry.id, Object.freeze({ ...entry, matches: [...entry.matches] }))
    this.emit()
    return () => {
      this.unregister(entry.id)
    }
  }

  unregister(id: string): boolean {
    const removed = this.entries.delete(id)
    if (removed) this.emit()
    return removed
  }

  unregisterOwner(owner: string): number {
    let count = 0
    for (const [id, entry] of this.entries) {
      if (entry.owner === owner) {
        this.entries.delete(id)
        count++
      }
    }
    if (count > 0) this.emit()
    return count
  }

  list(): readonly InjectionEntry[] {
    return [...this.entries.values()]
  }

  /** Entries whose patterns match `url`. */
  matching(url: string): readonly InjectionEntry[] {
    return this.list().filter((e) => e.matches.some((p) => matchUrlPattern(p, url)))
  }

  /** Scripts to run for `url` on `trigger`. */
  scriptsFor(url: string, trigger: InjectionTrigger): readonly InjectionEntry[] {
    return this.matching(url).filter((e) => e.js !== undefined && e.runOn.includes(trigger))
  }

  onChange(listener: RegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Runs `script` once on the suno.com page that is open right now (nothing happens on other
   * pages, and nothing is remembered for later loads). For undoing what a registered script did,
   * e.g. stopping a plugin runtime when the user turns it off.
   */
  runNow(script: OneShotScript): void {
    if (!ID.test(script.id) || !ID.test(script.owner)) throw new Error('invalid one-shot script id')
    if (script.js.length > MAX_SOURCE) throw new Error('one-shot script too large')
    for (const listener of this.runListeners) listener(script)
  }

  onRun(listener: RunListener): () => void {
    this.runListeners.add(listener)
    return () => this.runListeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
