# Suno++ and the plugin hooks

**[Suno++](https://github.com/Cat-things/sunoplusplus)** brings **community-made plugins and themes** to Suno, in the browser and in this app. It lives in its own repository, where the plugin and theme formats, the SDK and every plugin and theme are developed and reviewed. Suno Desktop downloads Suno++ from its GitHub releases and keeps it up to date, so new and updated plugins and themes reach the app **without a new Suno Desktop version**.

- **Plugins** add behavior, for example the now-playing tab title or better style recommendations.
- **Themes** change how suno.com looks.

**Ground rule:** the core app has no Suno DOM selectors and must not gain any. DOM targeting lives in Suno++ plugins and themes, so a Suno UI change can break a plugin or theme but never the app.

| Piece                     | Where                                                        |
| ------------------------- | ------------------------------------------------------------ |
| Download, verify, update  | `src/main/sunoplusplus/manager.ts`                           |
| Formats and validation    | `src/shared/sunoplusplus.ts`                                 |
| Injection pipeline        | `src/main/injection/`                                        |
| Page bridge               | `window.sunoDesktop` (`src/preload/page-world.ts`)           |
| Settings → Plugins/Themes | `src/renderer/settings.html`, `src/renderer/src/settings.ts` |
| Deep links                | `suno-desktop://plugin/…`, `suno-desktop://theme/…`          |

## 1. How Suno++ gets into the app

Suno++ is **off until the user turns it on** in Settings → Plugins, because turning it on downloads code. Then `SunoPlusPlusManager`:

1. Reads `https://github.com/Cat-things/sunoplusplus/releases/latest/download/desktop.json` and validates it (`sppReleaseSchema`): format version, version, the bridge API it needs, the oldest Suno Desktop it supports, and the size and SHA-256 of each file.
2. If it is newer than the installed copy and compatible, downloads `sunoplusplus.js` and `catalog.json` from `https://github.com/Cat-things/sunoplusplus/releases/download/v<version>/`. The app builds these URLs from the validated version and fixed file names, never from the feed.
3. Refuses anything larger than declared or with a different SHA-256, validates the catalog (`sppCatalogSchema`), and only then swaps the files into `<userData>/sunoplusplus/current` (via a staging folder; a half-finished swap falls back to `previous`). A failed check or download keeps the working copy.
4. Registers the bundle with the injection pipeline, prefixed with the user's choices:

   ```ts
   injection.register({
     id: 'sunoplusplus.runtime',
     owner: 'sunoplusplus',
     matches: ['https://suno.com/*'],
     world: 'isolated',
     runOn: ['load'],
     js: `globalThis.__SUNOPLUSPLUS_DESKTOP__ = ${JSON.stringify({ state })};\n${bundle}`
   })
   ```

It checks again 15 seconds after launch and every 6 hours while **Update Suno++ automatically** is on (the default), and whenever the user clicks **Check for updates**. On startup the installed copy is re-verified against its saved `desktop.json`; a damaged copy is ignored and downloaded again.

**Live changes.** The user's choices (`settings.sunoPlusPlus`: which plugins are on, their settings, the theme and its colors) change through the `sunoplusplus:action` IPC channel, which accepts only a few validated actions (`sppActionSchema`). Each change re-registers the entry; the injector re-runs an entry whose code changed, and the bundle hands the new choices to the Suno++ runtime already on the page. A new Suno++ version does the same: the new bundle takes the current song and playback state from the old runtime, stops it and takes over, **without reloading the page**, so music keeps playing.

**Turning it off** unregisters the entry and runs `SPP_STOP_SCRIPT` once on the open page (`InjectionRegistry.runNow`), which stops the runtime and removes its theme. Nothing of Suno++ runs on later page loads. The names it relies on are part of Suno++'s contract ([Turning Suno++ off](https://github.com/Cat-things/sunoplusplus/blob/main/docs/DESKTOP.md#turning-suno-off)).

**Trust.** The bundle runs in the isolated plugin world on suno.com: it can do what a browser extension on suno.com could, but gets no Node, no IPC and nothing outside suno.com. Updates are as trustworthy as Suno++'s releases, the same model as the app's own updater: HTTPS from GitHub plus the hashes in `desktop.json`, and everything in a release was reviewed in the Suno++ repository first. Signing releases with a pinned key is a possible next step.

The contract from the Suno++ side is in its [DESKTOP.md](https://github.com/Cat-things/sunoplusplus/blob/main/docs/DESKTOP.md).

## 2. Injection pipeline

`InjectionRegistry` (`src/main/injection/registry.ts`) holds entries; `Injector` (`src/main/injection/injector.ts`) applies them to the suno.com view. Suno++ is its only user.

```ts
interface InjectionEntry {
  id: string // unique, [a-z0-9._-], e.g. "sunoplusplus.runtime"
  owner: string // unregisterOwner(owner) removes all of its entries
  matches: string[] // globs on origin+path+query, anchored to suno.com: "https://suno.com/create*"
  css?: string
  js?: string
  world: 'main' | 'isolated'
  runOn: ('load' | 'route')[] // when js runs
}

const dispose = injection.register(entry) // throws on invalid entries
injection.unregister(id)
injection.unregisterOwner(owner)
injection.runNow({ id, owner, js, world }) // once, on the suno.com page open right now
```

- **`load`** runs after each full document load (`dom-ready`). **`route`** runs after each client-side navigation (`did-navigate-in-page`; no need to patch `history`).
- Registering an entry while a page is open applies its CSS and runs its `load` script immediately. Re-registering an entry with **different code** runs it again; the same code doesn't run twice on one document.
- **CSS** follows the URL on every load and route change (`webContents.insertCSS`, author origin).
- **Worlds**: `main` is the page's own JavaScript world. `isolated` is a dedicated plugin world (`PLUGIN_WORLD_ID = 1001`), separate from the page and the app's preload, sharing only the DOM. Suno++ uses `isolated`.
- Each script runs in its own `try/catch`. Nothing runs on non-suno.com pages (for example a login provider). Patterns not anchored to `https://suno.com/` or a subdomain are rejected; sources are capped at 1 MB.

## 3. Page bridge: `window.sunoDesktop`

Installed before any Suno script runs, in the page's main world and in the plugin world. Frozen, non-writable, and nothing privileged: no Node, no IPC, no file access. Suno++'s desktop host listens to it.

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

Payloads are frozen, listener errors are caught and logged, unknown event names throw a `TypeError`. Events are not replayed. Capabilities: `desktop`, `events.routeChanged`, `events.songChanged`, `events.playbackStateChanged`. The bridge is visible to suno.com's own scripts too; treat it as public, read-only information.

**Growing the bridge:** add a capability string whenever the bridge gains something, and never remove or change one without bumping `BRIDGE_API_VERSION` (`src/shared/constants.ts`); Suno++ releases declare the bridge API they need in `desktop.json`. Anything that needs the main process (per-plugin storage that survives **Clear session**, notifications, opening links) should become a new IPC channel with its own contract in `src/shared/ipc-schemas.ts`, a dedicated sender role and a capability flag, rather than widening what the page world can do. An `appearance` capability (the app's Light / Dark / Auto) would let themes follow the app.

## 4. Settings

Settings → **Plugins** has the Suno++ switch, its version and update status, **Check for updates**, **Update Suno++ automatically**, and one card per plugin with its switch and the settings its manifest declares (switches, text, numbers, menus). Settings → **Themes** lists "Suno's own look" plus every theme, with color pickers for the active theme's colors. Everything is rendered from the downloaded `catalog.json` with `textContent`, never `innerHTML`.

Themes are separate from the app's Light / Dark / Auto setting (`settings.theme`), which styles the app's own window.

**Reset app settings** turns Suno++ off and forgets its choices; the downloaded copy stays on disk. **Clear session** clears plugin data plugins kept in suno.com's `localStorage`.

## 5. Deep links

`suno-desktop://plugin/install?id=<id>` and `suno-desktop://theme/install?id=<id>` (`enable` works too). Everything in Suno++ is already reviewed and bundled, so "install" means "turn on". The app asks before turning Suno++ on (it downloads code), then checks for updates, looks the id up in the catalog and asks again before turning the plugin or theme on. Unknown actions and ids get an explanation and change nothing.

## 6. Suno surfaces plugins and themes will likely target

Plugins and themes own the selectors for these. The descriptions reflect suno.com at the time of writing and will drift.

**Create page** (`https://suno.com/create`), the main target: the **Styles** box (about 1,000 characters; a planned Suno++ plugin improves style recommendations here), **Lyrics** (about 5,000), **Title** (100), **Exclude styles**, the **Weirdness** and **Style Influence** sliders, the **model picker** and **Personas**.

**Library**: songs, playlists and workspaces (`/me` and related routes). **Player**: the persistent bottom player; prefer the bridge and `navigator.mediaSession` over reading its DOM.

Plugin authors: prefer stable hooks (ARIA roles and labels, placeholders, `name` attributes) over generated class names, re-find elements after navigation, write into inputs the way a user would, and never automate generations or work around credits, paywalls or limits. The full guide is Suno++'s [PLUGINS.md](https://github.com/Cat-things/sunoplusplus/blob/main/docs/PLUGINS.md).

## 7. Community

Make plugins and themes in the [Suno++ repository](https://github.com/Cat-things/sunoplusplus) ([CONTRIBUTING.md](https://github.com/Cat-things/sunoplusplus/blob/main/CONTRIBUTING.md)); once merged they ship in the next Suno++ release and reach the app by themselves. Ideas go to this repo's Discussions (**Plugin ideas**, **Theme ideas**). Changes to the hooks here (bridge capabilities, injection options) are welcome as pull requests in this repository.
