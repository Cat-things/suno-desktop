import fs from 'node:fs'
import type { ReservedLink } from '../../shared/deep-link'
import type { ThemeSummary } from '../../shared/ipc-channels'
import type { InjectionRegistry } from '../injection/registry'
import type { Logger } from '../logger'

/**
 * Seam for Suno++ themes: community-made looks for suno.com. The theme format (manifest,
 * packaging, what a theme may change) will be defined by the Suno++ project, so this file only
 * fixes the interface the rest of the app talks to. See docs/PLUGIN_HOOKS.md.
 *
 * Themes are separate from the app's own Light / Dark / Auto setting (`settings.theme`), which
 * styles the window chrome and follows Windows.
 */

export type ThemeDeepLink = ReservedLink<'theme'>

/** Injection-registry owner for theme CSS. One theme is active at a time. */
export const THEME_INJECTION_OWNER = 'theme'

export interface ThemeHostContext {
  /** %APPDATA%/Suno Desktop/themes on Windows. */
  readonly themesDir: string
  /** Themes register their CSS here under `THEME_INJECTION_OWNER`. */
  readonly injection: InjectionRegistry
  readonly log: Logger
}

export interface ThemeHost {
  readonly themesDir: string
  /** False until a real implementation ships; the settings Themes tab stays hidden while false. */
  readonly available: boolean
  list(): Promise<readonly ThemeSummary[]>
  /** Applies the theme with this id, replacing the active one. `null` goes back to Suno's look. */
  apply(id: string | null): Promise<void>
  /** Id of the active theme, or null. */
  active(): string | null
  /** Handles `suno-desktop://theme/...` links. */
  handleDeepLink(link: ThemeDeepLink): Promise<void>
}

export class ThemesUnavailableError extends Error {
  constructor() {
    super("Themes aren't available yet")
    this.name = 'ThemesUnavailableError'
  }
}

/** Placeholder host: knows the themes folder, applies nothing. */
export class StubThemeHost implements ThemeHost {
  readonly available = false
  readonly themesDir: string

  constructor(
    private readonly context: ThemeHostContext,
    private readonly notifyUnavailable: () => void
  ) {
    this.themesDir = context.themesDir
    try {
      fs.mkdirSync(this.themesDir, { recursive: true })
    } catch (error) {
      context.log.warn(`cannot create ${this.themesDir}`, error)
    }
  }

  list(): Promise<readonly ThemeSummary[]> {
    return Promise.resolve([])
  }

  apply(id: string | null): Promise<void> {
    if (id === null) {
      this.context.injection.unregisterOwner(THEME_INJECTION_OWNER)
      return Promise.resolve()
    }
    this.context.log.info(`apply("${id}") requested, but themes are not available yet`)
    return Promise.reject(new ThemesUnavailableError())
  }

  active(): string | null {
    return null
  }

  handleDeepLink(link: ThemeDeepLink): Promise<void> {
    this.context.log.info(`theme deep link received: ${link.action}`, link.params)
    this.notifyUnavailable()
    return Promise.resolve()
  }
}
