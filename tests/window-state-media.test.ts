import { describe, expect, it } from 'vitest'
import { pickArtwork, songKey, songShareUrl } from '../src/shared/media'
import { DEFAULT_WINDOW_STATE, fitToDisplays, parseWindowState } from '../src/shared/window-state'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }

describe('window state', () => {
  it('parses valid state and falls back on garbage', () => {
    expect(parseWindowState({ x: 10, y: 20, width: 1000, height: 700, maximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 1000,
      height: 700,
      maximized: true
    })
    expect(parseWindowState({ width: 'big' })).toEqual(DEFAULT_WINDOW_STATE)
    expect(parseWindowState(null)).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps positions that are on screen', () => {
    const state = { x: 100, y: 100, width: 1200, height: 800, maximized: false }
    expect(fitToDisplays(state, [primary], primary)).toEqual(state)
  })

  it('drops positions on a monitor that is gone', () => {
    const state = { x: 2500, y: 100, width: 1200, height: 800, maximized: false }
    expect(fitToDisplays(state, [primary], primary)).toEqual({
      width: 1200,
      height: 800,
      maximized: false
    })
  })

  it('keeps positions on a secondary monitor', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1400 }
    const state = { x: 2500, y: 100, width: 1200, height: 800, maximized: true }
    expect(fitToDisplays(state, [primary, second], primary)).toEqual(state)
  })

  it('shrinks windows larger than the primary work area', () => {
    const state = { width: 4000, height: 3000, maximized: false }
    expect(fitToDisplays(state, [primary], primary)).toEqual({
      width: 1920,
      height: 1040,
      maximized: false
    })
  })
})

describe('media helpers', () => {
  it('picks the largest https artwork', () => {
    expect(
      pickArtwork([
        { src: 'https://a/small.jpg', sizes: '96x96' },
        { src: 'blob:https://suno.com/x', sizes: '2048x2048' },
        { src: 'https://a/big.jpg', sizes: '512x512 1024x1024' }
      ])
    ).toBe('https://a/big.jpg')
    expect(pickArtwork([])).toBeUndefined()
  })

  it('derives a share URL', () => {
    expect(
      songShareUrl('https://suno.com/song/0F0F0F0F-1111-2222-3333-444444444444', undefined)
    ).toBe('https://suno.com/song/0F0F0F0F-1111-2222-3333-444444444444')
    expect(
      songShareUrl(
        'https://suno.com/create',
        'https://cdn2.suno.ai/image_0f0f0f0f-1111-2222-3333-444444444444.jpeg'
      )
    ).toBe('https://suno.com/song/0f0f0f0f-1111-2222-3333-444444444444')
    expect(songShareUrl('https://evil.example/song/x', 'https://evil.example/image_x.jpg')).toBe(
      'https://suno.com/'
    )
    expect(songShareUrl('not a url', undefined)).toBe('https://suno.com/')
  })

  it('keys songs by title, artist and album', () => {
    expect(songKey(null)).toBe('')
    expect(songKey({ title: 'a', artist: 'b', album: '', artwork: [] })).not.toBe(
      songKey({ title: 'a', artist: 'c', album: '', artwork: [] })
    )
  })
})
