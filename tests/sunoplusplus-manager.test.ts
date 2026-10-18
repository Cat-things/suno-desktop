import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InjectionEntry, OneShotScript } from '../src/main/injection/registry'
import type { Logger } from '../src/main/logger'
import { SunoPlusPlusManager } from '../src/main/sunoplusplus/manager'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings'
import { SPP_FEED_URL, SPP_STOP_SCRIPT, sppAssetUrl } from '../src/shared/sunoplusplus'
import { catalogJson, release } from './helpers/sunoplusplus-feed'

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log
}

/** A fake GitHub: serves whatever files the test puts in it, and records requests. */
function fakeGitHub() {
  const files = new Map<string, string>()
  const requests: string[] = []
  const publish = (
    version: string,
    bundle: string,
    catalog = catalogJson(version),
    extra: object = {}
  ) => {
    files.set(SPP_FEED_URL, JSON.stringify(release(version, bundle, catalog, extra)))
    files.set(sppAssetUrl(version, 'sunoplusplus.js'), bundle)
    files.set(sppAssetUrl(version, 'catalog.json'), catalog)
  }
  const fetch = vi.fn((url: string) => {
    requests.push(url)
    const body = files.get(url)
    return Promise.resolve(
      body === undefined ? new Response('missing', { status: 404 }) : new Response(body)
    )
  })
  return { files, requests, publish, fetch }
}

let dir = ''
let settings: Settings
let registered: InjectionEntry[]
let ran: OneShotScript[]
let unregistered: string[]
let github: ReturnType<typeof fakeGitHub>
let manager: SunoPlusPlusManager

function create(appVersion = '0.1.1'): SunoPlusPlusManager {
  const store = {
    get: () => settings,
    update: (patch: Partial<Settings>) => {
      const previous = settings
      settings = { ...settings, ...patch }
      managerRef.onSettingsChanged(settings, previous)
      return settings
    }
  }
  const managerRef = new SunoPlusPlusManager({
    dir,
    settings: store,
    injection: {
      register: (entry) => {
        registered.push(entry)
        return () => undefined
      },
      unregisterOwner: (owner) => {
        unregistered.push(owner)
        return 1
      },
      runNow: (script) => {
        ran.push(script)
      }
    },
    log,
    appVersion,
    bridgeApi: 1,
    fetch: github.fetch,
    now: () => 1_000
  })
  return managerRef
}

function enable(on = true): void {
  const previous = settings
  settings = { ...settings, sunoPlusPlusEnabled: on }
  manager.onSettingsChanged(settings, previous)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'spp-manager-'))
  settings = { ...DEFAULT_SETTINGS }
  registered = []
  ran = []
  unregistered = []
  github = fakeGitHub()
  manager = create()
})

afterEach(() => {
  manager.dispose()
  rmSync(dir, { recursive: true, force: true })
})

const lastScript = () => registered.at(-1)?.js ?? ''

