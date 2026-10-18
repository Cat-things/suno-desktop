# Architecture

Suno Desktop wraps the suno.com website in a hardened Electron shell. It never calls Suno's private APIs and contains no Suno-specific DOM selectors: everything Suno-specific in the core is a hostname.

## Why Electron

Electron ships full Chromium, so Chrome-extension style content scripts and `session.extensions.loadExtension` work. That keeps future Suno++ plugins portable between the browser and the desktop app, which a WebView2-based Tauri app could not guarantee. Chromium also brings native media-session integration (Windows media overlay, hardware media keys) for free.

## Layout

```
src/
  main/        Electron main process (Node). Owns windows, sessions, IPC, integrations.
  preload/     suno.ts (remote suno.com view) and ui.ts (local UI). Both sandboxed.
  renderer/    Local UI pages: titlebar.html, settings.html, offline.html, onboarding.html (plain TS + CSS).
  shared/      Pure TypeScript shared by all of the above: constants, types, policies, schemas.
config/        app.config.json (Discord application id).
resources/     Runtime icons (tray, thumbnail buttons, notifications). Unpacked from the asar.
build/         App icon, NSIS include (protocol registration), electron-builder resources.
scripts/       Icon generator, Windows packaging script.
tests/         Vitest unit tests; tests/e2e drives the built app with Playwright.
```

Modules that make decisions (URL policy, deep links, settings migrations, IPC validation, permission policy, shortcuts, Discord framing, injection registry) are pure and do not import `electron`, so they are unit tested directly.

## Windows and views

```
BrowserWindow (frameless, titleBarStyle: hidden, titleBarOverlay, Mica)
├── own webContents ─ app://ui/titlebar.html        role "titlebar"   default session
├── WebContentsView ─ https://suno.com              role "suno"       persist:suno session
├── WebContentsView ─ app://ui/offline.html         role "offline"    (shown only on failure)
└── WebContentsView ─ app://ui/onboarding.html      role "onboarding" (first launch, on top of everything)

BrowserWindow ─ app://ui/settings.html               role "settings"   default session
Auth popups (child BrowserWindows)                   no role           persist:suno session
Tray, taskbar thumbnail buttons, notifications       main process
```

- The title bar is the window's own webContents; draggable regions use `-webkit-app-region`. Native caption buttons come from `titleBarOverlay`, so Windows 11 snap layouts work on the maximize button. The suno.com view sits 40 px below the top (full window in F11 / HTML5 fullscreen).
- Local pages are served from a privileged `app://ui/` scheme registered only on the default session. The suno.com session has no handler for it, so remote content cannot load local UI. Responses carry a strict CSP (`script-src 'self'`, no remote code).
- The onboarding view covers the whole window below the title bar until the user finishes or skips it. It can only read its state, set the theme and finish (`onboarding:*` channels); the suno.com view keeps loading underneath, so the site is ready when the welcome closes.
- `src/main/app-controller.ts` composes everything after `app.ready`; `src/main/index.ts` only does pre-ready work (userData path, single-instance lock, hardware acceleration, sandbox, scheme privileges).

## Security model

- **Every renderer is sandboxed** (`app.enableSandbox()` plus `sandbox: true`), `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, `nodeIntegrationInSubFrames: false`. Remote content never gets Node. The one exception: an unpackaged run started with `--no-sandbox` (Linux CI as root) skips `app.enableSandbox()` because Chromium's OS sandbox is already off there and forcing it crashes the network service; `sandbox: true` on each webContents still applies.
- **Preloads are single files** that only `require('electron')` (electron-vite `isolatedEntries`), checked after each build.
- **IPC**: every channel main listens on is declared in `src/shared/ipc-schemas.ts` with the roles allowed to use it and a zod payload schema. `IpcRouter` rejects a message unless the sender webContents has an allowed role, the sending frame is a main frame, its URL is `app://ui/…` (or the dev server in development) for local roles or `https://suno.com`/subdomain for the `suno` role, and the payload parses. Popups have no role, so they cannot send anything.
- **Navigation** (`src/shared/url-policy.ts`):
  - In the app: `suno.com`, `suno.ai` and subdomains (Clerk runs on `auth.suno.com`), plus login providers: `accounts.google.com`, `accounts.youtube.com`, `appleid.apple.com`, `idmsa.apple.com`, Discord `/oauth2`, `/login`, `/register` only, `login.microsoftonline.com`, `login.microsoft.com`, `login.live.com`, `account.live.com`, Facebook OAuth/login paths only, `access.line.me`.
  - First-party media files (`.mp3`, `.wav`, images, …) go to the download manager.
  - Other `http(s)` and `mailto` links open in the default browser. Everything else (`file:`, `javascript:`, custom schemes, URLs with credentials) is blocked.
  - `window.open`: scripted popups to login providers (or `about:blank`) become child windows sharing the suno.com session so OAuth `window.opener` flows work; `target=_blank` links to suno.com load in the main view.
