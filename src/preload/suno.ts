/**
 * Preload for the suno.com view. Runs sandboxed with context isolation: page scripts never see
 * Node or ipcRenderer. It installs the read-only `window.sunoDesktop` bridge and relays
 * navigator.mediaSession state to main for SMTC extras, the tray, thumbnail buttons and Discord.
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { BRIDGE_CAPABILITIES, BRIDGE_EVENTS, type BridgeEventName } from '../shared/bridge'
import { BRIDGE_API_VERSION, PLUGIN_WORLD_ID } from '../shared/constants'
import { IPC } from '../shared/ipc-channels'
import { songKey, type MediaCommand, type MediaSnapshot } from '../shared/media'
import { isSignificantChange, toMediaSnapshot } from '../shared/media-sanitize'
import { isSunoAppUrl } from '../shared/url-policy'
import { installPageWorld, type PageWorldOptions } from './page-world'

const MEDIA_COMMANDS: readonly MediaCommand[] = ['play', 'pause', 'toggle', 'next', 'previous']

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function randomChannel(kind: string): string {
  return `sunoDesktop:${kind}:${crypto.randomUUID()}`
}

function start(): void {
  const channels = {
    bridge: randomChannel('bridge'),
    state: randomChannel('state'),
    command: randomChannel('command')
  }
  const info: PageWorldOptions['info'] = {
    version: argValue('suno-desktop-version') ?? '0.0.0',
    apiVersion: BRIDGE_API_VERSION,
    platform: process.platform,
    capabilities: [...BRIDGE_CAPABILITIES]
  }

  // Page world: bridge + media hook. Runs synchronously, before any suno.com script.
  contextBridge.executeInMainWorld({
    func: installPageWorld,
    args: [{ info, events: BRIDGE_EVENTS, channels } satisfies PageWorldOptions]
  })

  // Plugin world (see docs/PLUGIN_HOOKS.md): bridge only, no media hook.
  const pluginOptions: PageWorldOptions = {
    info,
    events: BRIDGE_EVENTS,
    channels: { bridge: channels.bridge }
  }
  webFrame.setIsolatedWorldInfo(PLUGIN_WORLD_ID, { name: 'Suno Desktop plugins' })
  void webFrame.executeJavaScriptInIsolatedWorld(PLUGIN_WORLD_ID, [
    { code: `(${installPageWorld.toString()})(${JSON.stringify(pluginOptions)})` }
  ])

  const broadcast = (event: BridgeEventName, payload: unknown): void => {
    window.dispatchEvent(
      new CustomEvent(channels.bridge, { detail: JSON.stringify({ event, payload }) })
    )
  }

  let last: MediaSnapshot | null = null
  let lastAt = 0
  window.addEventListener(channels.state, (event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (typeof detail !== 'string' || detail.length > 64 * 1024) return
    let snapshot: MediaSnapshot | null
    try {
      snapshot = toMediaSnapshot(JSON.parse(detail))
    } catch {
      return
    }
    if (!snapshot) return
    const now = Date.now()
    if (!isSignificantChange(last, lastAt, snapshot, now)) return
    const previous = last
    last = snapshot
    lastAt = now
    if (songKey(previous?.song ?? null) !== songKey(snapshot.song)) {
      broadcast('songChanged', snapshot.song)
    }
    if ((previous?.playbackState ?? 'none') !== snapshot.playbackState) {
      broadcast('playbackStateChanged', { state: snapshot.playbackState })
    }
    ipcRenderer.send(IPC.mediaUpdate, snapshot)
  })

  ipcRenderer.on(IPC.mediaCommand, (_event, command: unknown) => {
    if (typeof command !== 'string' || !MEDIA_COMMANDS.includes(command as MediaCommand)) return
    window.dispatchEvent(new CustomEvent(channels.command, { detail: command }))
  })

  ipcRenderer.on(IPC.bridgeEvent, (_event, message: unknown) => {
    if (typeof message !== 'object' || message === null) return
    const { event, payload } = message as { event?: unknown; payload?: unknown }
    if (typeof event === 'string' && BRIDGE_EVENTS.includes(event as BridgeEventName)) {
      broadcast(event as BridgeEventName, payload)
    }
  })

  // Full page loads; client-side navigations arrive from main via `did-navigate-in-page`.
  window.addEventListener('DOMContentLoaded', () => {
    broadcast('routeChanged', { url: location.href, path: location.pathname })
  })
}

// The same preload runs if the view navigates to a login provider; only suno.com gets the bridge.
if (isSunoAppUrl(location.href)) start()
