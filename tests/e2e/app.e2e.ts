/**
 * End-to-end checks against the built app (run `pnpm build` first). suno.com, its CDN and a
 * Google sign-in page are faked by intercepting https inside the app's own session, so the
 * suite is deterministic and never talks to Suno. Screenshots land in test-results/e2e.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { InjectionRegistry } from '../../src/main/injection/registry'
import type { MediaController } from '../../src/main/media/media-controller'
import type { SettingsStore } from '../../src/main/settings-store'
import type { SunoPlusPlusManager } from '../../src/main/sunoplusplus/manager'
import type { MainWindow } from '../../src/main/windows/main-window'
import { COVER_ID, FAKE_SUNO_HTML, silentWav } from './fake-suno'

interface Hooks {
  settings: SettingsStore
  injection: InjectionRegistry
  sunoPlusPlus: SunoPlusPlusManager
  media: MediaController
  mainWindow: MainWindow
  openDeepLink(url: string): void
  openSettings(): void
}

const root = path.resolve(__dirname, '../..')
const artifacts = path.join(root, 'test-results', 'e2e')
let app: ElectronApplication
let userData = ''

async function waitFor<T>(
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  label: string,
  timeoutMs = 15_000
): Promise<T> {
  const start = Date.now()
  let last: T | undefined
  let error: unknown = null
  while (Date.now() - start < timeoutMs) {
    try {
      last = await probe()
      error = null
      if (ok(last)) return last
    } catch (e) {
      // The target may not exist yet (e.g. a view whose first load has not committed).
      error = e
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  if (error)
    throw error instanceof Error ? error : new Error(`non-error thrown: ${JSON.stringify(error)}`)
  throw new Error(`timed out waiting for ${label}; last value: ${JSON.stringify(last)}`)
}

/** Runs code in the suno.com page (main world). */
function inSuno<T>(code: string): Promise<T> {
  return app.evaluate(async (_electron, js) => {
    const hooks = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
    return (await hooks.mainWindow.contents.executeJavaScript(js)) as T
  }, code)
}

/**
 * Runs code in the first local UI page whose URL ends with `page`. Resolves with undefined when
 * the code ends up closing that page (e.g. finishing the onboarding): executeJavaScript never
 * settles once its webContents is destroyed, so racing the close would hang the test.
 */
function inLocal<T>(page: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, { page: name, js }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith(name))
      if (!wc) throw new Error(`no webContents for ${name}`)
      return new Promise<T>((resolve, reject) => {
        const onDestroyed = (): void => {
          resolve(undefined as T)
        }
        wc.once('destroyed', onDestroyed)
        wc.executeJavaScript(js).then(
          (value: unknown) => {
            wc.off('destroyed', onDestroyed)
            resolve(value as T)
          },
          (error: unknown) => {
            wc.off('destroyed', onDestroyed)
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        )
      })
    },
    { page, js: code }
  )
}

function suno(urlPath: string): Promise<void> {
  return app.evaluate(async (_electron, target) => {
    const hooks = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
    hooks.mainWindow.loadUrl(`https://suno.com${target}`)
    await new Promise<void>((resolve) => {
      hooks.mainWindow.contents.once('did-stop-loading', () => {
        resolve()
      })
    })
  }, urlPath)
}

async function screenshot(name: string, page: string): Promise<void> {
  const png = await app.evaluate(async ({ webContents, BrowserWindow }, target) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith(target) || w.getURL().endsWith(target))
    if (!wc) return null
    // A window behind another one keeps its last frame; bring it forward and let it repaint
    // (and finish its toggle transitions) before capturing.
    const win = BrowserWindow.fromWebContents(wc)
    if (win && !win.isFocused()) win.focus()
    await Promise.race([
      wc.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))'
      ),
      new Promise((r) => setTimeout(r, 2000))
    ])
    return (await wc.capturePage()).toPNG().toString('base64')
  }, page)
  if (png) writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(png, 'base64'))
}

beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true })
  userData = mkdtempSync(path.join(tmpdir(), 'suno-desktop-e2e-'))
  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, SUNO_DESKTOP_E2E: '1', SUNO_DESKTOP_USER_DATA_DIR: userData }
  })
  await app.evaluate(
    ({ session, shell }, assets) => {
      const g = globalThis as unknown as { __external: string[]; __flaky: number }
      g.__external = []
      g.__flaky = 0
      shell.openExternal = (url: string) => {
        g.__external.push(url)
        return Promise.resolve()
      }
      session.fromPartition('persist:suno').protocol.handle('https', (request) => {
        const url = new URL(request.url)
        if (url.hostname === 'cdn1.suno.ai') {
          return new Response(Buffer.from(assets.wav, 'base64'), {
            headers: { 'content-type': 'audio/wav' }
          })
        }
        if (url.pathname === '/flaky' && ++g.__flaky === 1) return Response.error()
        if (url.hostname === 'suno.com' || url.hostname === 'accounts.google.com') {
          return new Response(assets.html, { headers: { 'content-type': 'text/html' } })
        }
        return new Response('not found', { status: 404 })
      })
    },
    { html: FAKE_SUNO_HTML, wav: silentWav().toString('base64') }
  )
  await app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __sunoDesktopE2E?: Hooks }).__sunoDesktopE2E
    const deadline = Date.now() + 20_000
    while (!hooks?.mainWindow && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
  })
  await suno('/')
}, 120_000)

afterAll(async () => {
  await app.close()
})

function hooks<T>(fn: (h: Hooks) => T): Promise<T> {
  return app.evaluate((_electron, source) => {
    const h = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return (new Function('h', `return (${source})(h)`) as (h: Hooks) => T)(h)
  }, fn.toString())
}

describe('first launch onboarding', () => {
  it('covers the window on a fresh install', async () => {
    expect(await hooks((h) => h.mainWindow.isOnboarding())).toBe(true)
    expect(await hooks((h) => h.settings.get().onboardingCompleted)).toBe(false)
    const heading = await waitFor(
      () =>
        inLocal<string>(
          'onboarding.html',
          `document.querySelector('[data-step="welcome"] h1').textContent`
        ),
      (t) => t.length > 0,
      'onboarding welcome step'
    )
    expect(heading).toBe('Welcome to Suno Desktop')
    await screenshot('onboarding-welcome', 'app://ui/onboarding.html')
  })

  it('applies the theme picked on the theme step right away', async () => {
    await inLocal(
      'onboarding.html',
      `document.querySelector('[data-step="welcome"] [data-next]').click()`
    )
    await inLocal('onboarding.html', `document.querySelector('[data-theme-choice="dark"]').click()`)
    await waitFor(
      () =>
        app.evaluate(({ nativeTheme }) => ({
          source: nativeTheme.themeSource,
          dark: nativeTheme.shouldUseDarkColors
        })),
      (t) => t.source === 'dark' && t.dark,
      'dark theme'
    )
    expect(await hooks((h) => h.settings.get().theme)).toBe('dark')
    // The local UI follows via <html data-theme>, including the onboarding page itself.
    for (const page of ['titlebar.html', 'onboarding.html']) {
      await waitFor(
        () => inLocal<string>(page, 'document.documentElement.dataset.theme'),
        (t) => t === 'dark',
        `${page} in dark mode`
      )
    }
    await new Promise((r) => setTimeout(r, 400)) // let the step animation settle
    await screenshot('onboarding-theme', 'app://ui/onboarding.html')
    await inLocal(
      'onboarding.html',
      `document.querySelector('[data-theme-choice="system"]').click()`
    )
    await waitFor(
      () => hooks((h) => h.settings.get().theme),
      (t) => t === 'system',
      'auto theme'
    )
  })

  it('goes away for good once finished', async () => {
    await inLocal(
      'onboarding.html',
      `document.querySelector('[data-step="theme"] [data-next]').click()`
    )
    await inLocal('onboarding.html', `document.querySelector('[data-finish]').click()`)
    await waitFor(
      () => hooks((h) => h.mainWindow.isOnboarding()),
      (v) => !v,
      'onboarding to close'
    )
    expect(await hooks((h) => h.settings.get().onboardingCompleted)).toBe(true)
    const left = await app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().some((w) => w.getURL().endsWith('onboarding.html'))
    )
    expect(left).toBe(false)
  })
})

