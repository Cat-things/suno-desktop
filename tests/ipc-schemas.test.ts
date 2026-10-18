import { describe, expect, it } from 'vitest'
import { IPC } from '../src/shared/ipc-channels'
import {
  checkIpcMessage,
  externalLinkSchema,
  isTrustedLocalUiUrl,
  mediaSnapshotSchema,
  type SenderInfo
} from '../src/shared/ipc-schemas'

const titlebar: SenderInfo = { role: 'titlebar', url: 'app://ui/titlebar.html', isMainFrame: true }
const settings: SenderInfo = { role: 'settings', url: 'app://ui/settings.html', isMainFrame: true }
const suno: SenderInfo = { role: 'suno', url: 'https://suno.com/create', isMainFrame: true }

const snapshot = {
  song: {
    title: 'Neon Rain',
    artist: 'Lamp',
    album: '',
    artwork: [{ src: 'https://cdn2.suno.ai/image_x.jpeg', sizes: '512x512', type: 'image/jpeg' }]
  },
  playbackState: 'playing',
  position: { duration: 180, position: 12.5, playbackRate: 1 },
  canGoNext: true,
  canGoPrevious: false
}

describe('checkIpcMessage', () => {
  it('accepts a valid message from the right role', () => {
    expect(checkIpcMessage(IPC.navBack, titlebar, undefined)).toEqual({
      ok: true,
      payload: undefined
    })
    expect(checkIpcMessage(IPC.settingsUpdate, settings, { closeToTray: false })).toEqual({
      ok: true,
      payload: { closeToTray: false }
    })
    expect(checkIpcMessage(IPC.mediaUpdate, suno, snapshot).ok).toBe(true)
  })

  it('rejects unknown channels', () => {
    expect(checkIpcMessage('shell:exec', titlebar, 'calc.exe')).toEqual({
      ok: false,
      reason: 'unknown channel'
    })
    expect(checkIpcMessage('__proto__', titlebar, undefined).ok).toBe(false)
  })

  it('rejects roles that may not use a channel', () => {
    expect(checkIpcMessage(IPC.settingsUpdate, titlebar, {}).ok).toBe(false)
    expect(checkIpcMessage(IPC.sessionClear, suno, undefined).ok).toBe(false)
    expect(checkIpcMessage(IPC.mediaUpdate, settings, snapshot).ok).toBe(false)
  })

  it('rejects senders from unexpected origins', () => {
    const spoofed: SenderInfo = { role: 'suno', url: 'https://evil.example/', isMainFrame: true }
    expect(checkIpcMessage(IPC.mediaUpdate, spoofed, snapshot)).toEqual({
      ok: false,
      reason: 'untrusted sender'
    })
    const navigatedAway: SenderInfo = { ...titlebar, url: 'https://suno.com/' }
    expect(checkIpcMessage(IPC.navBack, navigatedAway, undefined).ok).toBe(false)
    const unknown: SenderInfo = { role: undefined, url: 'app://ui/x.html', isMainFrame: true }
    expect(checkIpcMessage(IPC.navBack, unknown, undefined).ok).toBe(false)
  })

  it('rejects subframes', () => {
    expect(checkIpcMessage(IPC.mediaUpdate, { ...suno, isMainFrame: false }, snapshot).ok).toBe(
      false
    )
  })

  it('rejects malformed payloads', () => {
    expect(checkIpcMessage(IPC.navBack, titlebar, { extra: true }).ok).toBe(false)
    expect(checkIpcMessage(IPC.settingsUpdate, settings, { zoomFactor: 'big' }).ok).toBe(false)
    expect(
      checkIpcMessage(IPC.mediaUpdate, suno, { ...snapshot, playbackState: 'exploding' }).ok
    ).toBe(false)
  })

  it('only lets settings open links into the project repo', () => {
    const ok = 'https://github.com/Cat-things/suno-desktop/issues'
    expect(checkIpcMessage(IPC.appOpenExternal, settings, ok).ok).toBe(true)
    for (const bad of [
      'https://github.com/Cat-things/suno-desktop-evil',
      'https://github.com.evil.example/Cat-things/suno-desktop',
      'file:///C:/Windows/System32/calc.exe',
      'https://evil.example/'
    ]) {
      expect(checkIpcMessage(IPC.appOpenExternal, settings, bad).ok).toBe(false)
    }
  })

  it('allows the dev server only when configured', () => {
    const dev: SenderInfo = { ...titlebar, url: 'http://localhost:5173/titlebar.html' }
    expect(checkIpcMessage(IPC.navBack, dev, undefined).ok).toBe(false)
    expect(
      checkIpcMessage(IPC.navBack, dev, undefined, { devServerUrl: 'http://localhost:5173' }).ok
    ).toBe(true)
  })
})

