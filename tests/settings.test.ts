import { describe, expect, it } from 'vitest'
import {
  applySettingsPatch,
  clampZoom,
  DEFAULT_SETTINGS,
  migrateSettings,
  SETTINGS_VERSION,
  settingsPatchSchema,
  type Migration
} from '../src/shared/settings'

describe('migrateSettings', () => {
  it('returns defaults for missing or corrupt files', () => {
    for (const raw of [undefined, null, 'oops', 42, []]) {
      const result = migrateSettings(raw)
      expect(result.settings).toEqual(DEFAULT_SETTINGS)
      expect(result.changed).toBe(true)
    }
  })

  it('keeps a valid current file unchanged', () => {
    const stored = { ...DEFAULT_SETTINGS, closeToTray: false, zoomFactor: 1.25 }
    const result = migrateSettings(JSON.parse(JSON.stringify(stored)))
    expect(result.settings).toEqual(stored)
    expect(result.changed).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('replaces invalid fields with defaults and keeps the rest', () => {
    const result = migrateSettings({
      ...DEFAULT_SETTINGS,
      zoomFactor: 99,
      updateChannel: 'nightly',
      closeToTray: false
    })
    expect(result.settings.zoomFactor).toBe(DEFAULT_SETTINGS.zoomFactor)
    expect(result.settings.updateChannel).toBe('stable')
    expect(result.settings.closeToTray).toBe(false)
    expect(result.changed).toBe(true)
    expect(result.warnings).toHaveLength(2)
  })

  it('drops unknown keys', () => {
    const result = migrateSettings({ ...DEFAULT_SETTINGS, evil: '__proto__' })
    expect(result.settings).not.toHaveProperty('evil')
    expect(result.changed).toBe(true)
  })

  it('treats a file without a version as version 0 and migrates it', () => {
    const { version: _version, ...unversioned } = DEFAULT_SETTINGS
    const result = migrateSettings({ ...unversioned, startMinimized: true })
    expect(result.settings.version).toBe(SETTINGS_VERSION)
    expect(result.settings.startMinimized).toBe(true)
  })

  it('runs migrations in order', () => {
    const calls: number[] = []
    const migrations: Record<number, Migration> = {
      1: (d) => {
        calls.push(1)
        return { ...d, closeToTray: d['minimizeToTray'] }
      },
      2: (d) => {
        calls.push(2)
        return { ...d, zoomFactor: Number(d['zoomPercent']) / 100 }
      }
    }
    const result = migrateSettings(
      { version: 1, minimizeToTray: false, zoomPercent: 150 },
      migrations,
      3
    )
    expect(calls).toEqual([1, 2])
    expect(result.settings.closeToTray).toBe(false)
    expect(result.settings.zoomFactor).toBe(1.5)
  })

  it('stops and falls back to defaults when a migration is missing', () => {
    const result = migrateSettings({ version: 0, closeToTray: false }, {}, 2)
    expect(result.warnings[0]).toMatch(/no migration from version 0/)
    expect(result.settings.version).toBe(SETTINGS_VERSION)
  })

  it('reads files written by a newer version best-effort', () => {
    const result = migrateSettings({ ...DEFAULT_SETTINGS, version: 99, futureThing: true })
    expect(result.settings.version).toBe(SETTINGS_VERSION)
    expect(result.warnings[0]).toMatch(/newer version/)
  })
})

describe('settings patches', () => {
  it('accepts user-editable fields', () => {
    const patch = settingsPatchSchema.parse({ closeToTray: false, updateChannel: 'beta' })
    expect(applySettingsPatch(DEFAULT_SETTINGS, patch)).toMatchObject({
      closeToTray: false,
      updateChannel: 'beta'
    })
  })

  it('rejects internal fields, unknown fields and arbitrary folders', () => {
    expect(settingsPatchSchema.safeParse({ version: 2 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ trayHintShown: true }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ nope: 1 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ downloadFolder: 'C:\\Windows' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ downloadFolder: null }).success).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(settingsPatchSchema.safeParse({ zoomFactor: 0.1 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ zoomFactor: '1' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ updateChannel: 'canary' }).success).toBe(false)
  })

  it('clamps zoom', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(5)).toBe(3)
    expect(clampZoom(1.1000000001)).toBe(1.1)
  })
})
