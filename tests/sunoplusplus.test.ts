import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SPP_STATE,
  SPP_STOP_SCRIPT,
  applySppAction,
  compareVersions,
  isPluginEnabled,
  sppActionSchema,
  sppAssetUrl,
  sppCatalogSchema,
  sppInjectionScript,
  sppReleaseSchema,
  sppStateSchema,
  type SppPlugin
} from '../src/shared/sunoplusplus'
import { release } from './helpers/sunoplusplus-feed'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('versions and URLs', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.2.0', '1.0.0')).toBeLessThan(0)
  })

  it('builds asset URLs on the Suno++ repo from the version', () => {
    expect(sppAssetUrl('1.2.3', 'sunoplusplus.js')).toBe(
      'https://github.com/Cat-things/sunoplusplus/releases/download/v1.2.3/sunoplusplus.js'
    )
  })
})

describe('desktop.json', () => {
  it('accepts a release and rejects anything off', () => {
    expect(sppReleaseSchema.safeParse(release('0.1.0')).success).toBe(true)
    const bad = [
      { ...release('0.1.0'), formatVersion: 2 },
      { ...release('0.1.0'), version: '1.0' },
      { ...release('0.1.0'), version: '../../evil' },
      {
        ...release('0.1.0'),
        files: { ...release('0.1.0').files, bundle: { name: 'evil.js', size: 1, sha256: sha('x') } }
      },
      {
        ...release('0.1.0'),
        files: {
          ...release('0.1.0').files,
          bundle: { name: 'sunoplusplus.js', size: 5_000_000, sha256: sha('x') }
        }
      }
    ]
    for (const input of bad) expect(sppReleaseSchema.safeParse(input).success).toBe(false)
  })
})

describe('catalog.json', () => {
  const plugin = {
    id: 'now-playing-title',
    name: 'Now playing',
    description: 'Shows the song.',
    version: '1.0.0',
    authors: [{ name: 'Suno++ team', github: 'Cat-things' }],
    license: 'MIT',
    path: 'plugins/now-playing-title',
    settings: [{ key: 'showArtist', type: 'boolean', label: 'Show artist', default: true }]
  }

  it('reads what Suno++ publishes, dropping fields the app does not use', () => {
    const catalog = sppCatalogSchema.parse({
      formatVersion: 1,
      sunoplusplusVersion: '0.1.0',
      plugins: [plugin],
      themes: [
        {
          id: 'neon-accents',
          name: 'Neon accents',
          description: 'Pink.',
          version: '1.0.0',
          authors: [{ name: 'x' }],
          variables: [{ key: 'accent', label: 'Accent', type: 'color', default: '#ff2e97' }]
        }
      ]
    })
    expect(catalog.plugins[0]).not.toHaveProperty('path')
    expect(catalog.plugins[0]?.enabledByDefault).toBe(false)
    expect(catalog.themes[0]?.appearance).toBe('any')
  })

  it('rejects malformed entries', () => {
    const parse = (p: unknown) =>
      sppCatalogSchema.safeParse({
        formatVersion: 1,
        sunoplusplusVersion: '0.1.0',
        plugins: [p],
        themes: []
      }).success
    expect(parse({ ...plugin, id: 'Bad Id' })).toBe(false)
    expect(parse({ ...plugin, name: 'x'.repeat(500) })).toBe(false)
    expect(
      parse({ ...plugin, settings: [{ key: 'x', type: 'script', label: 'x', default: '' }] })
    ).toBe(false)
  })
})

describe('user state and actions', () => {
  it('validates stored state', () => {
    expect(sppStateSchema.safeParse(EMPTY_SPP_STATE).success).toBe(true)
    expect(
      sppStateSchema.safeParse({ ...EMPTY_SPP_STATE, themeVariables: { neon: { accent: 'red' } } })
        .success
    ).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`plugin-${i}`, true]))
    expect(sppStateSchema.safeParse({ ...EMPTY_SPP_STATE, enabled: many }).success).toBe(false)
  })

  it('only accepts well-formed actions', () => {
    expect(
      sppActionSchema.safeParse({ type: 'setPluginEnabled', id: 'abc', enabled: true }).success
    ).toBe(true)
    expect(sppActionSchema.safeParse({ type: 'setTheme', id: null }).success).toBe(true)
    expect(
      sppActionSchema.safeParse({ type: 'setPluginEnabled', id: 'abc', enabled: true, x: 1 })
        .success
    ).toBe(false)
    expect(
      sppActionSchema.safeParse({
        type: 'setThemeVariable',
        id: 'abc',
        key: 'accent',
        value: 'red'
      }).success
    ).toBe(false)
    expect(sppActionSchema.safeParse({ type: 'runScript', js: 'alert(1)' }).success).toBe(false)
  })

  it('applies actions without mutating the old state', () => {
    let state = applySppAction(EMPTY_SPP_STATE, {
      type: 'setPluginEnabled',
      id: 'abc',
      enabled: true
    })
    state = applySppAction(state, {
      type: 'setPluginSetting',
      id: 'abc',
      key: 'showArtist',
      value: false
    })
    state = applySppAction(state, { type: 'setTheme', id: 'neon' })
    state = applySppAction(state, {
      type: 'setThemeVariable',
      id: 'neon',
      key: 'accent',
      value: '#00ff00'
    })
    expect(state).toEqual({
      enabled: { abc: true },
      settings: { abc: { showArtist: false } },
      theme: 'neon',
      themeVariables: { neon: { accent: '#00ff00' } }
    })
    expect(
      applySppAction(state, { type: 'resetThemeVariables', id: 'neon' }).themeVariables
    ).toEqual({})
    expect(EMPTY_SPP_STATE).toEqual({ enabled: {}, settings: {}, theme: null, themeVariables: {} })
  })

  it('falls back to enabledByDefault', () => {
    const plugin = { id: 'abc', enabledByDefault: true } as SppPlugin
    expect(isPluginEnabled(plugin, EMPTY_SPP_STATE)).toBe(true)
    expect(isPluginEnabled(plugin, { ...EMPTY_SPP_STATE, enabled: { abc: false } })).toBe(false)
  })
})

describe('injection', () => {
  it('prefixes the bundle with the user state', () => {
    const state = { ...EMPTY_SPP_STATE, theme: 'neon' }
    const script = sppInjectionScript(state, 'console.log(1)')
    expect(script).toBe(
      'globalThis.__SUNOPLUSPLUS_DESKTOP__ = {"state":{"enabled":{},"settings":{},"theme":"neon","themeVariables":{}}};\nconsole.log(1)'
    )
  })

  it('stops a running Suno++ and clears it', () => {
    const calls: string[] = []
    const key = Symbol.for('sunoplusplus.runtime')
    const scope = globalThis as unknown as Record<symbol, unknown>
    scope[key] = {
      runtime: { stop: () => calls.push('stop') },
      dispose: () => calls.push('dispose')
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const stop = new Function(SPP_STOP_SCRIPT) as () => void
    stop()
    expect(calls).toEqual(['stop', 'dispose'])
    expect(scope[key]).toBeUndefined()
    // Nothing running: no error.
    expect(stop).not.toThrow()
  })
})
