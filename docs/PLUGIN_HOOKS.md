# Plugin hooks (for Suno++)

Suno++ will add a plugin system and marketplace for both suno.com and this app. It lives in a separate repository and defines the plugin format. Suno Desktop only provides seams so Suno++ can plug in without reworking the app.

**Ground rule:** the core app has no Suno DOM selectors and must not gain any. DOM targeting lives in plugins, so a Suno UI change can break a plugin but never the app.

| Seam                   | Where                                              | Status                                    |
| ---------------------- | -------------------------------------------------- | ----------------------------------------- |
| Plugin host interface  | `src/main/plugins/`                                | Interface + stub (loads nothing)          |
| Plugins folder         | `%APPDATA%/Suno Desktop/plugins`                   | Created at startup, otherwise unused      |
| Injection pipeline     | `src/main/injection/`                              | Working, nothing registered by the core   |
| Page bridge            | `window.sunoDesktop` (`src/preload/page-world.ts`) | Working, read-only                        |
| Settings "Plugins" tab | `src/renderer/settings.html`                       | Hidden until the host reports `available` |
| Deep links             | `suno-desktop://plugin/<action>?…`                 | Parsed, routed to the stub                |

## 1. Plugin host

```ts
// src/main/plugins/plugin-host.ts
interface PluginHost {
  readonly pluginsDir: string // %APPDATA%/Suno Desktop/plugins
  readonly available: boolean // false for the stub; drives the settings tab
  list(): Promise<readonly PluginSummary[]>
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  handleDeepLink(link: {
    kind: 'plugin'
    action: string
    params: Record<string, string>
  }): Promise<void>
}

interface PluginHostContext {
  readonly pluginsDir: string
  readonly injection: InjectionRegistry // see below
  readonly session: Electron.Session // persist:suno
  readonly log: Logger
}
```

`createPluginHost(context, notifyUnavailable)` in `src/main/plugins/index.ts` returns `StubPluginHost` today: `list()` is empty, `load()` rejects with `PluginsUnavailableError`, `unload(id)` removes anything registered under that owner, and plugin deep links show "Plugins aren't available yet". A real host replaces the factory; nothing else in the app needs to change.

Implementation options the host can choose between (Suno++ decides):

- **Content-script style**: read a manifest from the plugins folder and register its scripts and styles with the injection pipeline. This mirrors a browser extension's content scripts, so the same plugin code can run in both places.
- **Chrome extensions**: `context.session.extensions.loadExtension(path)` loads an unpacked MV3 extension into the suno.com session. Electron implements only part of the `chrome.*` API (content scripts work; most UI APIs such as popups and the action button do not), so check what a plugin needs.

## 2. Injection pipeline

`InjectionRegistry` (`src/main/injection/registry.ts`) holds entries; `Injector` (`src/main/injection/injector.ts`) applies them to the suno.com view.

```ts
interface InjectionEntry {
  id: string // unique, [a-z0-9._-], e.g. "suno-plus-plus.style-recs"
  owner: string // plugin id; unregisterOwner(owner) removes all of its entries
  matches: string[] // globs on origin+path+query, anchored to suno.com: "https://suno.com/create*"
  css?: string
  js?: string
  world: 'main' | 'isolated'
  runOn: ('load' | 'route')[] // when js runs
}

const dispose = injection.register(entry) // throws on invalid entries
injection.unregister(id)
injection.unregisterOwner(owner)
```

Behavior:

- **`load`** runs after each full document load (`dom-ready`). **`route`** runs after each client-side navigation. Suno is a client-side routed app; `pushState`, `replaceState`, `popstate` and hash changes all surface through Electron's `did-navigate-in-page`, so there is no need to patch `history` in the page.
- **CSS** follows the URL on every load and route change: inserted when an entry starts matching, removed when it stops matching or changes. Uses `webContents.insertCSS` (author origin).
- Registering an entry while a page is open applies its CSS and runs its `load` script immediately.
- **Worlds**: `main` runs in the page's own JavaScript world (can touch Suno's globals, can be seen by Suno). `isolated` runs in a dedicated plugin world (`PLUGIN_WORLD_ID = 1001`), separate from the page and from the app's preload, sharing only the DOM. Prefer `isolated`.
- Each script is wrapped in its own `try/catch`; one failing plugin does not stop the others.
- Nothing runs while the view shows a non-suno.com page (for example a login provider). Patterns that are not anchored to `https://suno.com/` or a subdomain are rejected. Sources are capped at 1 MB.

## 3. Page bridge: `window.sunoDesktop`