describe('local UI', () => {
  it('serves the title bar over app:// with the UI API', async () => {
    const result = await inLocal<{ api: string; title: string }>(
      'titlebar.html',
      `({ api: typeof window.sunoDesktopUI, title: document.getElementById('title').textContent })`
    )
    expect(result.api).toBe('object')
    await waitFor(
      () => inLocal<string>('titlebar.html', `document.getElementById('title').textContent`),
      (t) => t === 'Fake Suno',
      'title bar to show the page title'
    )
    await screenshot('titlebar', 'app://ui/titlebar.html')
    await screenshot('suno-view', 'https://suno.com/')
  })
})

describe('suno.com bridge', () => {
  it('exposes a frozen, read-only window.sunoDesktop and nothing privileged', async () => {
    const bridge = await inSuno<Record<string, unknown>>(`({
      version: window.sunoDesktop.version,
      apiVersion: window.sunoDesktop.apiVersion,
      platform: window.sunoDesktop.platform,
      capabilities: [...window.sunoDesktop.capabilities],
      frozen: Object.isFrozen(window.sunoDesktop),
      replaced: (() => { try { window.sunoDesktop = 1 } catch {} return typeof window.sunoDesktop })(),
      require: typeof require,
      process: typeof process,
      ui: typeof window.sunoDesktopUI,
      ipc: typeof window.ipcRenderer
    })`)
    expect(bridge).toMatchObject({
      version: '0.1.0',
      apiVersion: 1,
      frozen: true,
      replaced: 'object',
      require: 'undefined',
      process: 'undefined',
      ui: 'undefined',
      ipc: 'undefined'
    })
    expect(bridge['capabilities']).toContain('desktop')
    expect(bridge['capabilities']).toContain('events.songChanged')
  })

  it('looks like stock Chrome to websites', async () => {
    const ua = await inSuno<string>('navigator.userAgent')
    expect(ua).not.toMatch(/Electron|suno-desktop|Suno Desktop/i)
    expect(ua).toMatch(/Chrome\/\d+\.0\.0\.0 /)
  })

  it('relays navigator.mediaSession to main through validated IPC', async () => {
    const snapshot = await waitFor(
      () =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E.media.current
        ),
      (s) => s.song?.title === 'Neon Rain' && s.canGoNext,
      'media snapshot'
    )
    expect(snapshot).toMatchObject({
      song: { title: 'Neon Rain', artist: 'Lamp', album: 'E2E Sessions' },
      playbackState: 'playing',
      canGoNext: true,
      canGoPrevious: true
    })
    expect(snapshot.song?.artwork[0]?.src).toContain(COVER_ID)
  })

  it('drives playback through mediaSession action handlers', async () => {
    for (const command of ['next', 'previous', 'toggle'] as const) {
      await app.evaluate((_e, c) => {
        ;(globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E.media.command(c)
      }, command)
    }
    const calls = await waitFor(
      () => inSuno<string[]>('window.__calls'),
      (c) => c.length >= 3,
      'action handler calls'
    )
    // toggle while playing pauses.
    expect(calls).toEqual(['next', 'previous', 'pause'])
    await waitFor(
      () =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E.media.current
              .playbackState
        ),
      (state) => state === 'paused',
      'paused state'
    )
  })

  it('emits routeChanged on client-side navigation and off() unsubscribes', async () => {
    await inSuno(`
      window.__routes = []
      window.__onRoute = (p) => window.__routes.push(p.path)
      window.sunoDesktop.on('routeChanged', window.__onRoute)
      history.pushState({}, '', '/create')
    `)
    await waitFor(
      () => inSuno<string[]>('window.__routes'),
      (r) => r.length === 1,
      'routeChanged'
    )
    await inSuno(`
      window.sunoDesktop.off('routeChanged', window.__onRoute)
      history.pushState({}, '', '/library')
    `)
    await new Promise((r) => setTimeout(r, 800))
    expect(await inSuno<string[]>('window.__routes')).toEqual(['/create'])
  })

  it('rejects unknown events', async () => {
    expect(
      await inSuno<string>(
        `(() => { try { window.sunoDesktop.on('nope', () => {}); return 'accepted' } catch (e) { return e.name } })()`
      )
    ).toBe('TypeError')
  })
})

