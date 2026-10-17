import { describe, expect, it } from 'vitest'
import type { MediaSnapshot } from '../src/shared/media'
import { isSignificantChange, toMediaSnapshot } from '../src/shared/media-sanitize'

const base: MediaSnapshot = {
  song: { title: 'Neon Rain', artist: 'Lamp', album: '', artwork: [] },
  playbackState: 'playing',
  position: { duration: 180, position: 10, playbackRate: 1 },
  canGoNext: true,
  canGoPrevious: false
}

describe('toMediaSnapshot', () => {
  it('keeps well-formed snapshots', () => {
    expect(toMediaSnapshot(base)).toEqual(base)
  })

  it('rejects non-objects', () => {
    expect(toMediaSnapshot(null)).toBeNull()
    expect(toMediaSnapshot('x')).toBeNull()
    expect(toMediaSnapshot([])).toBeNull()
  })

  it('bounds strings and filters artwork to https', () => {
    const snapshot = toMediaSnapshot({
      ...base,
      song: {
        title: 'x'.repeat(2000),
        artist: 42,
        album: null,
        artwork: [
          { src: 'javascript:alert(1)' },
          { src: 'blob:https://suno.com/1' },
          { src: `https://a/${'y'.repeat(3000)}` },
          { src: 'https://cdn2.suno.ai/a.jpg', sizes: '512x512', type: 'image/jpeg', extra: 1 },
          'garbage'
        ]
      }
    })
    expect(snapshot?.song?.title).toHaveLength(512)
    expect(snapshot?.song?.artist).toBe('')
    expect(snapshot?.song?.artwork).toEqual([
      { src: 'https://cdn2.suno.ai/a.jpg', sizes: '512x512', type: 'image/jpeg' }
    ])
  })

  it('normalizes state, booleans and positions', () => {
    const snapshot = toMediaSnapshot({
      song: { title: '', artist: '' },
      playbackState: 'exploding',
      position: { duration: Number.POSITIVE_INFINITY, position: 1, playbackRate: 1 },
      canGoNext: 'yes',
      canGoPrevious: 1
    })
    expect(snapshot).toEqual({
      song: null,
      playbackState: 'none',
      position: null,
      canGoNext: false,
      canGoPrevious: false
    })
    expect(
      toMediaSnapshot({ ...base, position: { duration: 100, position: 500, playbackRate: 99 } })
        ?.position
    ).toEqual({ duration: 100, position: 100, playbackRate: 16 })
  })
})

describe('isSignificantChange', () => {
  it('reports the first snapshot and real changes', () => {
    expect(isSignificantChange(null, 0, base, 0)).toBe(true)
    expect(isSignificantChange(base, 0, { ...base, playbackState: 'paused' }, 100)).toBe(true)
    expect(isSignificantChange(base, 0, { ...base, canGoPrevious: true }, 100)).toBe(true)
  })

  it('ignores position advancing at the playback rate', () => {
    const later = { ...base, position: { duration: 180, position: 15, playbackRate: 1 } }
    expect(isSignificantChange(base, 0, later, 5000)).toBe(false)
  })

  it('reports seeks', () => {
    const seeked = { ...base, position: { duration: 180, position: 90, playbackRate: 1 } }
    expect(isSignificantChange(base, 0, seeked, 5000)).toBe(true)
  })

  it('treats position as frozen while paused', () => {
    const paused = { ...base, playbackState: 'paused' as const }
    expect(isSignificantChange(paused, 0, paused, 60_000)).toBe(false)
  })
})
