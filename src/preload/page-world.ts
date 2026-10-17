/**
 * Installs `window.sunoDesktop` (and, in the page's main world, a navigator.mediaSession hook).
 *
 * This function is serialized and executed in another JavaScript world via
 * `contextBridge.executeInMainWorld` / `webFrame.executeJavaScriptInIsolatedWorld`. It must stay
 * self-contained: no imports, no references to anything outside its own body.
 *
 * Communication with the preload uses DOM CustomEvents whose names are random per page load, so
 * page scripts cannot listen in or inject messages. Payloads are JSON strings (primitives are the
 * only values that cross worlds unchanged).
 */

export interface PageWorldOptions {
  readonly info: {
    readonly version: string
    readonly apiVersion: number
    readonly platform: string
    readonly capabilities: readonly string[]
  }
  readonly events: readonly string[]
  readonly channels: {
    /** preload -> world: `{ event, payload }` bridge events. */
    readonly bridge: string
    /** world -> preload: raw media snapshots (main world only). */
    readonly state?: string
    /** preload -> world: media commands (main world only). */
    readonly command?: string
  }
}

/* eslint-disable @typescript-eslint/unbound-method --
 * Built-ins are captured before page scripts can patch them and are always invoked via .call().
 */
export function installPageWorld(options: PageWorldOptions): void {
  'use strict'
  const w = window
  if (Object.prototype.hasOwnProperty.call(w, 'sunoDesktop')) return

  // Capture built-ins before page scripts get a chance to patch them.
  const stringify = JSON.stringify
  const parse = JSON.parse
  const freeze = Object.freeze
  const listen = EventTarget.prototype.addEventListener
  const dispatch = EventTarget.prototype.dispatchEvent
  const CustomEventCtor = CustomEvent
  const consoleError = console.error.bind(console)

  type Listener = (payload: unknown) => void
  const known = new Set(options.events)
  const listeners = new Map<string, Set<Listener>>()
  const onceWrappers = new WeakMap<Listener, Listener>()

  const assertEvent = (event: unknown): string => {
    if (typeof event !== 'string' || !known.has(event)) {
      throw new TypeError(`sunoDesktop: unknown event "${String(event)}"`)
    }
    return event
  }
  const off = (event: unknown, listener: Listener): void => {
    const set = listeners.get(assertEvent(event))
    if (!set) return
    set.delete(listener)
    const wrapper = onceWrappers.get(listener)
    if (wrapper) set.delete(wrapper)
  }
  const on = (event: unknown, listener: unknown): (() => void) => {
    const name = assertEvent(event)
    if (typeof listener !== 'function')
      throw new TypeError('sunoDesktop: listener must be a function')
    const fn = listener as Listener
    let set = listeners.get(name)
    if (!set) {
      set = new Set()
      listeners.set(name, set)
    }
    set.add(fn)
    return () => {
      off(name, fn)
    }
  }
  const once = (event: unknown, listener: unknown): (() => void) => {
    if (typeof listener !== 'function')
      throw new TypeError('sunoDesktop: listener must be a function')
    const fn = listener as Listener
    const wrapper: Listener = (payload) => {
      off(event, fn)
      fn(payload)
    }
    onceWrappers.set(fn, wrapper)
    const name = assertEvent(event)
    let set = listeners.get(name)
    if (!set) {
      set = new Set()
      listeners.set(name, set)
    }
    set.add(wrapper)
    return () => {
      off(name, fn)
    }
  }
  const emit = (event: string, payload: unknown): void => {
    const set = listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch (error) {
        consoleError(`[sunoDesktop] "${event}" listener failed`, error)
      }
    }
  }
  const deepFreeze = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
      freeze(value)
    }
    return value
  }

  const bridge = freeze({
    version: options.info.version,
    apiVersion: options.info.apiVersion,
    platform: options.info.platform,
    capabilities: freeze([...options.info.capabilities]),
    on,
    off,
    once
  })
  Object.defineProperty(w, 'sunoDesktop', {
    value: bridge,
    enumerable: false,
    configurable: false,
    writable: false
  })

  listen.call(w, options.channels.bridge, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (typeof detail !== 'string') return
    let message: unknown
    try {
      message = parse(detail)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    const { event: name, payload } = message as { event?: unknown; payload?: unknown }
    if (typeof name === 'string' && known.has(name)) emit(name, deepFreeze(payload))
  })

  const stateChannel = options.channels.state
  const commandChannel = options.channels.command
  if (stateChannel === undefined || commandChannel === undefined) return
  const session = navigator.mediaSession as MediaSession | undefined
  if (!session) return

  // --- navigator.mediaSession hook (main world only) ---------------------------------------
  const proto = Object.getPrototypeOf(session) as MediaSession
  const handlers = new Map<string, MediaSessionActionHandler>()
  const tracked = new WeakSet<HTMLMediaElement>()
  let active: HTMLMediaElement | null = null
  let position: { state: MediaPositionState; at: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const audible = (el: HTMLMediaElement): boolean => !el.muted && el.volume > 0

  const snapshot = (): unknown => {
    const meta = session.metadata
    const media = active
    const mediaPlaying = media !== null && !media.paused && !media.ended
    const declared = session.playbackState
    const state =
      declared !== 'none' ? declared : media ? (mediaPlaying ? 'playing' : 'paused') : 'none'
    let pos: unknown = null
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      pos = {
        duration: media.duration,
        position: media.currentTime,
        playbackRate: media.playbackRate
      }
    } else if (position?.state.duration) {
      const rate = position.state.playbackRate ?? 1
      const elapsed = state === 'playing' ? ((Date.now() - position.at) / 1000) * rate : 0
      pos = {
        duration: position.state.duration,
        position: Math.min(position.state.duration, (position.state.position ?? 0) + elapsed),
        playbackRate: rate
      }
    }
    return {
      song: meta
        ? {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            artwork: [...meta.artwork].map((a) => ({ src: a.src, sizes: a.sizes, type: a.type }))
          }
        : null,
      playbackState: state,
      position: pos,
      canGoNext: handlers.has('nexttrack'),
      canGoPrevious: handlers.has('previoustrack')
    }
  }

  const report = (): void => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      try {
        dispatch.call(w, new CustomEventCtor(stateChannel, { detail: stringify(snapshot()) }))
      } catch (error) {
        consoleError('[sunoDesktop] media snapshot failed', error)
      }
    }, 100)
  }

  const nativeSetActionHandler = proto.setActionHandler
  Object.defineProperty(session, 'setActionHandler', {
    configurable: true,
    writable: true,
    value: function setActionHandler(
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ): void {
      nativeSetActionHandler.call(session, action, handler)
      if (handler) handlers.set(action, handler)
      else handlers.delete(action)
      report()
    }
  })

  const nativeSetPositionState = proto.setPositionState
  Object.defineProperty(session, 'setPositionState', {
    configurable: true,
    writable: true,
    value: function setPositionState(state?: MediaPositionState): void {
      nativeSetPositionState.call(session, state)
      position = state?.duration ? { state: { ...state }, at: Date.now() } : null
      report()
    }
  })

  for (const prop of ['metadata', 'playbackState'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop)
    if (!descriptor?.get || !descriptor.set) continue
    const { get, set } = descriptor
    Object.defineProperty(session, prop, {
      configurable: true,
      enumerable: true,
      get() {
        return get.call(session) as unknown
      },
      set(value: unknown) {
        set.call(session, value)
        report()
      }
    })
  }

  const mediaEvents = [
    'play',
    'playing',
    'pause',
    'ended',
    'emptied',
    'loadedmetadata',
    'durationchange',
    'seeked',
    'ratechange',
    'volumechange'
  ]
  const onMediaEvent = (event: Event): void => {
    const el = event.target
    if (!(el instanceof HTMLMediaElement)) return
    if ((event.type === 'play' || event.type === 'playing') && audible(el)) active = el
    report()
  }
  for (const type of mediaEvents) listen.call(document, type, onMediaEvent, true)

  // Audio elements that never join the DOM do not dispatch through `document`.
  const nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement): Promise<void> {
    if (!this.isConnected && !tracked.has(this)) {
      tracked.add(this)
      for (const type of mediaEvents) listen.call(this, type, onMediaEvent)
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- remembering the playing element
    if (audible(this)) active = this
    report()
    return nativePlay.call(this)
  }

  const isPlaying = (): boolean =>
    session.playbackState === 'playing' || (active !== null && !active.paused && !active.ended)

  listen.call(w, commandChannel, (event: Event) => {
    const command = (event as CustomEvent<unknown>).detail
    const action =
      command === 'toggle'
        ? isPlaying()
          ? 'pause'
          : 'play'
        : command === 'play' || command === 'pause'
          ? command
          : command === 'next'
            ? 'nexttrack'
            : command === 'previous'
              ? 'previoustrack'
              : null
    if (action === null) return
    const handler = handlers.get(action)
    if (handler) {
      try {
        handler({ action })
      } catch (error) {
        consoleError(`[sunoDesktop] media handler "${action}" failed`, error)
      }
      return
    }
    // No handler registered: drive the audible media element like Chromium's default action does.
    if (active && action === 'play') active.play().catch(() => undefined)
    if (active && action === 'pause') active.pause()
  })

  // MediaMetadata fields can be mutated in place without hitting a setter.
  setInterval(report, 2000)
}
/* eslint-enable @typescript-eslint/unbound-method */
