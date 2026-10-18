# Plugin and theme hooks (for Suno++)

**Suno++** is the upcoming companion project that brings **plugins and themes** to Suno, both on suno.com in the browser and in this app, with a marketplace to find and install them. It is built **with the community**: anyone will be able to make and share plugins and themes. Suno++ lives in a separate repository and defines the plugin and theme formats. Suno Desktop does not implement any of it; it only provides seams so Suno++ can plug in later without reworking the app.

- **Plugins** add behavior, for example better style recommendations in the Styles box.
- **Themes** change how suno.com looks, for example a new color scheme or a more compact library.

**Ground rule:** the core app has no Suno DOM selectors and must not gain any. DOM targeting lives in plugins and themes, so a Suno UI change can break a plugin or theme but never the app.

| Seam                   | Where                                               | Status                                    |
| ---------------------- | --------------------------------------------------- | ----------------------------------------- |
| Plugin host interface  | `src/main/plugins/`                                 | Interface + stub (loads nothing)          |
| Plugins folder         | `%APPDATA%/Suno Desktop/plugins`                    | Created at startup, otherwise unused      |
| Injection pipeline     | `src/main/injection/`                               | Working, nothing registered by the core   |
| Page bridge            | `window.sunoDesktop` (`src/preload/page-world.ts`)  | Working, read-only                        |
| Settings "Plugins" tab | `src/renderer/settings.html`                        | Hidden until the host reports `available` |
| Theme host interface   | `src/main/themes/`                                  | Interface + stub (applies nothing)        |
| Themes folder          | `%APPDATA%/Suno Desktop/themes`                     | Created at startup, otherwise unused      |
| Settings "Themes" tab  | `src/renderer/settings.html`                        | Hidden until the host reports `available` |
| Deep links             | `suno-desktop://plugin/…`, `suno-desktop://theme/…` | Parsed, routed to the stubs               |

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

## 4. Themes

Themes get their own host so the app can treat them differently from plugins: only one theme is active at a time, and themes are mostly CSS.

```ts
// src/main/themes/theme-host.ts
interface ThemeHost {
  readonly themesDir: string // %APPDATA%/Suno Desktop/themes
  readonly available: boolean // false for the stub; drives the settings Themes tab
  list(): Promise<readonly ThemeSummary[]> // { id, name, version, author, active }
  apply(id: string | null): Promise<void> // null = back to Suno's own look
  active(): string | null
  handleDeepLink(link: {
    kind: 'theme'
    action: string
    params: Record<string, string>
  }): Promise<void>
}

interface ThemeHostContext {
  readonly themesDir: string
  readonly injection: InjectionRegistry
  readonly log: Logger
}
```

`createThemeHost(context, notifyUnavailable)` in `src/main/themes/index.ts` returns `StubThemeHost` today: `list()` is empty, `apply(id)` rejects with `ThemesUnavailableError`, `apply(null)` clears anything registered under the `theme` owner, and theme deep links show "Themes aren't available yet".

How a real theme host is expected to work:

- A theme registers its CSS with the [injection pipeline](#2-injection-pipeline) under owner `THEME_INJECTION_OWNER` (`"theme"`). Applying a theme first calls `injection.unregisterOwner('theme')`, so switching themes never leaves old styles behind. CSS follows client-side route changes automatically.
- Themes may ship optional scripts (for example to add a class to elements CSS cannot reach), using the same `world: 'isolated'` rules as plugins.
- **Themes are separate from the app's Light / Dark / Auto setting** (`settings.theme`), which styles the app's own window chrome and follows Windows when set to Auto. A Suno++ theme styles suno.com. To match the app, a theme could read `prefers-color-scheme`, which Electron derives from the app setting; that did not reliably reach already-open pages in our Linux tests, so the bridge should grow an explicit capability for it (for example an `appearance` value and an `appearanceChanged` event) before themes rely on it.
- Theming the app's own chrome (title bar, settings) with Suno++ themes is a possible later step. It would need its own, narrower contract (a set of color tokens rather than arbitrary CSS), because the local UI is privileged.

## 5. Settings tab slots

`settings.html` contains hidden `Plugins` and `Themes` tabs. `src/renderer/src/settings.ts` shows them only when `AppInfo.pluginsAvailable` / `AppInfo.themesAvailable` (from the hosts' `available`) are true, then fills them from `sunoDesktopUI.plugins.list()` / `sunoDesktopUI.themes.list()` (IPC `plugins:list`, `themes:list`, settings window only) along with the folder paths.

## 6. Deep links

`suno-desktop://plugin/<action>?key=value…` and `suno-desktop://theme/<action>?key=value…` are reserved. The parser (`src/shared/deep-link.ts`) accepts a lowercase action (`[a-z][a-z0-9-]{0,63}`) and up to 20 query parameters of at most 512 characters each, then calls `PluginHost.handleDeepLink` or `ThemeHost.handleDeepLink`. It never executes anything by itself. Typical future uses are `suno-desktop://plugin/install?id=<plugin-id>` and `suno-desktop://theme/install?id=<theme-id>` from the Suno++ marketplace, which the host should confirm with the user before installing anything.

## 7. Suno surfaces plugins and themes will likely target

Plugins and themes own the selectors for these. The descriptions reflect suno.com at the time of writing and will drift.

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

## 8. Community

Plugins and themes will come from the community through Suno++. Until Suno++ exists, the best way to help is to share ideas in [Discussions](https://github.com/Cat-things/suno-desktop/discussions) (categories **Plugin ideas** and **Theme ideas**) and to keep the seams above clean. Changes to the seams themselves (new bridge capabilities, new injection options) are welcome as pull requests here.