describe('injection pipeline', () => {
  it('injects CSS and scripts on matching routes, in the right worlds', async () => {
    await suno('/')
    await app.evaluate(() => {
      const { injection } = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
      injection.register({
        id: 'e2e.css',
        owner: 'e2e',
        matches: ['https://suno.com/create*'],
        css: 'body { outline: 3px solid rgb(1, 2, 3) }',
        world: 'isolated',
        runOn: []
      })
      injection.register({
        id: 'e2e.isolated',
        owner: 'e2e',
        matches: ['https://suno.com/create*'],
        js: `document.documentElement.dataset.e2eIsolated = typeof window.sunoDesktop + ':' + typeof window.__calls`,
        world: 'isolated',
        runOn: ['route']
      })
      injection.register({
        id: 'e2e.main',
        owner: 'e2e',
        matches: ['https://suno.com/create*'],
        js: `document.documentElement.dataset.e2eMain = typeof window.__calls`,
        world: 'main',
        runOn: ['route']
      })
    })
    const outline = `getComputedStyle(document.body).outlineColor`
    expect(await inSuno<string>(outline)).not.toBe('rgb(1, 2, 3)')

    await inSuno(`history.pushState({}, '', '/create')`)
    const data = await waitFor(
      () => inSuno<Record<string, string>>(`({ ...document.documentElement.dataset })`),
      (d) => d['e2eIsolated'] !== undefined && d['e2eMain'] !== undefined,
      'injected scripts'
    )
    // Plugin world sees the bridge but not page globals; main world sees page globals.
    expect(data).toMatchObject({ e2eIsolated: 'object:undefined', e2eMain: 'object' })
    expect(await inSuno<string>(outline)).toBe('rgb(1, 2, 3)')

    await inSuno(`history.pushState({}, '', '/library')`)
    await waitFor(
      () => inSuno<string>(outline),
      (c) => c !== 'rgb(1, 2, 3)',
      'CSS removal'
    )
    await app.evaluate(() => {
      ;(
        globalThis as unknown as { __sunoDesktopE2E: Hooks }
      ).__sunoDesktopE2E.injection.unregisterOwner('e2e')
    })
  })
})

