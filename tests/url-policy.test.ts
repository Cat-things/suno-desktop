import { describe, expect, it } from 'vitest'
import {
  classifyNavigation,
  classifyPopup,
  isAuthUrl,
  isFirstPartyUrl,
  isSafeExternalUrl,
  isSunoAppUrl
} from '../src/shared/url-policy'

describe('classifyNavigation', () => {
  it.each([
    'https://suno.com/',
    'https://suno.com/create',
    'https://suno.com/song/1a2b3c4d-0000-0000-0000-000000000000',
    'https://auth.suno.com/v1/oauth_callback?code=x',
    'https://suno.ai/',
    'about:blank'
  ])('keeps first-party page %s in the app', (url) => {
    expect(classifyNavigation(url)).toBe('allow')
  })

  it.each([
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://appleid.apple.com/auth/authorize?client_id=x',
    'https://discord.com/oauth2/authorize?client_id=1',
    'https://discord.com/login?redirect_to=%2Foauth2%2Fauthorize',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'https://login.live.com/oauth20_authorize.srf',
    'https://www.facebook.com/v19.0/dialog/oauth?client_id=1',
    'https://www.facebook.com/login.php?skip_api_login=1',
    'https://access.line.me/oauth2/v2.1/authorize?client_id=1'
  ])('keeps auth provider %s in the app', (url) => {
    expect(classifyNavigation(url)).toBe('allow')
  })

  it.each([
    'https://discord.com/invite/suno',
    'https://discord.gg/suno',
    'https://www.facebook.com/suno',
    'https://www.google.com/search?q=suno',
    'https://twitter.com/SunoMusic',
    'https://checkout.stripe.com/c/pay/cs_test',
    'http://suno.com/',
    'mailto:support@suno.com'
  ])('sends %s to the default browser', (url) => {
    expect(classifyNavigation(url)).toBe('external')
  })

  it.each([
    'https://cdn1.suno.ai/0f0f0f0f-0000-0000-0000-000000000000.mp3',
    'https://cdn1.suno.ai/video.MP4',
    'https://cdn2.suno.ai/image_large_0f0f0f0f-0000-0000-0000-000000000000.jpeg'
  ])('downloads first-party media %s', (url) => {
    expect(classifyNavigation(url)).toBe('download')
  })

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'ms-settings:privacy',
    'not a url',
    'https://suno.com@evil.example/',
    'https://user:pass@suno.com/'
  ])('blocks %s', (url) => {
    expect(classifyNavigation(url)).toBe('block')
  })

  it('does not treat lookalike domains as first party', () => {
    expect(classifyNavigation('https://suno.com.evil.example/')).toBe('external')
    expect(classifyNavigation('https://evilsuno.com/')).toBe('external')
    expect(classifyNavigation('https://accounts.google.com.evil.example/')).toBe('external')
  })

  it('does not keep non-default ports in the app', () => {
    expect(isFirstPartyUrl('https://suno.com:8443/')).toBe(false)
    expect(isAuthUrl('https://accounts.google.com:444/')).toBe(false)
  })
})

describe('classifyPopup', () => {
  it('opens OAuth providers as child windows', () => {
    expect(classifyPopup('https://appleid.apple.com/auth/authorize', 'new-window')).toBe('popup')
    expect(classifyPopup('https://accounts.google.com/o/oauth2/auth', 'foreground-tab')).toBe(
      'popup'
    )
  })

  it('allows blank scripted popups that navigate later', () => {
    expect(classifyPopup('about:blank', 'new-window')).toBe('popup')
    expect(classifyPopup('', 'new-window')).toBe('popup')
    expect(classifyPopup('about:blank', 'foreground-tab')).toBe('block')
  })

  it('loads first-party target=_blank links in the main view', () => {
    expect(classifyPopup('https://suno.com/song/abc', 'foreground-tab')).toBe('navigate')
    expect(classifyPopup('https://suno.com/song/abc', 'background-tab')).toBe('navigate')
    expect(classifyPopup('https://suno.com/popup', 'new-window')).toBe('popup')
  })

  it('sends other links to the browser and drops unsafe ones', () => {
    expect(classifyPopup('https://x.com/intent/tweet?text=hi', 'new-window')).toBe('external')
    expect(classifyPopup('file:///etc/passwd', 'new-window')).toBe('block')
    expect(classifyPopup('https://cdn1.suno.ai/a.mp3', 'foreground-tab')).toBe('download')
  })
})

describe('helpers', () => {
  it('only exposes the bridge on suno.com', () => {
    expect(isSunoAppUrl('https://suno.com/create')).toBe(true)
    expect(isSunoAppUrl('https://studio.suno.com/')).toBe(true)
    expect(isSunoAppUrl('https://cdn1.suno.ai/')).toBe(false)
    expect(isSunoAppUrl('http://suno.com/')).toBe(false)
    expect(isSunoAppUrl('https://accounts.google.com/')).toBe(false)
  })

  it('accepts only http(s) and mailto for openExternal', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true)
    expect(isSafeExternalUrl('smb://server/share')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/')).toBe(false)
    expect(isSafeExternalUrl('https://a:b@example.com')).toBe(false)
  })
})