describe('Suno++ manager', () => {
  it('does nothing while off: no network, no injection', async () => {
    github.publish('0.1.0', 'console.log("v1")')
    await manager.start()
    await manager.check()
    expect(github.requests).toEqual([])
    expect(registered).toEqual([])
    expect(manager.info()).toMatchObject({ enabled: false, status: 'off', installedVersion: null })
  })

  it('downloads, verifies and injects Suno++ when turned on', async () => {
    github.publish('0.1.0', 'console.log("v1")')
    await manager.start()
    enable()
    await manager.check()
    expect(github.requests).toEqual([
      SPP_FEED_URL,
      sppAssetUrl('0.1.0', 'sunoplusplus.js'),
      sppAssetUrl('0.1.0', 'catalog.json')
    ])
    expect(registered.at(-1)).toMatchObject({
      id: 'sunoplusplus.runtime',
      owner: 'sunoplusplus',
      world: 'isolated',
      runOn: ['load'],
      matches: ['https://suno.com/*']
    })
    expect(lastScript()).toMatch(
      /^globalThis\.__SUNOPLUSPLUS_DESKTOP__ = \{"state":.*\};\nconsole\.log\("v1"\)$/
    )
    expect(manager.info()).toMatchObject({
      status: 'idle',
      installedVersion: '0.1.0',
      latestVersion: '0.1.0',
      lastChecked: 1_000
    })
    expect(manager.info().catalog?.plugins.map((p) => p.id)).toEqual(['now-playing-title'])
    expect(readFileSync(path.join(dir, 'current', 'sunoplusplus.js'), 'utf8')).toBe(
      'console.log("v1")'
    )
  })

  it('re-injects with the new choices when the user changes something', async () => {
    github.publish('0.1.0', 'B')
    await manager.start()
    enable()
    await manager.check()
    const info = manager.act({ type: 'setPluginEnabled', id: 'now-playing-title', enabled: true })
    expect(info.state.enabled).toEqual({ 'now-playing-title': true })
    expect(lastScript()).toContain('"enabled":{"now-playing-title":true}')
  })

  it('updates to a newer release and keeps the same one otherwise', async () => {
    github.publish('0.1.0', 'v1')
    await manager.start()
    enable()
    await manager.check()
    github.requests.length = 0
    await manager.check()
    expect(github.requests).toEqual([SPP_FEED_URL])

    github.publish('0.1.1', 'v2')
    await manager.check()
    expect(manager.info().installedVersion).toBe('0.1.1')
    expect(lastScript().endsWith('\nv2')).toBe(true)

    // An older "latest" (e.g. a release was pulled) never downgrades.
    github.publish('0.1.0', 'v1')
    await manager.check()
    expect(manager.info().installedVersion).toBe('0.1.1')
  })

  it('refuses files that do not match desktop.json and keeps the working copy', async () => {
    github.publish('0.1.0', 'good')
    await manager.start()
    enable()
    await manager.check()
    github.publish('0.1.1', 'v2')
    // Same size, different content: caught by the SHA-256 check.
    github.files.set(sppAssetUrl('0.1.1', 'sunoplusplus.js'), 'v3')
    await manager.check()
    expect(manager.info()).toMatchObject({ status: 'error', installedVersion: '0.1.0' })
    expect(manager.info().message).toMatch(/sunoplusplus\.js doesn't match desktop\.json/)
    // Bigger than desktop.json says: refused before it is even read in full.
    github.files.set(sppAssetUrl('0.1.1', 'sunoplusplus.js'), 'tampered and longer')
    await manager.check()
    expect(manager.info().message).toMatch(/sunoplusplus\.js is larger than expected/)
    expect(lastScript().endsWith('\ngood')).toBe(true)
    expect(readFileSync(path.join(dir, 'current', 'sunoplusplus.js'), 'utf8')).toBe('good')
  })

  it('reports network and format problems in plain words', async () => {
    await manager.start()
    github.fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    enable()
    await manager.check()
    expect(manager.info()).toMatchObject({ status: 'error', message: "Couldn't reach GitHub" })
    github.files.set(SPP_FEED_URL, '{"formatVersion": 99}')
    await manager.check()
    expect(manager.info().message).toBe("Suno++'s release files weren't in the expected format")
  })

  it('skips releases that need a newer app', async () => {
    github.publish('0.2.0', 'future', catalogJson('0.2.0'), { minDesktopVersion: '9.0.0' })
    await manager.start()
    enable()
    await manager.check()
    expect(manager.info()).toMatchObject({ installedVersion: null, latestVersion: '0.2.0' })
    expect(manager.info().message).toMatch(/needs a newer Suno Desktop/)
    expect(github.requests).toEqual([SPP_FEED_URL])
  })

  it('loads the installed copy at startup without the network', async () => {
    github.publish('0.1.0', 'installed')
    await manager.start()
    enable()
    await manager.check()
    manager.dispose()

    registered = []
    github.requests.length = 0
    settings = { ...settings, sunoPlusPlusAutoUpdate: false }
    manager = create()
    await manager.start()
    expect(manager.info().installedVersion).toBe('0.1.0')
    expect(lastScript().endsWith('\ninstalled')).toBe(true)
    expect(github.requests).toEqual([])
  })

  it('ignores a damaged copy on disk and downloads a fresh one', async () => {
    github.publish('0.1.0', 'original')
    await manager.start()
    enable()
    await manager.check()
    manager.dispose()
    writeFileSync(path.join(dir, 'current', 'sunoplusplus.js'), 'changed on disk')

    registered = []
    manager = create()
    await manager.start()
    await manager.check()
    expect(manager.info().installedVersion).toBe('0.1.0')
    expect(lastScript().endsWith('\noriginal')).toBe(true)
  })

  it('stops Suno++ on the open page when turned off', async () => {
    github.publish('0.1.0', 'B')
    await manager.start()
    enable()
    await manager.check()
    enable(false)
    expect(unregistered).toEqual(['sunoplusplus'])
    expect(ran).toEqual([
      { id: 'sunoplusplus.stop', owner: 'sunoplusplus', world: 'isolated', js: SPP_STOP_SCRIPT }
    ])
    expect(manager.info().status).toBe('off')
  })

  it('runs one check at a time', async () => {
    github.publish('0.1.0', 'B')
    await manager.start()
    settings = { ...settings, sunoPlusPlusEnabled: true }
    await Promise.all([manager.check(), manager.check(), manager.check()])
    expect(github.requests.filter((u) => u === SPP_FEED_URL)).toHaveLength(1)
  })

  it('tells listeners about every step', async () => {
    github.publish('0.1.0', 'B')
    await manager.start()
    const statuses: string[] = []
    manager.on('info', (info) => statuses.push(info.status))
    enable()
    await manager.check()
    const steps = statuses.filter((status, i) => status !== statuses[i - 1])
    expect(steps).toEqual(['checking', 'downloading', 'idle'])
  })
})
