import fs from 'node:fs'
import type { Session } from 'electron'
import type { ReservedLink } from '../../shared/deep-link'
import type { PluginSummary } from '../../shared/ipc-channels'
import type { InjectionRegistry } from '../injection/registry'
import type { Logger } from '../logger'

/**
 * Seam for Suno++. The plugin format (manifest, packaging, permissions) will be defined by the
 * Suno++ project, so this file only fixes the interface the rest of the app talks to.
 * See docs/PLUGIN_HOOKS.md.
 */

export type PluginDeepLink = ReservedLink<'plugin'>

/** What a host implementation gets from the app. */
export interface PluginHostContext {
  /** %APPDATA%/Suno Desktop/plugins on Windows. */
  readonly pluginsDir: string
  /** Register scripts/styles for suno.com; see src/main/injection/registry.ts. */
  readonly injection: InjectionRegistry
  /** The persistent suno.com session (e.g. for `session.extensions.loadExtension`). */
  readonly session: Session
  readonly log: Logger
}

export interface PluginHost {
  readonly pluginsDir: string
  /** False until a real implementation ships; the settings Plugins tab stays hidden while false. */
  readonly available: boolean
  list(): Promise<readonly PluginSummary[]>
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  /** Handles `suno-desktop://plugin/...` links. */
  handleDeepLink(link: PluginDeepLink): Promise<void>
}

export class PluginsUnavailableError extends Error {
  constructor() {
    super("Plugins aren't available yet")
    this.name = 'PluginsUnavailableError'
  }
}

/** Placeholder host: knows the plugins folder, loads nothing. */
export class StubPluginHost implements PluginHost {
  readonly available = false
  readonly pluginsDir: string

  constructor(
    private readonly context: PluginHostContext,
    private readonly notifyUnavailable: () => void
  ) {
    this.pluginsDir = context.pluginsDir
    try {
      fs.mkdirSync(this.pluginsDir, { recursive: true })
    } catch (error) {
      context.log.warn(`cannot create ${this.pluginsDir}`, error)
    }
  }

  list(): Promise<readonly PluginSummary[]> {
    return Promise.resolve([])
  }

  load(id: string): Promise<void> {
    this.context.log.info(`load("${id}") requested, but plugins are not available yet`)
    return Promise.reject(new PluginsUnavailableError())
  }

  unload(id: string): Promise<void> {
    // Nothing is ever loaded; still clear anything registered under this owner.
    this.context.injection.unregisterOwner(id)
    return Promise.resolve()
  }

  handleDeepLink(link: PluginDeepLink): Promise<void> {
    this.context.log.info(`plugin deep link received: ${link.action}`, link.params)
    this.notifyUnavailable()
    return Promise.resolve()
  }
}
