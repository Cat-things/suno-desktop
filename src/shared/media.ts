/** Media state reported by the suno.com preload. Types only plus small pure helpers. */

export type PlaybackState = 'none' | 'paused' | 'playing'

export type MediaCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous'

export interface Artwork {
  readonly src: string
  readonly sizes?: string
  readonly type?: string
}

export interface SongInfo {
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly artwork: readonly Artwork[]
}

export interface PositionInfo {
  /** Seconds. */
  readonly duration: number
  /** Seconds. */
  readonly position: number
  readonly playbackRate: number
}

export interface MediaSnapshot {
  readonly song: SongInfo | null
  readonly playbackState: PlaybackState
  readonly position: PositionInfo | null
  /** Whether the page registered next/previous handlers (controls whether buttons are enabled). */
  readonly canGoNext: boolean
  readonly canGoPrevious: boolean
}

export const EMPTY_MEDIA_SNAPSHOT: MediaSnapshot = {
  song: null,
  playbackState: 'none',
  position: null,
  canGoNext: false,
  canGoPrevious: false
}

export function songKey(song: SongInfo | null): string {
  return song ? JSON.stringify([song.title, song.artist, song.album]) : ''
}

/** Picks the largest artwork entry, preferring https sources. */
export function pickArtwork(artwork: readonly Artwork[]): string | undefined {
  const size = (a: Artwork): number => {
    const sizes = (a.sizes ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]))
    return Math.max(0, ...sizes.filter((n) => Number.isFinite(n)))
  }
  const https = artwork.filter((a) => a.src.startsWith('https://'))
  const sorted = [...https].sort((a, b) => size(b) - size(a))
  return sorted[0]?.src
}

const SONG_PATH = /^\/song\/([0-9a-f-]{36})\/?$/i
const COVER_ID =
  /\/image_(?:large_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z]+$/i

/**
 * Best-effort public link for the current song, used for the Discord "Listen on Suno" button.
 * Uses the page URL when it is a song page, then the cover file name (Suno names covers after
 * the clip id), and falls back to the home page. No Suno API is involved.
 */
export function songShareUrl(pageUrl: string | undefined, artworkUrl: string | undefined): string {
  const fallback = 'https://suno.com/'
  try {
    if (pageUrl) {
      const page = new URL(pageUrl)
      const match = SONG_PATH.exec(page.pathname)
      if (page.hostname === 'suno.com' && match?.[1]) return `https://suno.com/song/${match[1]}`
    }
    if (artworkUrl) {
      const art = new URL(artworkUrl)
      const match = COVER_ID.exec(art.pathname)
      if (art.hostname.endsWith('.suno.ai') && match?.[1]) {
        return `https://suno.com/song/${match[1].toLowerCase()}`
      }
    }
  } catch {
    return fallback
  }
  return fallback
}