- **Permissions** (`src/main/permission-policy.ts`): only suno.com gets anything. Notifications, sanitized clipboard writes and fullscreen are allowed. Microphone access triggers a native "Allow suno.com to use your microphone?" prompt (remembered until restart); cameras, geolocation, clipboard reads, MIDI, HID, serial, USB, screen capture and the rest are denied. File uploads use `<input type=file>`, which needs no permission.
- **User agent**: `Electron/…` and the app token are stripped and the Chrome version reduced to `Chrome/<major>.0.0.0`, matching stock Chrome.
- No default application menu (its accelerators would bypass shortcut handling). DevTools only in dev builds or with Settings → Advanced → Allow developer tools.

## The suno.com preload and page bridge

`src/preload/suno.ts` runs in Electron's isolated world and does nothing unless the page is on suno.com. It:

1. Installs `window.sunoDesktop` and a `navigator.mediaSession` hook into the page's main world with `contextBridge.executeInMainWorld`, which runs synchronously before any Suno script (`src/preload/page-world.ts`). The emitter lives in the page world because functions passed through `contextBridge` lose their identity, which would break `off(listener)`.
2. Installs the same bridge (without the media hook) in the plugin world, `PLUGIN_WORLD_ID = 1001`.
3. Talks to both worlds through DOM `CustomEvent`s whose names contain a random UUID per page load, so page scripts cannot listen in or inject messages. Payloads are JSON strings.

The hook wraps `setActionHandler`, `setPositionState`, `metadata` and `playbackState` on the page's `MediaSession`, follows audible `<audio>`/`<video>` elements, and posts snapshots (throttled, plus a 2 s poll for in-place metadata edits). The preload sanitizes them (`src/shared/media-sanitize.ts`), drops changes that are just the position advancing, emits `songChanged` / `playbackStateChanged` to the bridge and sends the snapshot to main.

## Media flow

```
Suno player ──mediaSession──► Chromium ──► Windows media overlay (SMTC) + hardware media keys
     │                                         (native, no app code involved)
     └─ page-world hook ─► preload ─► IPC media:update ─► MediaController ─┬─► tray menu + tooltip
                                                                          ├─► taskbar thumbnail buttons
                                                                          └─► Discord Rich Presence

tray / thumbnail click ─► MediaController.command ─► IPC media:command ─► preload ─► page world
     ─► the page's own mediaSession action handler (or play()/pause() on the audible element)
```

Playback is driven through the page's media session handlers, never by clicking Suno's buttons. Synthetic media-key events from `webContents.sendInputEvent` were not used: they reach the page as ordinary `KeyboardEvent`s rather than Chromium's media-session layer, so they would only work if Suno listened for those keys.

## Discord Rich Presence

`src/main/integrations/discord/` implements the small local IPC protocol (named pipe `\\?\pipe\discord-ipc-N`), handshakes with the application id from `config/app.config.json`, and sends `SET_ACTIVITY` with activity type "Listening": title, `by <artist>`, the cover (Discord accepts https image URLs up to 256 chars, otherwise the `logo` asset), start/end timestamps for the progress bar, and a "Listen on Suno" button. The button links to the song page when the current URL is a song page, otherwise it derives the song id from the cover file name (`image_<uuid>.jpeg`) and falls back to suno.com. Updates are rate limited to Discord's limits and reconnects back off from 15 s to 2 min.