Installed before any Suno script runs, in the page's main world and in the plugin world. It is frozen and non-writable, and exposes nothing privileged: no Node, no IPC, no file access.

```ts
interface SunoDesktopBridge {
  readonly version: string // app version, e.g. "0.1.0"
  readonly apiVersion: number // bridge contract version, currently 1
  readonly platform: string // "win32"
  readonly capabilities: readonly string[]
  on(event, listener): () => void // returns an unsubscribe function
  off(event, listener): void
  once(event, listener): () => void
}
```

| Event                  | Payload                                                                 | Fires when                                        |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `routeChanged`         | `{ url, path }`                                                         | DOMContentLoaded and every client-side navigation |
| `songChanged`          | `{ title, artist, album, artwork: [{ src, sizes?, type? }] }` or `null` | `navigator.mediaSession.metadata` changes         |
| `playbackStateChanged` | `{ state: 'none' \| 'paused' \| 'playing' }`                            | Playback starts, pauses or stops                  |

Payloads are frozen. Listener errors are caught and logged. Unknown event names throw a `TypeError`.

Current capabilities: `desktop`, `events.routeChanged`, `events.songChanged`, `events.playbackStateChanged`. A plugin host would add its own (for example `plugins`) once it exists.

Detecting the environment from Suno++:

```js
const desktop =
  typeof window.sunoDesktop === 'object' && window.sunoDesktop.capabilities.includes('desktop')
if (desktop && window.sunoDesktop.apiVersion >= 1) {
  window.sunoDesktop.on('songChanged', (song) => console.log('now playing', song?.title))
}
```

Notes:

- Events are not replayed. A script injected on `load` may register after the first `routeChanged`; read `location` and `navigator.mediaSession.metadata` for the initial state.
- In a browser extension, content scripts run in their own isolated world and will not see a `sunoDesktop` defined by a page, so the check above is false there.
- The bridge is visible to suno.com's own scripts too. Treat it as public, read-only information.

### Growing the bridge

Add a capability string whenever the bridge gains something, and never remove or change one without bumping `BRIDGE_API_VERSION` (`src/shared/constants.ts`). Anything that needs the main process (per-plugin storage, notifications, opening links) should become a new IPC channel with its own contract in `src/shared/ipc-schemas.ts`, a dedicated sender role for plugin code and a capability flag, rather than widening what the page world can do.

## 4. Settings tab slot

`settings.html` contains a hidden `Plugins` tab and panel. `src/renderer/src/settings.ts` shows it only when `AppInfo.pluginsAvailable` (from `PluginHost.available`) is true, then fills it from `sunoDesktopUI.plugins.list()` (IPC `plugins:list`, settings window only) along with the plugins folder path.

## 5. Deep links

`suno-desktop://plugin/<action>?key=value…` is reserved. The parser (`src/shared/deep-link.ts`) accepts a lowercase action (`[a-z][a-z0-9-]{0,63}`) and up to 20 query parameters of at most 512 characters each, then calls `PluginHost.handleDeepLink`. It never executes anything by itself. A typical future use is `suno-desktop://plugin/install?id=<plugin-id>` from the Suno++ marketplace, which the host should confirm with the user before installing.

## 6. Suno surfaces plugins will likely target

Plugins own the selectors for these. The descriptions reflect suno.com at the time of writing and will drift.

**Create page** (`https://suno.com/create`), the main target:

- **Styles** box: free text, about 1,000 characters. The first planned Suno++ plugin is better **style recommendations** for this box.
- **Lyrics** box: about 5,000 characters.
- **Title**: up to 100 characters.
- **Exclude styles**: styles the model should avoid.
- **Weirdness** and **Style Influence** sliders.
- **Model picker**: v6, v6-wild, v6-mini.
- **Personas**: saved voice/style personas applied to a generation.

**Library**: the user's songs, playlists and workspaces (`/me` and related routes): lists, filters, bulk actions.

**Player**: the persistent bottom player. Prefer the bridge's `songChanged` / `playbackStateChanged` and `navigator.mediaSession` over reading the player's DOM.

Suggestions for plugin authors:

- Prefer stable hooks (ARIA roles and labels, placeholder text, `name` attributes) over generated class names, and re-find elements after `routeChanged` because the SPA re-renders.
- Use a `MutationObserver` scoped to the relevant container rather than polling.
- Respect the field limits above, and write into inputs the way a user would (set the value, then dispatch `input`) so Suno's own validation runs.
- Do not automate generations or work around credits, paywalls or rate limits. The app wraps the website as-is and plugins should too.
