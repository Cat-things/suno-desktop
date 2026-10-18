import { z } from 'zod'
import { SPP_REPO_URL } from './constants'

/**
 * Suno++ (https://github.com/Cat-things/sunoplusplus): community plugins and themes for
 * suno.com. The app downloads its desktop bundle from Suno++'s GitHub releases and keeps it up
 * to date (src/main/sunoplusplus/). This file holds what main, the settings window and tests
 * share: the release and catalog formats, the user's choices, and the changes the settings window
 * may ask for. Everything from the network is parsed with these schemas before it is used.
 */

export { SPP_REPO_URL }
export const SPP_FEED_URL = `${SPP_REPO_URL}/releases/latest/download/desktop.json`

/** URL of a release asset. Built from a validated version and a fixed file name, never from the feed. */
export function sppAssetUrl(version: string, file: string): string {
  return `${SPP_REPO_URL}/releases/download/v${version}/${file}`
}

/** desktop.json formats this app understands. */
export const SPP_FORMAT_VERSION = 1

export const SPP_LIMITS = {
  feed: 16 * 1024,
  /** The bundle is injected through the injection pipeline, which caps scripts at 1 MB. */
  bundle: 900 * 1024,
  catalog: 512 * 1024
} as const

/** Injection-registry owner and entry id for the bundle. */
export const SPP_OWNER = 'sunoplusplus'
export const SPP_ENTRY_ID = 'sunoplusplus.runtime'

const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SETTING_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/
const VARIABLE_KEY = /^[a-z][a-z0-9-]{0,39}$/
const HEX_COLOR = /^#[0-9a-f]{6}$/i

const semver = z.string().regex(SEMVER)
const id = z.string().min(3).max(48).regex(ID)
const text = (max: number) => z.string().min(1).max(max)

/** Compares x.y.z versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// --- desktop.json -----------------------------------------------------------------------------

const file = (name: string, max: number) =>
  z.object({
    name: z.literal(name),
    size: z.number().int().positive().max(max),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })

export const sppReleaseSchema = z.object({
  formatVersion: z.literal(SPP_FORMAT_VERSION),
  version: semver,
  bridgeApi: z.number().int().min(1),
  minDesktopVersion: semver,
  files: z.object({
    bundle: file('sunoplusplus.js', SPP_LIMITS.bundle),
    catalog: file('catalog.json', SPP_LIMITS.catalog)
  })
})

export type SppRelease = z.infer<typeof sppReleaseSchema>

// --- catalog.json -----------------------------------------------------------------------------

const settingBase = {
  key: z.string().regex(SETTING_KEY),
  label: text(60),
  description: text(200).optional()
}

const settingSchema = z.discriminatedUnion('type', [
  z.object({ ...settingBase, type: z.literal('boolean'), default: z.boolean() }),
  z.object({
    ...settingBase,
    type: z.literal('string'),
    default: z.string().max(1000),
    maxLength: z.number().int().min(1).max(1000).default(200),
    placeholder: z.string().max(100).optional()
  }),
  z.object({
    ...settingBase,
    type: z.literal('number'),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional()
  }),
  z.object({
    ...settingBase,
    type: z.literal('select'),
    default: z.string().max(60),
    options: z
      .array(z.object({ value: z.string().min(1).max(60), label: text(60) }))
      .min(1)
      .max(30)
  })
])

export type SppSetting = z.infer<typeof settingSchema>

const authorSchema = z.object({ name: text(80) })

const common = {
  id,
  name: text(60),
  description: text(240),
  version: semver,
  authors: z.array(authorSchema).min(1).max(10)
}

export const sppPluginSchema = z.object({
  ...common,
  enabledByDefault: z.boolean().default(false),
  settings: z.array(settingSchema).max(30).default([])
})

export const sppThemeSchema = z.object({
  ...common,
  appearance: z.enum(['dark', 'light', 'any']).default('any'),
  variables: z
    .array(
      z.object({
        key: z.string().regex(VARIABLE_KEY),
        label: text(60),
        type: z.literal('color'),
        default: z.string().regex(HEX_COLOR)
      })
    )
    .max(20)
    .default([])
})

export const sppCatalogSchema = z.object({
  formatVersion: z.literal(1),
  sunoplusplusVersion: semver,
  plugins: z.array(sppPluginSchema).max(500),
  themes: z.array(sppThemeSchema).max(500)
})

export type SppPlugin = z.infer<typeof sppPluginSchema>
export type SppTheme = z.infer<typeof sppThemeSchema>
export type SppCatalog = z.infer<typeof sppCatalogSchema>

// --- the user's choices ------------------------------------------------------------------------

const settingValue = z.union([z.boolean(), z.string().max(1000), z.number()])
const capped = <T extends z.ZodType>(schema: T, max: number) =>
  schema.refine((value) => Object.keys(value as object).length <= max, 'too many entries')

/** Same shape as Suno++'s `UserState`; passed to the bundle as-is (it validates it too). */
export const sppStateSchema = z.object({
  enabled: capped(z.record(id, z.boolean()), 500),
  settings: capped(
    z.record(id, capped(z.record(z.string().regex(SETTING_KEY), settingValue), 30)),
    500
  ),
  theme: id.nullable(),
  themeVariables: capped(
    z.record(id, capped(z.record(z.string().regex(VARIABLE_KEY), z.string().regex(HEX_COLOR)), 20)),
    500
  )
})

