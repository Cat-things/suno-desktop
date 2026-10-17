import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppAsset } from '../src/main/app-protocol-path'
import { sanitizeFilename, uniqueFilename } from '../src/main/filenames'
import { decidePermissionCheck, decidePermissionRequest } from '../src/main/permission-policy'
import { matchShortcut, type KeyInput } from '../src/main/shortcuts'
import { cleanUserAgent } from '../src/main/user-agent'
import { contentViewBounds, supportsMica, titleBarOverlayColors } from '../src/main/windows/layout'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key: k,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods
})

describe('matchShortcut', () => {
  it.each([
    [key('r', { control: true }), 'reload'],
    [key('R', { control: true, shift: true }), 'hardReload'],
    [key('F5'), 'reload'],
    [key('F5', { control: true }), 'hardReload'],
    [key('ArrowLeft', { alt: true }), 'back'],
    [key('ArrowRight', { alt: true }), 'forward'],
    [key('BrowserBack'), 'back'],
    [key('0', { control: true }), 'zoomReset'],
    [key('=', { control: true }), 'zoomIn'],
    [key('+', { control: true, shift: true }), 'zoomIn'],
    [key('-', { control: true }), 'zoomOut'],
    [{ ...key('Subtract', { control: true }), code: 'NumpadSubtract' }, 'zoomOut'],
    [key(',', { control: true }), 'openSettings'],
    [key('F11'), 'toggleFullscreen'],
    [key('F12'), 'toggleDevTools'],
    [key('I', { control: true, shift: true }), 'toggleDevTools']
  ] as const)('maps %o to %s', (input, action) => {
    expect(matchShortcut(input)).toBe(action)
  })

  it('ignores key-up events and plain typing', () => {
    expect(matchShortcut({ ...key('r', { control: true }), type: 'keyUp' })).toBeNull()
    expect(matchShortcut(key('r'))).toBeNull()
    expect(matchShortcut(key('ArrowLeft'))).toBeNull()
    expect(matchShortcut(key('ArrowLeft', { alt: true, control: true }))).toBeNull()
    expect(matchShortcut(key('c', { control: true }))).toBeNull()
  })
})

describe('cleanUserAgent', () => {
  it('strips Electron and app tokens and reduces the Chrome version', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'suno-desktop/0.1.0 Chrome/146.0.7680.31 Electron/44.9.0 Safari/537.36'
    expect(cleanUserAgent(ua, ['suno-desktop', 'Suno Desktop'])).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/146.0.0.0 Safari/537.36'
    )
  })

  it('handles app names with spaces', () => {
    expect(cleanUserAgent('A Suno Desktop/1.0 Chrome/1.2.3.4 B', ['Suno Desktop'])).toBe(
      'A Chrome/1.0.0.0 B'
    )
  })
})

describe('permission policy', () => {
  const sunoUrl = 'https://suno.com/create'

  it('grants what Suno needs', () => {
    for (const permission of ['notifications', 'clipboard-sanitized-write', 'fullscreen']) {
      expect(decidePermissionRequest({ permission, requestingUrl: sunoUrl })).toBe('allow')
    }
  })

  it('asks before granting the microphone and never grants the camera', () => {
    expect(
      decidePermissionRequest({
        permission: 'media',
        requestingUrl: sunoUrl,
        mediaTypes: ['audio']
      })
    ).toBe('ask')
    expect(
      decidePermissionRequest({
        permission: 'media',
        requestingUrl: sunoUrl,
        mediaTypes: ['audio', 'video']
      })
    ).toBe('deny')
    expect(decidePermissionRequest({ permission: 'media', requestingUrl: sunoUrl })).toBe('deny')
  })

  it('denies everything else and everyone else', () => {
    for (const permission of [
      'geolocation',
      'clipboard-read',
      'midi',
      'hid',
      'serial',
      'usb',
      'openExternal',
      'display-capture',
      'pointerLock',
      'fileSystem'
    ]) {
      expect(decidePermissionRequest({ permission, requestingUrl: sunoUrl })).toBe('deny')
    }
    expect(
      decidePermissionRequest({
        permission: 'notifications',
        requestingUrl: 'https://accounts.google.com/'
      })
    ).toBe('deny')
  })

  it('reports microphone checks only after the user approved it', () => {
    const base = {
      permission: 'media',
      requestingOrigin: 'https://suno.com',
      mediaType: 'audio'
    }
    expect(decidePermissionCheck({ ...base, microphoneGranted: false })).toBe(false)
    expect(decidePermissionCheck({ ...base, microphoneGranted: true })).toBe(true)
    expect(decidePermissionCheck({ ...base, mediaType: 'video', microphoneGranted: true })).toBe(
      false
    )
  })
})

