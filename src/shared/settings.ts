import { z } from 'zod'
import { EMPTY_SPP_STATE, sppStateSchema } from './sunoplusplus'

/**
 * Settings schema and migrations. The store in the main process persists the output of
 * `migrateSettings`, so anything read from disk passes through here first.
 */

export const SETTINGS_VERSION = 3

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1

export const updateChannelSchema = z.enum(['stable', 'beta'])
export type UpdateChannel = z.infer<typeof updateChannelSchema>

/** `system` follows the Windows light/dark setting. Maps to `nativeTheme.themeSource`. */
export const themeSourceSchema = z.enum(['system', 'light', 'dark'])
export type ThemeSource = z.infer<typeof themeSourceSchema>

const userSettingsShape = {
  theme: themeSourceSchema,
  launchOnStartup: z.boolean(),
  startMinimized: z.boolean(),
  closeToTray: z.boolean(),
  discordRichPresence: z.boolean(),
  /** Show a save dialog for every download instead of using `downloadFolder`. */
  downloadAskWhereToSave: z.boolean(),
  /** Absolute folder for downloads; `null` means the system Downloads folder. */
  downloadFolder: z.string().min(1).max(1024).nullable(),
  /** Takes effect after a restart. */
  hardwareAcceleration: z.boolean(),
  zoomFactor: z.number().min(ZOOM_MIN).max(ZOOM_MAX),
  updateChannel: updateChannelSchema,
  /** Lets packaged builds open DevTools (dev builds always can). */
  allowDevTools: z.boolean(),
  /** Community plugins and themes from Suno++. Off until the user turns it on (it downloads code). */
  sunoPlusPlusEnabled: z.boolean(),
  /** Keep Suno++ up to date from its GitHub releases. */
  sunoPlusPlusAutoUpdate: z.boolean()
}

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  ...userSettingsShape,
  /** Internal: the "still running in the tray" toast has been shown once. */
  trayHintShown: z.boolean(),
  /** Internal: the first-launch onboarding was finished (reset by "Reset app settings"). */
  onboardingCompleted: z.boolean(),
  /** Internal: which Suno++ plugins are on, their settings, the theme and its colors. */
  sunoPlusPlus: sppStateSchema
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  version: SETTINGS_VERSION,
  theme: 'system',
  launchOnStartup: false,
  startMinimized: false,
  closeToTray: true,
  discordRichPresence: false,
  downloadAskWhereToSave: true,
  downloadFolder: null,
  hardwareAcceleration: true,
  zoomFactor: 1,
  updateChannel: 'stable',
  allowDevTools: false,
  sunoPlusPlusEnabled: false,
  sunoPlusPlusAutoUpdate: true,
  trayHintShown: false,
  onboardingCompleted: false,
  sunoPlusPlus: EMPTY_SPP_STATE
})

/**
 * What the settings window may change over IPC. `downloadFolder` can only be cleared here;
 * picking a folder goes through a native dialog in the main process.
 */
export const settingsPatchSchema = z
  .strictObject({
    ...userSettingsShape,
    downloadFolder: z.null()
  })
  .partial()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export type Migration = (input: Record<string, unknown>) => Record<string, unknown>

/**
 * `MIGRATIONS[n]` upgrades a version `n` object to version `n + 1`.
 * - 0 -> 1: "no version field"; no build ever wrote that shape, so it is read as v1.
 * - 1 -> 2: adds `theme` and onboarding. People upgrading from 0.1.x already set the app up,
 *   so they skip the first-launch onboarding (`theme` falls back to its default, `system`).
 * - 2 -> 3: adds Suno++; the new fields start at their defaults (off).
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (input) => input,
  1: (input) => ({ onboardingCompleted: true, ...input }),
  2: (input) => input
}

export interface MigrationResult {
  readonly settings: Settings
  /** True when the result differs from what was on disk and should be written back. */
  readonly changed: boolean
  readonly warnings: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrateSettings(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion: number = SETTINGS_VERSION
): MigrationResult {
  const warnings: string[] = []
  if (!isRecord(raw)) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      changed: true,
      warnings: ['settings were not an object; using defaults']
    }
  }

  let data: Record<string, unknown> = { ...raw }
  const rawVersion = data['version']
  let version = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : 0

  if (version > currentVersion) {
    warnings.push(`settings come from a newer version (${version}); reading known fields only`)
  }
  while (version < currentVersion) {
    const migrate = migrations[version]
    if (!migrate) {
      warnings.push(`no migration from version ${version}; unknown fields reset to defaults`)
      break
    }
    data = migrate(data)
    version += 1
  }

  // Keep every field that is still valid and fall back to the default for the rest.
  const settings: Record<string, unknown> = { version: SETTINGS_VERSION }
  for (const [key, schema] of Object.entries(settingsSchema.shape)) {
    if (key === 'version') continue
    const parsed = schema.safeParse(data[key])
    if (parsed.success) {
      settings[key] = parsed.data
    } else {
      if (key in data) warnings.push(`invalid value for "${key}"; using default`)
      settings[key] = DEFAULT_SETTINGS[key as keyof Settings]
    }
  }

  const result = settingsSchema.parse(settings)
  const changed = JSON.stringify(result) !== JSON.stringify(raw)
  return { settings: result, changed, warnings }
}

export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  return settingsSchema.parse({ ...current, ...patch })
}

export function clampZoom(factor: number): number {
  const rounded = Math.round(factor * 100) / 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded))
}