export type SppState = z.infer<typeof sppStateSchema>

export const EMPTY_SPP_STATE: SppState = Object.freeze({
  enabled: {},
  settings: {},
  theme: null,
  themeVariables: {}
})

// --- changes from the settings window -----------------------------------------------------------

export const sppActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('setPluginEnabled'), id, enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('setPluginSetting'),
    id,
    key: z.string().regex(SETTING_KEY),
    value: settingValue
  }),
  z.strictObject({ type: z.literal('setTheme'), id: id.nullable() }),
  z.strictObject({
    type: z.literal('setThemeVariable'),
    id,
    key: z.string().regex(VARIABLE_KEY),
    value: z.string().regex(HEX_COLOR)
  }),
  z.strictObject({ type: z.literal('resetThemeVariables'), id })
])

export type SppAction = z.infer<typeof sppActionSchema>

export function applySppAction(state: SppState, action: SppAction): SppState {
  switch (action.type) {
    case 'setPluginEnabled':
      return { ...state, enabled: { ...state.enabled, [action.id]: action.enabled } }
    case 'setPluginSetting':
      return {
        ...state,
        settings: {
          ...state.settings,
          [action.id]: { ...state.settings[action.id], [action.key]: action.value }
        }
      }
    case 'setTheme':
      return { ...state, theme: action.id }
    case 'setThemeVariable':
      return {
        ...state,
        themeVariables: {
          ...state.themeVariables,
          [action.id]: { ...state.themeVariables[action.id], [action.key]: action.value }
        }
      }
    case 'resetThemeVariables': {
      const { [action.id]: _removed, ...rest } = state.themeVariables
      return { ...state, themeVariables: rest }
    }
  }
}

export function isPluginEnabled(plugin: SppPlugin, state: SppState): boolean {
  return state.enabled[plugin.id] ?? plugin.enabledByDefault
}

/** The script registered with the injection pipeline: the user's choices, then the bundle. */
export function sppInjectionScript(state: SppState, bundle: string): string {
  return `globalThis.__SUNOPLUSPLUS_DESKTOP__ = ${JSON.stringify({ state })};\n${bundle}`
}

/** Stops a running Suno++ on the open page (what the bundle leaves under this symbol). */
export const SPP_STOP_SCRIPT = `(() => {
  const key = Symbol.for('sunoplusplus.runtime')
  const installed = globalThis[key]
  if (!installed) return
  globalThis[key] = undefined
  installed.runtime?.stop?.()
  installed.dispose?.()
})()`

// --- status for the settings window -------------------------------------------------------------

export type SppStatus = 'off' | 'idle' | 'checking' | 'downloading' | 'error'

export interface SppInfo {
  readonly enabled: boolean
  readonly autoUpdate: boolean
  readonly status: SppStatus
  /** Version on disk and in use, or null before the first download. */
  readonly installedVersion: string | null
  /** Newest version seen in the feed at the last check. */
  readonly latestVersion: string | null
  /** Epoch ms of the last successful check. */
  readonly lastChecked: number | null
  /** Error, or why the newest release can't be used. */
  readonly message: string | null
  readonly catalog: SppCatalog | null
  readonly state: SppState
}
