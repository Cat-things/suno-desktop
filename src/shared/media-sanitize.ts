import type { Artwork, MediaSnapshot, PlaybackState, PositionInfo, SongInfo } from './media'

/**
 * Turns the untrusted snapshot posted by the page-world hook into a bounded `MediaSnapshot`.
 * Runs in the preload, before anything is forwarded to main (which validates again).
 */

const MAX_TEXT = 512
const MAX_ARTWORK = 16
const MAX_URL = 2048

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : null
}

function artwork(value: unknown): Artwork[] {
  if (!Array.isArray(value)) return []
  const out: Artwork[] = []
  for (const item of value.slice(0, MAX_ARTWORK)) {
    if (!isRecord(item)) continue
    const src = item['src']
    if (typeof src !== 'string' || src.length > MAX_URL || !src.startsWith('https://')) continue
    const entry: { src: string; sizes?: string; type?: string } = { src }
    if (typeof item['sizes'] === 'string') entry.sizes = item['sizes'].slice(0, 64)
    if (typeof item['type'] === 'string') entry.type = item['type'].slice(0, 64)
    out.push(entry)
  }
  return out
}

function song(value: unknown): SongInfo | null {
  if (!isRecord(value)) return null
  const info: SongInfo = {
    title: text(value['title']),
    artist: text(value['artist']),
    album: text(value['album']),
    artwork: artwork(value['artwork'])
  }
  return info.title === '' && info.artist === '' ? null : info
}

function position(value: unknown): PositionInfo | null {
  if (!isRecord(value)) return null
  const duration = finite(value['duration'], 0, 86_400)
  const pos = finite(value['position'], 0, 86_400)
  const rate = finite(value['playbackRate'], 0, 16)
  if (duration === null || pos === null || duration === 0) return null
  return { duration, position: Math.min(pos, duration), playbackRate: rate ?? 1 }
}

function playbackState(value: unknown): PlaybackState {
  return value === 'playing' || value === 'paused' ? value : 'none'
}

export function toMediaSnapshot(raw: unknown): MediaSnapshot | null {
  if (!isRecord(raw)) return null
  return {
    song: song(raw['song']),
    playbackState: playbackState(raw['playbackState']),
    position: position(raw['position']),
    canGoNext: raw['canGoNext'] === true,
    canGoPrevious: raw['canGoPrevious'] === true
  }
}

/** Seconds of drift between expected and reported position that count as a seek. */
const SEEK_TOLERANCE = 2

/**
 * Whether `next` is worth forwarding. Position naturally advances while playing, so only a
 * jump away from the expected position (a seek) counts as a change.
 */
export function isSignificantChange(
  prev: MediaSnapshot | null,
  prevAtMs: number,
  next: MediaSnapshot,
  nextAtMs: number
): boolean {
  if (!prev) return true
  const { position: a, ...restA } = prev
  const { position: b, ...restB } = next
  if (JSON.stringify(restA) !== JSON.stringify(restB)) return true
  if (!a || !b) return a !== b
  if (a.duration !== b.duration || a.playbackRate !== b.playbackRate) return true
  const elapsed =
    prev.playbackState === 'playing' ? ((nextAtMs - prevAtMs) / 1000) * a.playbackRate : 0
  return Math.abs(a.position + elapsed - b.position) > SEEK_TOLERANCE
}