describe('filenames', () => {
  it.each([
    ['Neon Rain.mp3', 'Neon Rain.mp3'],
    ['a/b\\c:d*e?f"g<h>i|j.wav', 'a_b_c_d_e_f_g_h_i_j.wav'],
    ['CON.mp3', '_CON.mp3'],
    ['lpt1', '_lpt1'],
    ['trailing. . ', 'trailing'],
    ['', 'download'],
    ['...', 'download'],
    ['\u0000\u0001', 'download']
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected)
  })

  it('limits length but keeps the extension', () => {
    const result = sanitizeFilename(`${'x'.repeat(500)}.flac`)
    expect(result.length).toBe(200)
    expect(result.endsWith('.flac')).toBe(true)
  })

  it('finds a free name', () => {
    const taken = new Set(['song.mp3', 'song (1).mp3'])
    expect(uniqueFilename('song.mp3', (n) => taken.has(n))).toBe('song (2).mp3')
    expect(uniqueFilename('new.mp3', (n) => taken.has(n))).toBe('new.mp3')
  })
})

describe('resolveAppAsset', () => {
  const root = path.resolve('/app/out/renderer')

  it('maps app://ui paths into the renderer folder', () => {
    expect(resolveAppAsset(root, 'app://ui/settings.html')).toBe(path.join(root, 'settings.html'))
    expect(resolveAppAsset(root, 'app://ui/assets/a.js?v=1')).toBe(
      path.join(root, 'assets', 'a.js')
    )
  })

  it('collapses dot segments without leaving the root', () => {
    expect(resolveAppAsset(root, 'app://ui/../main/index.js')).toBe(
      path.join(root, 'main', 'index.js')
    )
    expect(resolveAppAsset(root, 'app://ui/%2e%2e/%2e%2e/secret')).toBe(path.join(root, 'secret'))
  })

  it.each([
    'app://ui/..%5c..%5csecret',
    'app://ui/..%2f..%2fsecret',
    'app://ui/',
    'app://other/settings.html',
    'https://ui/settings.html',
    'app://ui/a%00.html'
  ])('refuses %s', (url) => {
    expect(resolveAppAsset(root, url)).toBeNull()
  })
})

describe('layout', () => {
  it('places the content view under the title bar', () => {
    expect(contentViewBounds({ width: 1200, height: 800 }, 40, false)).toEqual({
      x: 0,
      y: 40,
      width: 1200,
      height: 760
    })
    expect(contentViewBounds({ width: 1200, height: 800 }, 40, true)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800
    })
    expect(contentViewBounds({ width: 10, height: 20 }, 40, false).height).toBe(0)
  })

  it('detects Mica support', () => {
    expect(supportsMica('win32', '10.0.22631')).toBe(true)
    expect(supportsMica('win32', '10.0.22000')).toBe(false)
    expect(supportsMica('win32', '10.0.19045')).toBe(false)
    expect(supportsMica('linux', '6.1.0')).toBe(false)
  })

  it('uses transparent caption buttons over Mica', () => {
    expect(titleBarOverlayColors(true, true).color).toBe('#00000000')
    expect(titleBarOverlayColors(false, false).symbolColor).toBe('#1a1a1a')
  })
})