## Theme, onboarding and reset

- **App theme**: the `theme` setting (`system` / `light` / `dark`) drives `nativeTheme.themeSource`, set before any window is created so nothing flashes. Main pushes the resolved theme to every local page (`ui:theme` → `data-theme` on `<html>`) and the CSS uses `light-dark()`; `prefers-color-scheme` alone did not follow `themeSource` reliably on every platform. suno.com sees the same `themeSource` through Chromium.
- **Onboarding**: shown when `onboardingCompleted` is false, which is the case for new installs only (the v1 → v2 migration marks existing installs as done). Steps: welcome, theme picker (Auto / Light / Dark, applied live), done. Skipping counts as finishing.
- **Discord Rich Presence** defaults to off and is never switched on by the app; the user enables it in Settings.
- **Reset app settings** (Settings → Advanced) asks for confirmation, then writes `DEFAULT_SETTINGS` back, which re-applies the theme, hardware acceleration flag, tray, startup and Discord state through the normal `changed` handlers and shows the onboarding again. It never touches the `persist:suno` partition, so the user stays signed in; **Clear session** is the separate, opposite button.

## Persistence

All under `%APPDATA%/Suno Desktop`:

| Path                | Contents                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `settings.json`     | Versioned settings (`src/shared/settings.ts`), written atomically    |
| `window-state.json` | Size, position, maximized; positions on missing monitors are dropped |
| `Partitions/suno`   | suno.com cookies, storage, cache (the login)                         |
| `logs/main.log`     | Main process log, rotated at 2 MB                                    |
| `plugins/`          | Reserved for Suno++ plugins (created at startup, empty)              |
| `themes/`           | Reserved for Suno++ themes (created at startup, empty)               |

Settings migrations: `MIGRATIONS[n]` upgrades version `n` to `n + 1`; invalid fields fall back to defaults individually, unknown keys are dropped, and files from a newer version are read best-effort. Version 2 added `theme` and `onboardingCompleted` (true for upgraded installs, so only fresh installs see the welcome).

## Updates and packaging

- `electron-updater` with the GitHub provider. Stable uses `latest.yml`; beta sets `allowPrerelease` and channel `beta`. Prerelease versions (`v0.2.0-beta.1`) publish `beta.yml`; when the newest release is stable, electron-updater falls back to its `latest.yml`, so beta users also get stable builds. Checks 15 s after launch and every 6 h, downloads in the background and installs on quit or via "Restart to update". Disabled for portable and dev builds.
- One NSIS installer contains x64 and arm64 so a single `latest.yml` serves both. This roughly doubles the installer size; per-architecture installers would need per-architecture update feeds. Portable exes are built per architecture (`scripts/dist-win.mjs`).
- Releases are automatic: on every push to `main`, `scripts/release-plan.mjs` counts non-merge commits since the last stable `vX.Y.Z` tag and, at 3 or more (or when no release exists yet), the Release workflow builds unsigned packages with `--publish never`, tags the exact commit it built and publishes with `gh release create`. Versions come from tags (last release + 1 patch, or `package.json` when it is higher); `package.json` is stamped only inside the build. Building first and publishing separately leaves room for a signing step in between.
- `build/installer.nsh` registers `suno-desktop://` at install time and removes it and the launch-on-startup entry on uninstall (not on update). The app also registers the protocol at runtime, which covers portable builds.

## Deep links

`suno-desktop://open?path=/song/<id>` (path must be a suno.com path: no `//host`, backslashes or control characters). A second launch forwards its argv to the running instance through the single-instance lock. `suno-desktop://plugin/<action>?…` and `suno-desktop://theme/<action>?…` are parsed and handed to the plugin and theme host stubs, which log them and show "Plugins aren't available yet" / "Themes aren't available yet". See [Plugin and theme hooks](PLUGIN_HOOKS.md) for what Suno++ will plug into.