describe('navigation policy', () => {
  it('sends non-allowlisted links to the default browser', async () => {
    await suno('/')
    await inSuno(`location.href = 'https://example.com/elsewhere'`)
    await waitFor(
      () => app.evaluate(() => (globalThis as unknown as { __external: string[] }).__external),
      (urls) => urls.includes('https://example.com/elsewhere'),
      'openExternal'
    )
    expect(await inSuno<string>('location.href')).toBe('https://suno.com/')
  })

  it('opens OAuth popups as child windows and other popups externally', async () => {
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    await inSuno(
      `window.open('https://accounts.google.com/o/oauth2/v2/auth?x=1', 'auth', 'width=480,height=640'); 1`
    )
    await waitFor(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.webContents.getURL())
        ),
      (urls) =>
        urls.length === before + 1 &&
        urls.some((u) => u.startsWith('https://accounts.google.com/')),
      'auth popup'
    )
    const popup = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().startsWith('https://accounts.google.com/')
      )
      if (!win) return null
      const result = {
        bridge: (await win.webContents.executeJavaScript('typeof window.sunoDesktop')) as string,
        url: win.webContents.getURL(),
        hasParent: win.getParentWindow() !== null,
        // Shares the persistent suno.com session (cookies from OAuth land where suno.com reads them).
        sameSession:
          win.webContents.session ===
          (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E.mainWindow
            .contents.session
      }
      win.close()
      return result
    })
    expect(popup?.url).toContain('accounts.google.com/o/oauth2')
    expect(popup?.hasParent).toBe(true)
    expect(popup?.sameSession).toBe(true)
    // The bridge only exists on suno.com, never on login providers.
    expect(popup?.bridge).toBe('undefined')

    await inSuno(`window.open('https://x.com/intent/post?text=hi', '_blank'); 1`)
    await waitFor(
      () => app.evaluate(() => (globalThis as unknown as { __external: string[] }).__external),
      (urls) => urls.some((u) => u.startsWith('https://x.com/intent')),
      'external popup'
    )
  })

  it('opens suno-desktop://open deep links and ignores bad ones', async () => {
    await app.evaluate(() => {
      const hooks = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
      hooks.openDeepLink('suno-desktop://open?path=//evil.example/x')
      hooks.openDeepLink('suno-desktop://open?path=/song/abc')
    })
    await waitFor(
      () => inSuno<string>('location.href'),
      (href) => href === 'https://suno.com/song/abc',
      'deep link navigation'
    )
  })
})

describe('offline page', () => {
  it('shows on load failure and recovers on retry', async () => {
    await suno('/flaky')
    const info = await waitFor(
      () =>
        app.evaluate(() =>
          (
            globalThis as unknown as { __sunoDesktopE2E: Hooks }
          ).__sunoDesktopE2E.mainWindow.offlineInfo()
        ),
      (i) => i !== null,
      'offline info'
    )
    expect(info?.kind).toBe('load-failed')
    const heading = await waitFor(
      () => inLocal<string>('offline.html', `document.getElementById('heading').textContent`),
      (h) => h.length > 0,
      'offline heading'
    )
    expect(heading).toMatch(/reach Suno|offline/)
    await screenshot('offline', 'app://ui/offline.html')

    await inLocal('offline.html', `document.getElementById('retry').click()`)
    await waitFor(
      () =>
        app.evaluate(() =>
          (
            globalThis as unknown as { __sunoDesktopE2E: Hooks }
          ).__sunoDesktopE2E.mainWindow.offlineInfo()
        ),
      (i) => i === null,
      'overlay to hide after retry'
    )
  })
})

describe('settings window and IPC validation', () => {
  it('opens settings, applies valid patches and rejects invalid ones', async () => {
    await app.evaluate(() => {
      ;(globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E.openSettings()
    })
    await waitFor(
      () =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((w) => w.getURL() === 'app://ui/settings.html' && !w.isLoading())
        ),
      Boolean,
      'settings window'
    )
    const valid = await inLocal<boolean>(
      'settings.html',
      `window.sunoDesktopUI.settings.update({ closeToTray: false }).then((s) => s.closeToTray)`
    )
    expect(valid).toBe(false)
    const invalid = await inLocal<string>(
      'settings.html',
      `window.sunoDesktopUI.settings.update({ version: 9 }).then(() => 'accepted', () => 'rejected')`
    )
    expect(invalid).toBe('rejected')
    const wrongRole = await inLocal<string>(
      'titlebar.html',
      `window.sunoDesktopUI.settings.get().then(() => 'accepted', () => 'rejected')`
    )
    expect(wrongRole).toBe('rejected')
    const zoom = await inLocal<number>(
      'settings.html',
      `window.sunoDesktopUI.settings.update({ zoomFactor: 1.2 }).then((s) => s.zoomFactor)`
    )
    expect(zoom).toBe(1.2)
    await waitFor(
      () =>
        app.evaluate(() =>
          (
            globalThis as unknown as { __sunoDesktopE2E: Hooks }
          ).__sunoDesktopE2E.mainWindow.contents.getZoomFactor()
        ),
      (z) => Math.abs(z - 1.2) < 0.01,
      'zoom applied to suno view'
    )
    await new Promise((r) => setTimeout(r, 500))
    await screenshot('settings', 'app://ui/settings.html')
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark'
    })
    await new Promise((r) => setTimeout(r, 500))
    await screenshot('settings-dark', 'app://ui/settings.html')
    await screenshot('titlebar-dark', 'app://ui/titlebar.html')
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system'
    })
  })
})

