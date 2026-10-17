# Suno Desktop

An unofficial Windows desktop app for [Suno](https://suno.com), built so it feels like a real Windows app: a native title bar with Mica, the Windows media overlay, taskbar controls, a tray icon and Discord Rich Presence.

> **Not affiliated with Suno.** Suno Desktop is an independent open-source project. It is not affiliated with, sponsored by or endorsed by Suno, Inc. "Suno" is a trademark of Suno, Inc. The app shows the regular suno.com website; your account, songs, credits and subscription are handled by Suno as usual.

## Features

- **Native window**: frameless Windows 11 title bar with back, forward, reload, home and settings buttons, snap layouts on the maximize button, Mica on Windows 11 22H2 or newer, light and dark mode that follow Windows.
- **Stays signed in**: suno.com runs in a persistent session, so your login survives restarts.
- **Sign-in that works**: Suno's login providers (Google, Apple, Discord, Microsoft, Facebook, LINE and phone) open inside the app; other links open in your default browser.
- **Media controls**: keyboard media keys and the Windows media overlay control Suno's player, plus previous / play-pause / next buttons on the taskbar thumbnail and in the tray menu.
- **Keeps playing in the background**: closing the window hides it to the tray (can be turned off).
- **Discord Rich Presence** (optional): song title, artist, cover, elapsed time and a "Listen on Suno" button.
- **Downloads**: native save dialog or a fixed download folder, taskbar progress and a "Show in folder" notification.
- **Deep links**: `suno-desktop://open?path=/song/<id>` opens a page in the app.
- **Offline page** with retry instead of a blank window.
- **Auto-updates** from GitHub Releases with stable and beta channels.
- **Settings**: launch on startup, start minimized, close to tray, Discord, download folder, hardware acceleration, zoom, update channel, clear session and log out.

### Keyboard shortcuts

| Shortcut                        | Action                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| Ctrl+R / F5                     | Reload                                                         |
| Ctrl+Shift+R / Ctrl+F5          | Reload without cache                                           |
| Alt+Left / Alt+Right            | Back / forward (mouse back/forward buttons)                    |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset (Ctrl+wheel works)                       |
| Ctrl+,                          | Settings                                                       |
| F11                             | Full screen                                                    |
| F12 / Ctrl+Shift+I              | Developer tools (dev builds, or enable in Settings → Advanced) |

## Install

Download the latest release from the [Releases page](https://github.com/Cat-things/suno-desktop/releases):

- **`Suno-Desktop-Setup-<version>.exe`**: installer for Windows 10 and 11 (x64 and ARM64 in one file). Updates itself automatically.
- **`Suno-Desktop-Portable-<version>-x64.exe`** / **`-arm64.exe`**: run without installing. Portable builds do not auto-update.

Builds are currently **not code-signed**, so Windows SmartScreen will warn you on first launch. Choose **More info → Run anyway**. See [Known issues](#known-issues).

## Build from source

Requirements: Node.js 22.12+ and pnpm 10 (`corepack enable` picks up the pinned version).

```sh
pnpm install
pnpm dev              # run with hot reload
pnpm test             # unit tests
pnpm build            # bundle main, preloads and UI into out/
pnpm test:e2e         # end-to-end tests against the built app (Linux: xvfb-run -a pnpm test:e2e)
pnpm lint && pnpm typecheck
```

Package for Windows (run on Windows):

```sh
pnpm dist:win         # NSIS installer (x64 + arm64) and portable exes in dist/
pnpm dist:dir         # unpacked app only, quickest way to try a packaged build
```

Releases are built by GitHub Actions: push a tag `v<version>` that matches `package.json` and the workflow uploads the installer, portable exes and `latest.yml` to a **draft** release. Publish the draft to make it visible to auto-update. Code signing is used when the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets are set.

### Configuration

- **Discord Rich Presence** needs a Discord application id. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), name it as you want it to appear ("Listening to …"), and put its Application ID into [`config/app.config.json`](config/app.config.json). Upload an art asset named `logo` for songs without a cover. For local testing you can set `SUNO_DESKTOP_DISCORD_CLIENT_ID` instead. Without an id the setting is disabled.
- **Icons** are placeholders. Replace `build/icon.svg` and `resources/tray.svg` and run `pnpm icons`.

## Known issues

- **Google sign-in may be blocked.** Google refuses sign-in from browsers it considers embedded. The app sends a plain Chrome user agent, which usually works, but Google also uses other signals and can still show "This browser or app may not be secure". If that happens, sign in with another option (Apple, Discord, Microsoft, Facebook, LINE or phone). If your Suno account only has Google login, you may be able to add another sign-in method to the account on suno.com in a regular browser first.
- **SmartScreen warning** on unsigned builds (see Install). It goes away once releases are signed with a reputable certificate.
- **Next/previous controls depend on Suno.** They are enabled only when suno.com registers next/previous track handlers with the browser's media session.
- **Discord shows the "Listen on Suno" button to others, not to you.** That is how Discord displays activity buttons.
- **Mica** needs Windows 11 22H2 or newer; older versions get a solid title bar.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): processes, windows, security model, IPC, media flow.
- [Plugin hooks](docs/PLUGIN_HOOKS.md): seams for the upcoming Suno++ plugin system.
- [Testing](docs/TESTING.md): automated tests and the manual Windows checklist.

## License

[MIT](LICENSE). Suno's name and website belong to Suno, Inc.; this repository ships none of Suno's logos or assets.
