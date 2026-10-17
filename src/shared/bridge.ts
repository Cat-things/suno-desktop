/**
 * Contract of `window.sunoDesktop`, the page-side bridge exposed on suno.com.
 * Suno++ checks for it to tell the desktop app apart from a browser. Read-only by design:
 * nothing here lets page scripts reach Node or privileged app features.
 */

import type { PlaybackState, SongInfo } from './media'

export interface BridgeEventMap {
  /** Fired on full loads and on client-side (pushState/replaceState/popstate) navigations. */
  routeChanged: { readonly url: string; readonly path: string }
  /** Fired when `navigator.mediaSession.metadata` changes. `null` when nothing is loaded. */
  songChanged: SongInfo | null
  playbackStateChanged: { readonly state: PlaybackState }
}

export type BridgeEventName = keyof BridgeEventMap

export const BRIDGE_EVENTS: readonly BridgeEventName[] = [
  'routeChanged',
  'songChanged',
  'playbackStateChanged'
]

/**
 * Feature flags for Suno++. Add a capability whenever the bridge grows; never remove one
 * without bumping `BRIDGE_API_VERSION`.
 */
export const BRIDGE_CAPABILITIES = [
  'desktop',
  'events.routeChanged',
  'events.songChanged',
  'events.playbackStateChanged'
] as const

export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number]

export type BridgeListener<E extends BridgeEventName> = (payload: BridgeEventMap[E]) => void

export interface SunoDesktopBridge {
  /** App version, e.g. "0.1.0". */
  readonly version: string
  /** Bridge contract version (see `BRIDGE_API_VERSION`). */
  readonly apiVersion: number
  /** Node-style platform string, e.g. "win32". */
  readonly platform: string
  readonly capabilities: readonly string[]
  /** Subscribes to an event and returns an unsubscribe function. */
  on<E extends BridgeEventName>(event: E, listener: BridgeListener<E>): () => void
  off<E extends BridgeEventName>(event: E, listener: BridgeListener<E>): void
  once<E extends BridgeEventName>(event: E, listener: BridgeListener<E>): () => void
}