describe('reset app settings', () => {
  it('asks first and does nothing when cancelled', async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false })
    })
    const result = await inLocal<boolean>(
      'settings.html',
      'window.sunoDesktopUI.settings.resetApp()'
    )
    expect(result).toBe(false)
    expect(await hooks((h) => h.settings.get().zoomFactor)).toBe(1.2)
  })

  it('restores defaults and the onboarding but keeps Suno signed in', async () => {
    await app.evaluate(async ({ session }) => {
      await session
        .fromPartition('persist:suno')
        .cookies.set({ url: 'https://suno.com', name: '__e2e_login', value: 'kept' })
    })
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
    })
    const result = await inLocal<boolean>(
      'settings.html',
      'window.sunoDesktopUI.settings.resetApp()'
    )
    expect(result).toBe(true)
    const settings = await hooks((h) => h.settings.get())
    expect(settings).toMatchObject({
      closeToTray: true,
      zoomFactor: 1,
      theme: 'system',
      discordRichPresence: false,
      onboardingCompleted: false
    })
    await waitFor(() => hooks((h) => h.mainWindow.isOnboarding()), Boolean, 'onboarding again')
    const cookies = await app.evaluate(({ session }) =>
      session.fromPartition('persist:suno').cookies.get({ name: '__e2e_login' })
    )
    expect(cookies.map((c) => c.value)).toEqual(['kept'])
    await waitFor(
      () => inLocal<boolean>('onboarding.html', `!!document.querySelector('[data-skip]')`),
      Boolean,
      'onboarding page'
    )
    await inLocal('onboarding.html', `document.querySelector('[data-skip]').click()`)
    await waitFor(
      () => hooks((h) => h.mainWindow.isOnboarding()),
      (v) => !v,
      'skip onboarding'
    )
  })
})

