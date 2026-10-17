import { pickArtwork, songShareUrl, type MediaSnapshot } from '../../../shared/media'

/** Rich Presence payload for SET_ACTIVITY. Field limits follow Discord's documentation. */
export interface DiscordActivity {
  type: 2
  details: string
  state?: string
  timestamps?: { start: number; end?: number }
  assets?: { large_image?: string; large_text?: string }
  buttons?: { label: string; url: string }[]
  instance: false
}

/** Asset key used when a song has no https cover. Upload an image with this key in the Discord portal. */
export const FALLBACK_ASSET = 'logo'

const MAX_TEXT = 128
const MAX_IMAGE_URL = 256
const MAX_BUTTON_URL = 512

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Trims to `max` UTF-16 units (the strictest way Discord could count) without splitting a
 * grapheme, and pads to the 2-character minimum Discord enforces with an invisible braille blank.
 */
function fit(text: string, max = MAX_TEXT): string {
  const trimmed = text.trim()
  let out = trimmed
  if (trimmed.length > max) {
    out = ''
    for (const { segment } of graphemes.segment(trimmed)) {
      if (out.length + segment.length > max - 1) break
      out += segment
    }
    out += '…'
  }
  return out.length < 2 ? out.padEnd(2, '\u2800') : out
}

export interface PresenceOptions {
  /** Epoch milliseconds. */
  readonly now: number
  /** URL currently shown in the app, used for the "Listen on Suno" link. */
  readonly pageUrl?: string
}

export function buildActivity(
  snapshot: MediaSnapshot,
  options: PresenceOptions
): DiscordActivity | null {
  const { song, playbackState, position } = snapshot
  if (!song || playbackState === 'none') return null

  const title = song.title.trim() || 'Untitled'
  const artist = song.artist.trim()
  const paused = playbackState === 'paused'
  const byline = artist ? `by ${artist}` : ''
  const state = paused ? (byline ? `Paused · ${byline}` : 'Paused') : byline

  const art = pickArtwork(song.artwork)
  const image = art && art.length <= MAX_IMAGE_URL ? art : FALLBACK_ASSET
  const activity: DiscordActivity = {
    type: 2,
    details: fit(title),
    assets: { large_image: image, large_text: fit(song.album.trim() || title) },
    instance: false
  }
  if (state) activity.state = fit(state)

  if (!paused && position && position.duration > 0) {
    const rate = position.playbackRate > 0 ? position.playbackRate : 1
    const elapsedMs = (position.position / rate) * 1000
    const start = Math.round(options.now - elapsedMs)
    const end = Math.round(start + (position.duration / rate) * 1000)
    activity.timestamps = end > start ? { start, end } : { start }
  }

  const url = songShareUrl(options.pageUrl, art)
  if (url.length <= MAX_BUTTON_URL) activity.buttons = [{ label: 'Listen on Suno', url }]
  return activity
}