describe('onboarding and reset channels', () => {
  const onboarding: SenderInfo = {
    role: 'onboarding',
    url: 'app://ui/onboarding.html',
    isMainFrame: true
  }

  it('lets only the onboarding page pick a theme and finish onboarding', () => {
    expect(checkIpcMessage(IPC.onboardingSetTheme, onboarding, 'dark')).toEqual({
      ok: true,
      payload: 'dark'
    })
    expect(checkIpcMessage(IPC.onboardingFinish, onboarding, undefined).ok).toBe(true)
    expect(checkIpcMessage(IPC.onboardingSetTheme, onboarding, 'sepia').ok).toBe(false)
    expect(checkIpcMessage(IPC.onboardingSetTheme, suno, 'dark').ok).toBe(false)
    expect(checkIpcMessage(IPC.onboardingFinish, titlebar, undefined).ok).toBe(false)
  })

  it('does not give onboarding general settings access', () => {
    expect(checkIpcMessage(IPC.settingsUpdate, onboarding, { closeToTray: false }).ok).toBe(false)
    expect(checkIpcMessage(IPC.settingsResetApp, onboarding, undefined).ok).toBe(false)
  })

  it('lets only the settings window reset app settings', () => {
    expect(checkIpcMessage(IPC.settingsResetApp, settings, undefined).ok).toBe(true)
    expect(checkIpcMessage(IPC.settingsResetApp, titlebar, undefined).ok).toBe(false)
    expect(checkIpcMessage(IPC.settingsResetApp, suno, undefined).ok).toBe(false)
  })
})

describe('Suno++ channels', () => {
  it('lets only the settings window read, check and change Suno++', () => {
    const action = { type: 'setPluginEnabled', id: 'now-playing-title', enabled: true }
    expect(checkIpcMessage(IPC.sunoPlusPlusAction, settings, action)).toEqual({
      ok: true,
      payload: action
    })
    expect(checkIpcMessage(IPC.sunoPlusPlusGetInfo, settings, undefined).ok).toBe(true)
    expect(checkIpcMessage(IPC.sunoPlusPlusCheck, settings, undefined).ok).toBe(true)
    for (const sender of [titlebar, suno]) {
      expect(checkIpcMessage(IPC.sunoPlusPlusAction, sender, action).ok).toBe(false)
      expect(checkIpcMessage(IPC.sunoPlusPlusCheck, sender, undefined).ok).toBe(false)
    }
  })

  it('rejects malformed actions', () => {
    for (const bad of [
      { type: 'setPluginEnabled', id: '../x', enabled: true },
      { type: 'setThemeVariable', id: 'neon', key: 'accent', value: 'red; }' },
      { type: 'eval', js: 'alert(1)' }
    ]) {
      expect(checkIpcMessage(IPC.sunoPlusPlusAction, settings, bad).ok).toBe(false)
    }
  })

  it('lets the settings window link to the Suno Desktop and Suno++ repos only', () => {
    expect(externalLinkSchema.safeParse('https://github.com/Cat-things/sunoplusplus').success).toBe(
      true
    )
    expect(
      externalLinkSchema.safeParse(
        'https://github.com/Cat-things/sunoplusplus/blob/main/CONTRIBUTING.md'
      ).success
    ).toBe(true)
    expect(
      externalLinkSchema.safeParse('https://github.com/Cat-things/sunoplusplus-evil').success
    ).toBe(false)
    expect(
      externalLinkSchema.safeParse('https://example.com/Cat-things/sunoplusplus').success
    ).toBe(false)
  })
})

describe('mediaSnapshotSchema', () => {
  it('bounds string sizes and artwork schemes', () => {
    const long = { ...snapshot, song: { ...snapshot.song, title: 'x'.repeat(600) } }
    expect(mediaSnapshotSchema.safeParse(long).success).toBe(false)
    const js = {
      ...snapshot,
      song: { ...snapshot.song, artwork: [{ src: 'javascript:alert(1)' }] }
    }
    expect(mediaSnapshotSchema.safeParse(js).success).toBe(false)
    expect(mediaSnapshotSchema.safeParse({ ...snapshot, extra: 1 }).success).toBe(false)
  })
})

describe('isTrustedLocalUiUrl', () => {
  it('trusts app://ui only', () => {
    expect(isTrustedLocalUiUrl('app://ui/settings.html')).toBe(true)
    expect(isTrustedLocalUiUrl('app://other/settings.html')).toBe(false)
    expect(isTrustedLocalUiUrl('file:///C:/settings.html')).toBe(false)
    expect(isTrustedLocalUiUrl('garbage')).toBe(false)
  })
})