describe('Suno++', () => {
  const fixtures = path.join(root, 'tests', 'fixtures', 'sunoplusplus')
  const repo = 'https://github.com/Cat-things/sunoplusplus'
  const v1 = readFileSync(path.join(fixtures, 'sunoplusplus.js'), 'utf8')
  const catalog = readFileSync(path.join(fixtures, 'catalog.json'), 'utf8')
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')

  /** The files of a Suno++ release, keyed by the URLs the app's updater downloads. */
  function releaseFiles(version: string, bundle: string): Record<string, string> {
    const desktop = {
      formatVersion: 1,
      version,
      bridgeApi: 1,
      minDesktopVersion: '0.1.0',
      files: {
        bundle: { name: 'sunoplusplus.js', size: Buffer.byteLength(bundle), sha256: sha(bundle) },
        catalog: { name: 'catalog.json', size: Buffer.byteLength(catalog), sha256: sha(catalog) }
      }
    }
    return {
      [`${repo}/releases/latest/download/desktop.json`]: JSON.stringify(desktop),
      [`${repo}/releases/download/v${version}/sunoplusplus.js`]: bundle,
      [`${repo}/releases/download/v${version}/catalog.json`]: catalog
    }
  }

  /** Stands in for GitHub in the default session, where the updater's net.fetch goes. */
  async function serve(files: Record<string, string>): Promise<void> {
    await app.evaluate(({ session }, served) => {
      const g = globalThis as unknown as {
        __sppFiles: Record<string, string>
        __sppRequests?: string[]
      }
      g.__sppFiles = served
      if (g.__sppRequests) return
      g.__sppRequests = []
      session.defaultSession.protocol.handle('https', (request) => {
        g.__sppRequests?.push(request.url)
        const body = g.__sppFiles[request.url]
        return body === undefined ? new Response('not found', { status: 404 }) : new Response(body)
      })
    }, files)
  }

  const requests = () =>
    app.evaluate(() => (globalThis as unknown as { __sppRequests: string[] }).__sppRequests)

  /** Runs code in the plugin world on suno.com, where Suno++ runs. */
  function inPluginWorld<T>(code: string): Promise<T> {
    return app.evaluate(async (_electron, js) => {
      const h = (globalThis as unknown as { __sunoDesktopE2E: Hooks }).__sunoDesktopE2E
      return (await h.mainWindow.contents.executeJavaScriptInIsolatedWorld(1001, [
        { code: js }
      ])) as T
    }, code)
  }

  const sunoTitle = (expected: string) =>
    waitFor(
      () => inSuno<string>('document.title'),
      (t) => t === expected,
      `title "${expected}"`
    )

  it('is off by default and downloads nothing', async () => {
    await serve(releaseFiles('0.1.0', v1))
    expect(await hooks((h) => h.settings.get().sunoPlusPlusEnabled)).toBe(false)
    await hooks((h) => h.openSettings())
    await waitFor(
      () => inLocal<boolean>('settings.html', `!!document.getElementById('spp-check')`),
      Boolean,
      'settings window'
    )
    expect(await requests()).toEqual([])
  })

  it('downloads the latest release when turned on in Settings', async () => {
    await inLocal(
      'settings.html',
      `document.querySelector('[data-tab="plugins"]').click();
       document.querySelector('input[data-setting="sunoPlusPlusEnabled"]').click()`
    )
    await waitFor(
      () => hooks((h) => h.sunoPlusPlus.info().installedVersion),
      (v) => v === '0.1.0',
      'Suno++ 0.1.0 installed'
    )
    expect(await requests()).toEqual([
      `${repo}/releases/latest/download/desktop.json`,
      `${repo}/releases/download/v0.1.0/sunoplusplus.js`,
      `${repo}/releases/download/v0.1.0/catalog.json`
    ])
    await waitFor(
      () => inLocal<string>('settings.html', `document.getElementById('spp-status').textContent`),
      (t) => t.startsWith('Up to date'),
      'up to date status'
    )
    expect(
      await inLocal<boolean>(
        'settings.html',
        `!!document.getElementById('spp-plugin-now-playing-title')`
      )
    ).toBe(true)
  })

  it('runs a community plugin on suno.com when it is turned on', async () => {
    await inSuno(`navigator.mediaSession.playbackState = 'playing'`)
    await inLocal(
      'settings.html',
      `document.getElementById('spp-plugin-now-playing-title').click()`
    )
    await sunoTitle('♪ Neon Rain — Lamp')
    await waitFor(
      () =>
        inLocal<boolean>(
          'settings.html',
          `!!document.getElementById('spp-setting-now-playing-title-showArtist')`
        ),
      Boolean,
      'plugin settings'
    )
    await inLocal(
      'settings.html',
      `document.getElementById('spp-setting-now-playing-title-showArtist').click()`
    )
    await sunoTitle('♪ Neon Rain')
    await screenshot('settings-plugins', 'app://ui/settings.html')
  })

  it('applies a community theme', async () => {
    await inLocal(
      'settings.html',
      `document.querySelector('[data-tab="themes"]').click();
       document.getElementById('spp-theme-neon-accents').click()`
    )
    await waitFor(
      () =>
        inSuno<string>(
          `getComputedStyle(document.documentElement).getPropertyValue('--spp-accent').trim()`
        ),
      (v) => v === '#ff2e97',
      'theme colors on suno.com'
    )
    await waitFor(
      () =>
        inLocal<boolean>(
          'settings.html',
          `!!document.getElementById('spp-color-neon-accents-accent')`
        ),
      Boolean,
      'theme colors in settings'
    )
    await screenshot('settings-themes', 'app://ui/settings.html')
  })

  it('updates itself to a new release without reloading the page', async () => {
    await serve(releaseFiles('0.1.1', v1.replaceAll('"0.1.0"', '"0.1.1"')))
    await inLocal('settings.html', `document.getElementById('spp-check').click()`)
    await waitFor(
      () => hooks((h) => h.sunoPlusPlus.info().installedVersion),
      (v) => v === '0.1.1',
      'Suno++ 0.1.1 installed'
    )
    await waitFor(
      () =>
        inPluginWorld<string | undefined>(
          `globalThis[Symbol.for('sunoplusplus.runtime')]?.version`
        ),
      (v) => v === '0.1.1',
      '0.1.1 running on the page'
    )
    // The new version took over the song that was already playing, and the theme.
    expect(await inSuno<string>('document.title')).toBe('♪ Neon Rain')
    expect(await inSuno<number>(`document.querySelectorAll('#sunoplusplus-theme').length`)).toBe(1)
  })

  it('stops everything on the open page when turned off', async () => {
    await inLocal(
      'settings.html',
      `document.querySelector('[data-tab="plugins"]').click();
       document.querySelector('input[data-setting="sunoPlusPlusEnabled"]').click()`
    )
    await sunoTitle('Fake Suno')
    expect(await inSuno<number>(`document.querySelectorAll('#sunoplusplus-theme').length`)).toBe(0)
    expect(
      await inPluginWorld<string>(`typeof globalThis[Symbol.for('sunoplusplus.runtime')]`)
    ).toBe('undefined')
  })

  it('turns Suno++ and a plugin on from a suno-desktop:// link, after asking', async () => {
    await hooks((h) =>
      h.sunoPlusPlus.act({ type: 'setPluginEnabled', id: 'now-playing-title', enabled: false })
    )
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __dialogs: string[] }
      g.__dialogs = []
      dialog.showMessageBox = ((_parent: unknown, options: { message: string }) => {
        g.__dialogs.push(options.message)
        return Promise.resolve({ response: 0, checkboxChecked: false })
      }) as typeof dialog.showMessageBox
    })
    await hooks((h) => {
      h.openDeepLink('suno-desktop://plugin/install?id=now-playing-title')
    })
    await waitFor(
      () => hooks((h) => h.settings.get().sunoPlusPlus.enabled['now-playing-title']),
      (v) => v === true,
      'plugin turned on by the link'
    )
    expect(await hooks((h) => h.settings.get().sunoPlusPlusEnabled)).toBe(true)
    expect(
      await app.evaluate(() => (globalThis as unknown as { __dialogs: string[] }).__dialogs)
    ).toEqual(['Turn on Suno++?', 'Turn on Now playing in the tab title?'])
    await sunoTitle('♪ Neon Rain')
    // Leave the app as other tests expect it.
    await hooks((h) => h.settings.update({ sunoPlusPlusEnabled: false }))
    await sunoTitle('Fake Suno')
  })
})

describe('health', () => {
  it('logged no errors in the main process', async () => {
    // Give pending async work (thumbar, tray, theme updates) a moment to surface errors.
    await new Promise((r) => setTimeout(r, 500))
    const log = readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8')
    const errors = log.split('\n').filter((line) => line.includes('[error]'))
    expect(errors).toEqual([])
  })
})
