"use strict";
(() => {
  // packages/core/src/match.ts
  var SUNO_ORIGIN = "https://suno.com";
  function isAllowedPattern(pattern) {
    return pattern.startsWith(`${SUNO_ORIGIN}/`) && pattern.length <= 200;
  }
  function toRegExp(pattern) {
    const body = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}$`);
  }
  function matchesUrl(patterns, rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (url.origin !== SUNO_ORIGIN) return false;
    const target = `${url.origin}${url.pathname}${url.search}`;
    return patterns.some((pattern) => isAllowedPattern(pattern) && toRegExp(pattern).test(target));
  }

  // packages/core/src/settings.ts
  var HEX_COLOR = /^#[0-9a-f]{6}$/i;
  function validFor(def, value) {
    switch (def.type) {
      case "boolean":
        return typeof value === "boolean";
      case "string":
        return typeof value === "string" && value.length <= def.maxLength;
      case "number":
        return typeof value === "number" && Number.isFinite(value) && value >= (def.min ?? -Infinity) && value <= (def.max ?? Infinity);
      case "select":
        return typeof value === "string" && def.options.some((o) => o.value === value);
    }
  }
  function resolveSettings(definitions, stored) {
    const source = typeof stored === "object" && stored !== null ? stored : {};
    const out = {};
    for (const def of definitions) {
      const value = source[def.key];
      out[def.key] = validFor(def, value) ? value : def.default;
    }
    return Object.freeze(out);
  }
  function resolveThemeVariables(definitions, stored) {
    const source = typeof stored === "object" && stored !== null ? stored : {};
    const out = {};
    for (const def of definitions) {
      const value = source[def.key];
      out[def.key] = typeof value === "string" && HEX_COLOR.test(value) ? value : def.default;
    }
    return Object.freeze(out);
  }
  function themeVariablesCss(values) {
    const declarations = Object.entries(values).filter(([, value]) => HEX_COLOR.test(value)).map(([key, value]) => `--spp-${key}: ${value};`);
    return declarations.length > 0 ? `:root { ${declarations.join(" ")} }` : "";
  }

  // packages/core/src/index.ts
  var API_VERSION = 1;

  // packages/sdk/src/dom.ts
  function onAbort(signal, stop) {
    if (!signal) return;
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  }
  function observe(target, callback, options = { childList: true, subtree: true }) {
    const { signal, ...init } = options;
    const observer = new MutationObserver(callback);
    observer.observe(target, init);
    const stop = () => {
      observer.disconnect();
    };
    onAbort(signal, stop);
    return stop;
  }

  // packages/sdk/src/index.ts
  function definePlugin(setup) {
    return Object.freeze({ kind: "sunoplusplus.plugin", setup });
  }

  // plugins/now-playing-title/index.ts
  var SYMBOLS = { note: "♪ ", play: "▶ ", none: "" };
  var now_playing_title_default = definePlugin((ctx) => {
    let song = null;
    let playback = "none";
    let sunoTitle = document.title;
    let ours = null;
    const render = () => {
      const visible = song !== null && (playback === "playing" || playback === "paused" && ctx.settings.get("showWhenPaused"));
      if (!song || !visible) {
        if (ours !== null && document.title === ours) document.title = sunoTitle;
        ours = null;
        return;
      }
      const parts = [song.title];
      if (ctx.settings.get("showArtist") && song.artist) parts.push(song.artist);
      const symbol = playback === "paused" ? "❚❚ " : SYMBOLS[ctx.settings.get("symbol")] ?? "";
      const next = `${symbol}${parts.join(" — ")}`;
      if (document.title !== next) {
        ours = next;
        document.title = next;
      }
    };
    const head = document.head;
    if (head) {
      observe(
        head,
        () => {
          if (document.title === ours) return;
          sunoTitle = document.title;
          render();
        },
        { childList: true, subtree: true, characterData: true, signal: ctx.signal }
      );
    }
    ctx.onSongChanged((next) => {
      song = next;
      render();
    });
    ctx.onPlaybackStateChanged((next) => {
      playback = next;
      render();
    });
    ctx.settings.onChange(render);
    return () => {
      if (ours !== null && document.title === ours) document.title = sunoTitle;
    };
  });

  // sunoplusplus:sunoplusplus:catalog
  var catalog = { plugins: [{ manifest: { "manifestVersion": 1, "id": "now-playing-title", "name": "Now playing in the tab title", "description": "Shows the song that's playing in the browser tab (or Suno Desktop's title bar), so you can find it at a glance.", "version": "1.0.0", "authors": [{ "name": "Suno++ team", "github": "Cat-things" }], "license": "MIT", "tags": ["player", "quality-of-life"], "matches": ["https://suno.com/*"], "world": "isolated", "enabledByDefault": false, "settings": [{ "key": "showArtist", "label": "Show the artist", "type": "boolean", "default": true }, { "key": "showWhenPaused", "label": "Keep it while paused", "description": "Otherwise Suno's own title comes back when you pause.", "type": "boolean", "default": false }, { "key": "symbol", "label": "Symbol", "type": "select", "default": "note", "options": [{ "value": "note", "label": "♪ Note" }, { "value": "play", "label": "▶ Play" }, { "value": "none", "label": "None" }] }] }, module: now_playing_title_default }], themes: [{ manifest: { "manifestVersion": 1, "id": "neon-accents", "name": "Neon accents", "description": "Recolors text selection, focus rings, scrollbars, sliders and the text cursor in a color you pick. A small starter theme to build on.", "version": "1.0.0", "authors": [{ "name": "Suno++ team", "github": "Cat-things" }], "license": "MIT", "tags": ["starter", "accent"], "matches": ["https://suno.com/*"], "appearance": "any", "variables": [{ "key": "accent", "label": "Accent", "type": "color", "default": "#ff2e97" }, { "key": "on-accent", "label": "Text on accent", "type": "color", "default": "#ffffff" }] }, css: `/*
 * Neon accents: a starter theme. It only uses selectors that don't depend on Suno's markup,
 * so it keeps working when Suno changes its pages. --spp-accent and --spp-on-accent come from
 * the colors picked in Suno++ (see "variables" in manifest.json).
 */

:root {
  accent-color: var(--spp-accent);
  caret-color: var(--spp-accent);
}

::selection {
  background: var(--spp-accent);
  color: var(--spp-on-accent);
}

:focus-visible {
  outline: 2px solid var(--spp-accent) !important;
  outline-offset: 2px;
}

* {
  scrollbar-color: color-mix(in srgb, var(--spp-accent) 70%, transparent) transparent;
}

input,
textarea,
[contenteditable='true'] {
  caret-color: var(--spp-accent);
}
` }] };

  // packages/runtime/src/host.ts
  var Emitter = class {
    listeners = /* @__PURE__ */ new Set();
    on(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    emit(value) {
      for (const listener of [...this.listeners]) {
        if (!this.listeners.has(listener)) continue;
        try {
          listener(value);
        } catch (error) {
          console.error("[Suno++]", error);
        }
      }
    }
    get size() {
      return this.listeners.size;
    }
  };
  function routeOf(href) {
    const url = new URL(href);
    return Object.freeze({ url: url.href, path: `${url.pathname}${url.search}` });
  }
  function sameArtwork(a, b) {
    return a.length === b.length && a.every((art, i) => art.src === b[i]?.src);
  }
  function sameSong(a, b) {
    if (a === null || b === null) return a === b;
    return a.title === b.title && a.artist === b.artist && a.album === b.album && sameArtwork(a.artwork, b.artwork);
  }
  function readMediaSessionSong() {
    const metadata = typeof navigator === "undefined" ? null : navigator.mediaSession.metadata;
    if (!metadata || !metadata.title && !metadata.artist) return null;
    return Object.freeze({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      artwork: Object.freeze(
        [...metadata.artwork].map(
          (art) => Object.freeze({
            src: art.src,
            ...art.sizes ? { sizes: art.sizes } : {},
            ...art.type ? { type: art.type } : {}
          })
        )
      )
    });
  }

  // packages/runtime/src/state.ts
  var EMPTY_STATE = Object.freeze({
    enabled: Object.freeze({}),
    settings: Object.freeze({}),
    theme: null,
    themeVariables: Object.freeze({})
  });
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function recordOfRecords(value) {
    if (!isRecord(value)) return {};
    const out = {};
    for (const [key, inner] of Object.entries(value)) if (isRecord(inner)) out[key] = { ...inner };
    return out;
  }
  function normalizeState(input) {
    if (!isRecord(input)) return EMPTY_STATE;
    const enabled = {};
    if (isRecord(input.enabled)) {
      for (const [id, on] of Object.entries(input.enabled))
        if (typeof on === "boolean") enabled[id] = on;
    }
    return {
      enabled,
      settings: recordOfRecords(input.settings),
      theme: typeof input.theme === "string" ? input.theme : null,
      themeVariables: recordOfRecords(input.themeVariables)
    };
  }
  function isPluginEnabled(manifest, state2) {
    return state2.enabled[manifest.id] ?? manifest.enabledByDefault;
  }

  // packages/runtime/src/runtime.ts
  var THEME_STYLE_ID = "sunoplusplus-theme";
  function createLogger(scope2) {
    const prefix = `[Suno++ ${scope2}]`;
    return {
      info: (...args) => console.info(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args)
    };
  }
  function sameSettings(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
  }
  function attachStyle(doc, style) {
    const parent = doc.head ?? doc.documentElement;
    if (style.parentNode !== parent || parent.lastElementChild !== style) parent.append(style);
  }
  var PluginInstance = class {
    routes = new Emitter();
    songs = new Emitter();
    playbacks = new Emitter();
    settingsChanges = new Emitter();
    controller = new AbortController();
    cleanups = [];
    log;
    plugin;
    deps;
    settings;
    stopped = false;
    constructor(plugin, deps, settings) {
      this.plugin = plugin;
      this.deps = deps;
      this.settings = settings;
      this.log = createLogger(plugin.manifest.id);
    }
    start() {
      let result;
      try {
        result = this.plugin.module.setup(this.createContext());
      } catch (error) {
        this.log.error("failed to start", error);
        this.stop();
        return;
      }
      if (typeof result === "function") {
        this.cleanups.push(result);
      } else if (result instanceof Promise) {
        result.then(
          (cleanup) => {
            if (typeof cleanup === "function") this.onCleanup(cleanup);
          },
          (error) => {
            this.log.error("failed to start", error);
            this.stop();
          }
        );
      }
    }
    stop() {
      if (this.stopped) return;
      this.stopped = true;
      this.controller.abort();
      for (const cleanup of this.cleanups.splice(0).reverse()) this.run(cleanup);
    }
    updateSettings(next) {
      if (this.stopped || sameSettings(this.settings, next)) return;
      this.settings = next;
      this.settingsChanges.emit(next);
    }
    run(fn) {
      try {
        fn();
      } catch (error) {
        this.log.error(error);
      }
    }
    onCleanup(cleanup) {
      if (this.stopped) this.run(cleanup);
      else this.cleanups.push(cleanup);
    }
    /** Subscribes `listener`, calling it right away with `current` first when given. */
    listen(emitter, listener, current) {
      if (this.stopped) return () => void 0;
      const safe = (value) => this.run(() => listener(value));
      if (current) safe(current());
      const off = emitter.on(safe);
      this.cleanups.push(off);
      return off;
    }
    createContext() {
      const { deps, plugin } = this;
      return Object.freeze({
        id: plugin.manifest.id,
        env: deps.host.env,
        log: this.log,
        signal: this.controller.signal,
        storage: deps.host.storage(plugin.manifest.id),
        settings: Object.freeze({
          get: (key) => {
            const value = this.settings[key];
            if (value === void 0) throw new Error(`"${key}" is not a setting in manifest.json`);
            return value;
          },
          all: () => this.settings,
          onChange: (listener) => this.listen(this.settingsChanges, listener)
        }),
        onRoute: (listener) => this.listen(this.routes, listener, deps.route),
        onSongChanged: (listener) => this.listen(this.songs, listener, deps.song),
        onPlaybackStateChanged: (listener) => this.listen(this.playbacks, listener, deps.playback),
        addStyle: (css) => {
          if (this.stopped) return () => void 0;
          const style = deps.doc.createElement("style");
          style.dataset.sunoplusplusPlugin = plugin.manifest.id;
          style.textContent = css;
          attachStyle(deps.doc, style);
          const remove = () => {
            style.remove();
          };
          this.cleanups.push(remove);
          return remove;
        },
        onCleanup: (cleanup) => this.onCleanup(cleanup)
      });
    }
  };
  var Runtime = class {
    host;
    catalog;
    doc;
    instances = /* @__PURE__ */ new Map();
    subscriptions = [];
    state = EMPTY_STATE;
    route;
    song;
    playback;
    themeStyle = null;
    started = false;
    domReady = false;
    constructor(options) {
      this.host = options.host;
      this.catalog = options.catalog;
      this.doc = options.document ?? document;
      this.route = this.host.currentRoute();
      this.song = this.host.currentSong();
      this.playback = this.host.currentPlayback();
    }
    /** Starts with `state`. Themes apply right away; plugins wait until the DOM is ready. */
    start(state2 = this.state) {
      if (this.started) return;
      this.started = true;
      this.state = state2;
      this.route = this.host.currentRoute();
      this.song = this.host.currentSong();
      this.playback = this.host.currentPlayback();
      this.domReady = this.doc.readyState !== "loading";
      if (!this.domReady) {
        const ready = () => {
          this.domReady = true;
          this.reconcile();
        };
        this.doc.addEventListener("DOMContentLoaded", ready, { once: true });
        this.subscriptions.push(() => this.doc.removeEventListener("DOMContentLoaded", ready));
      }
      this.subscriptions.push(
        this.host.onRoute((route) => this.onRoute(route)),
        this.host.onSong((song) => {
          this.song = song;
          for (const instance of this.instances.values()) instance.songs.emit(song);
        }),
        this.host.onPlayback((playback) => {
          this.playback = playback;
          for (const instance of this.instances.values()) instance.playbacks.emit(playback);
        })
      );
      this.reconcile();
    }
    setState(state2) {
      this.state = state2;
      if (this.started) this.reconcile();
    }
    /** Stops every plugin and removes the theme. */
    stop() {
      for (const off of this.subscriptions.splice(0)) off();
      for (const instance of this.instances.values()) instance.stop();
      this.instances.clear();
      this.themeStyle?.remove();
      this.themeStyle = null;
      this.started = false;
    }
    /** Ids of the plugins running right now, for tests and debugging. */
    runningPlugins() {
      return [...this.instances.keys()];
    }
    get apiVersion() {
      return API_VERSION;
    }
    onRoute(route) {
      if (route.url === this.route.url) return;
      this.route = route;
      const started = this.reconcile();
      for (const [id, instance] of this.instances) if (!started.has(id)) instance.routes.emit(route);
    }
    reconcile() {
      const started = /* @__PURE__ */ new Set();
      for (const plugin of this.catalog.plugins) {
        const { id } = plugin.manifest;
        const wanted = this.domReady && isPluginEnabled(plugin.manifest, this.state) && matchesUrl(plugin.manifest.matches, this.route.url);
        const running = this.instances.get(id);
        const settings = resolveSettings(plugin.manifest.settings, this.state.settings[id]);
        if (wanted && !running) {
          const instance = new PluginInstance(
            plugin,
            {
              host: this.host,
              doc: this.doc,
              route: () => this.route,
              song: () => this.song,
              playback: () => this.playback
            },
            settings
          );
          this.instances.set(id, instance);
          started.add(id);
          instance.start();
        } else if (!wanted && running) {
          this.instances.delete(id);
          running.stop();
        } else if (running) {
          running.updateSettings(settings);
        }
      }
      this.applyTheme();
      return started;
    }
    activeTheme() {
      const id = this.state.theme;
      if (id === null) return null;
      const theme = this.catalog.themes.find((t) => t.manifest.id === id);
      return theme && matchesUrl(theme.manifest.matches, this.route.url) ? theme : null;
    }
    applyTheme() {
      const theme = this.activeTheme();
      if (!theme) {
        this.themeStyle?.remove();
        this.themeStyle = null;
        return;
      }
      const variables = resolveThemeVariables(
        theme.manifest.variables,
        this.state.themeVariables[theme.manifest.id]
      );
      const css = `${themeVariablesCss(variables)}
${theme.css}`;
      this.themeStyle ??= this.doc.createElement("style");
      this.themeStyle.id = THEME_STYLE_ID;
      this.themeStyle.dataset.theme = theme.manifest.id;
      if (this.themeStyle.textContent !== css) this.themeStyle.textContent = css;
      attachStyle(this.doc, this.themeStyle);
    }
  };

  // packages/runtime/src/desktop-host.ts
  var REQUIRED_CAPABILITIES = [
    "desktop",
    "events.routeChanged",
    "events.songChanged",
    "events.playbackStateChanged"
  ];
  function getDesktopBridge(scope2 = globalThis) {
    const bridge = scope2.sunoDesktop;
    if (typeof bridge !== "object" || typeof bridge.on !== "function") return null;
    if (typeof bridge.apiVersion !== "number" || bridge.apiVersion < 1) return null;
    const capabilities = bridge.capabilities;
    if (!Array.isArray(capabilities)) return null;
    return REQUIRED_CAPABILITIES.every((c) => capabilities.includes(c)) ? bridge : null;
  }
  var text = (value) => typeof value === "string" ? value : "";
  function toSong(payload) {
    if (typeof payload !== "object" || payload === null) return null;
    const p = payload;
    if (!text(p.title) && !text(p.artist)) return null;
    const artwork = (Array.isArray(p.artwork) ? p.artwork : []).flatMap((art) => {
      if (typeof art !== "object" || art === null) return [];
      const a = art;
      if (typeof a.src !== "string") return [];
      return [
        Object.freeze({
          src: a.src,
          ...typeof a.sizes === "string" ? { sizes: a.sizes } : {},
          ...typeof a.type === "string" ? { type: a.type } : {}
        })
      ];
    });
    return Object.freeze({
      title: text(p.title),
      artist: text(p.artist),
      album: text(p.album),
      artwork: Object.freeze(artwork)
    });
  }
  function isPlaybackState(value) {
    return value === "none" || value === "paused" || value === "playing";
  }
  function initialPlayback() {
    const declared = navigator.mediaSession.playbackState;
    return declared === "playing" || declared === "paused" ? declared : "none";
  }
  function createDesktopHost(bridge, storage, handover) {
    const routes = new Emitter();
    const songs = new Emitter();
    const playbacks = new Emitter();
    let route = routeOf(location.href);
    let song = toSong(handover?.song) ?? readMediaSessionSong();
    let playback = isPlaybackState(handover?.playback) ? handover.playback : initialPlayback();
    const offs = [
      bridge.on("routeChanged", ({ url }) => {
        if (url === route.url) return;
        route = routeOf(url);
        routes.emit(route);
      }),
      bridge.on("songChanged", (payload) => {
        const next = toSong(payload);
        if (sameSong(song, next)) return;
        song = next;
        songs.emit(song);
      }),
      bridge.on("playbackStateChanged", ({ state: state2 }) => {
        if (state2 === playback) return;
        playback = state2;
        playbacks.emit(playback);
      })
    ];
    return {
      env: Object.freeze({
        kind: "desktop",
        desktopVersion: bridge.version,
        apiVersion: API_VERSION
      }),
      currentRoute: () => route,
      onRoute: (listener) => routes.on(listener),
      currentSong: () => song,
      onSong: (listener) => songs.on(listener),
      currentPlayback: () => playback,
      onPlayback: (listener) => playbacks.on(listener),
      storage,
      dispose: () => {
        for (const off of offs) off();
      }
    };
  }
  function localStoragePluginStorage(pluginId) {
    const prefix = `sunoplusplus:plugin:${pluginId}:`;
    return {
      get: (key) => {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) return Promise.resolve(void 0);
        try {
          return Promise.resolve(JSON.parse(raw));
        } catch {
          return Promise.resolve(void 0);
        }
      },
      set: (key, value) => {
        localStorage.setItem(prefix + key, JSON.stringify(value));
        return Promise.resolve();
      },
      remove: (key) => {
        localStorage.removeItem(prefix + key);
        return Promise.resolve();
      }
    };
  }

  // packages/desktop/src/index.ts
  var CONFIG_KEY = "__SUNOPLUSPLUS_DESKTOP__";
  var RUNTIME_KEY = /* @__PURE__ */ Symbol.for("sunoplusplus.runtime");
  var scope = globalThis;
  var config = scope[CONFIG_KEY];
  var state = normalizeState(config?.state);
  var existing = scope[RUNTIME_KEY];
  if (existing?.version === "0.1.0" && existing.runtime) {
    existing.runtime.setState(state);
  } else {
    let handover;
    if (existing) {
      try {
        handover = existing.current?.();
        existing.runtime?.stop();
        existing.dispose?.();
      } catch (error) {
        console.error("[Suno++] could not stop the previous version", error);
      }
      scope[RUNTIME_KEY] = void 0;
    }
    const bridge = getDesktopBridge();
    if (bridge) {
      const host = createDesktopHost(bridge, localStoragePluginStorage, handover);
      const runtime = new Runtime({ host, catalog });
      const installed = {
        version: "0.1.0",
        runtime,
        dispose: () => host.dispose(),
        current: () => ({ song: host.currentSong(), playback: host.currentPlayback() })
      };
      scope[RUNTIME_KEY] = installed;
      runtime.start(state);
    } else {
      console.warn("[Suno++] Suno Desktop bridge not found (needs Suno Desktop with bridge API 1+)");
    }
  }
})();
