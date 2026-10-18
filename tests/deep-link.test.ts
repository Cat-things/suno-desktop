import { describe, expect, it } from 'vitest'
import { findDeepLinkArg, parseDeepLink, resolveSunoPath } from '../src/shared/deep-link'

describe('parseDeepLink', () => {
  it('opens a song page', () => {
    expect(parseDeepLink('suno-desktop://open?path=/song/xyz')).toEqual({
      kind: 'open',
      url: 'https://suno.com/song/xyz'
    })
  })

  it('accepts the trailing slash Windows sometimes adds', () => {
    expect(parseDeepLink('suno-desktop://open/?path=%2Fcreate')).toEqual({
      kind: 'open',
      url: 'https://suno.com/create'
    })
  })

  it('keeps query and hash of the path', () => {
    expect(parseDeepLink('suno-desktop://open?path=%2Fsong%2Fabc%3Fsh%3D1%23top')).toEqual({
      kind: 'open',
      url: 'https://suno.com/song/abc?sh=1#top'
    })
  })

  it('defaults to the home page', () => {
    expect(parseDeepLink('suno-desktop://open')).toEqual({ kind: 'open', url: 'https://suno.com/' })
    expect(parseDeepLink('suno-desktop:open')).toEqual({ kind: 'open', url: 'https://suno.com/' })
  })

  it('is case-insensitive for scheme and route', () => {
    expect(parseDeepLink('SUNO-DESKTOP://OPEN?path=/create')).toEqual({
      kind: 'open',
      url: 'https://suno.com/create'
    })
  })

  it.each([
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'song/xyz',
    '/song/%0d%0a',
    '/a\u0000b'
  ])('rejects path %j', (path) => {
    const result = parseDeepLink(`suno-desktop://open?path=${encodeURIComponent(path)}`)
    if (result.kind === 'open') {
      // Encoded control characters stay percent-encoded and harmless inside suno.com.
      expect(new URL(result.url).origin).toBe('https://suno.com')
    } else {
      expect(result.kind).toBe('invalid')
    }
  })

  it('rejects raw control characters and protocol-relative paths outright', () => {
    expect(resolveSunoPath('//evil.example')).toBeNull()
    expect(resolveSunoPath('/a\nb')).toBeNull()
    expect(resolveSunoPath('/\\evil')).toBeNull()
    expect(resolveSunoPath('')).toBeNull()
    expect(resolveSunoPath(`/${'a'.repeat(2000)}`)).toBeNull()
  })

  it('parses reserved plugin links without acting on them', () => {
    expect(parseDeepLink('suno-desktop://plugin/install?id=style-recs&v=1')).toEqual({
      kind: 'plugin',
      action: 'install',
      params: { id: 'style-recs', v: '1' }
    })
  })

  it('parses reserved theme links without acting on them', () => {
    expect(parseDeepLink('suno-desktop://theme/install?id=midnight')).toEqual({
      kind: 'theme',
      action: 'install',
      params: { id: 'midnight' }
    })
  })

  it.each([
    ['suno-desktop://theme', 'bad theme action'],
    ['suno-desktop://plugin', 'bad plugin action'],
    ['suno-desktop://plugin/Bad_Action!', 'bad plugin action'],
    ['suno-desktop://plugin/a/b', 'bad plugin action'],
    ['suno-desktop://settings', 'unknown route "settings"'],
    ['suno-desktop://', 'missing route'],
    ['https://suno.com/', 'wrong scheme'],
    ['suno-desktop://open/song/xyz', 'unexpected path after open'],
    ['suno-desktop://user:pw@open', 'unexpected URL parts'],
    ['nonsense', 'not a URL']
  ])('rejects %s', (link, reason) => {
    expect(parseDeepLink(link)).toEqual({ kind: 'invalid', reason })
  })

  it('normalizes dot segments before routing', () => {
    // The URL parser collapses `..`, so traversal can never reach another route.
    expect(parseDeepLink('suno-desktop://plugin/../../x')).toMatchObject({ action: 'x' })
  })

  it('rejects oversized links and parameters', () => {
    expect(parseDeepLink(`suno-desktop://open?path=/${'a'.repeat(3000)}`).kind).toBe('invalid')
    const many = Array.from({ length: 25 }, (_, i) => `k${i}=v`).join('&')
    expect(parseDeepLink(`suno-desktop://plugin/install?${many}`)).toEqual({
      kind: 'invalid',
      reason: 'too many parameters'
    })
  })
})

describe('findDeepLinkArg', () => {
  it('finds the link among Chromium switches', () => {
    const argv = [
      'C:\\Program Files\\Suno Desktop\\Suno Desktop.exe',
      '--allow-file-access-from-files',
      'suno-desktop://open?path=/song/1'
    ]
    expect(findDeepLinkArg(argv)).toBe('suno-desktop://open?path=/song/1')
  })

  it('returns undefined when there is none', () => {
    expect(findDeepLinkArg(['app.exe', '--hidden'])).toBeUndefined()
  })
})
