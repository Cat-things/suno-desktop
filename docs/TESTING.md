# Testing

## Automated

| Command                                            | What it covers                                                    | Where it runs in CI              |
| -------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `pnpm test`                                        | Unit tests (Vitest) for all pure logic                            | Ubuntu                           |
| `pnpm test:e2e` (after `pnpm build`)               | The built app driven by Playwright against a fake suno.com        | Ubuntu (Xvfb) and windows-latest |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | ESLint (strict type-checked), `tsc` for main/preload/UI, Prettier | Ubuntu                           |
| `electron-builder --win dir`                       | Packaging an unpacked Windows app                                 | windows-latest                   |

**Unit tests** (`tests/*.test.ts`): URL allowlist and popup policy, deep link parser, settings schema and migrations, IPC contracts (sender roles, origins, payloads), media snapshot sanitizing, keyboard shortcuts, user agent cleanup, permission policy, download file names, `app://` path resolution, window layout and state, injection registry, Discord framing and presence.

**End-to-end tests** (`tests/e2e/app.e2e.ts`) launch the real app with an isolated user-data folder and intercept `https` inside the app's own `persist:suno` session, so suno.com, its CDN and Google sign-in are served by a small fake page that uses `navigator.mediaSession`. Nothing talks to Suno. They check:

- the title bar is served from `app://ui` and shows the page title;
- `window.sunoDesktop` is frozen and read-only, and suno.com gets no `require`, `process` or local UI API;
- media metadata reaches main through validated IPC; next / previous / toggle commands call the page's media session handlers;
- `routeChanged` fires on `history.pushState` and `off()` really unsubscribes;
- injected CSS follows routes, scripts run in the right world, and the plugin world sees the bridge but not page globals;
- non-allowlisted links go to `shell.openExternal`, OAuth popups open as child windows on the same session, deep links navigate and malicious paths are ignored;
- the offline page appears on a failed load and disappears after **Try again**;
- the settings window applies valid patches, rejects invalid ones and wrong-role callers, and zoom reaches the suno.com view;
- the main process log has no errors (on Windows this covers creating the tray and taskbar thumbnail buttons).

Screenshots of the title bar, settings (light and dark) and offline page are written to `test-results/e2e` and uploaded as CI artifacts.

On Linux run `xvfb-run -a pnpm test:e2e`. As root, Chromium needs `--no-sandbox`, which the suite passes on Linux.

## Manual checklist (Windows)

Automated tests cannot cover the real suno.com, Windows shell integration, the installer, updates or Discord. Run through this on Windows 11 (and spot-check Windows 10) before publishing a release. Use a release build from the draft release, not `pnpm dev`.

### Install and first run

- [ ] Installer runs; SmartScreen warning appears for unsigned builds and **Run anyway** works.
- [ ] Installer offers per-user install and a custom folder; Start menu and desktop shortcuts are created.
- [ ] On an ARM64 device the installer installs the ARM64 build (Task Manager → Details → Architecture).
- [ ] App opens on suno.com with the custom title bar: icon, back, forward, reload, home, page title, settings, native minimize / maximize / close.
- [ ] Windows 11 22H2+: Mica behind the title bar. Windows 10: solid title bar, no glitches.
- [ ] Hovering maximize shows snap layouts; dragging the title bar moves the window; double-click maximizes.
- [ ] Switching Windows between light and dark mode updates the title bar, caption buttons and settings window without a restart.
- [ ] Resize, move, maximize, close and reopen: size, position, maximized state and zoom are restored. Unplug a second monitor the window was on: it reopens on the primary monitor.
- [ ] Uninstall removes the app and the `suno-desktop://` registration; reinstalling keeps you signed in (user data is kept).

### Sign-in (each provider)

For each: sign in, quit from the tray, relaunch and confirm you are still signed in.

- [ ] Google (may be blocked by Google as an embedded browser; note the exact message if so)
- [ ] Apple
- [ ] Discord
- [ ] Microsoft
- [ ] Facebook
- [ ] LINE
- [ ] Phone number (SMS)
- [ ] Settings → Advanced → **Clear session and log out** signs you out after confirmation.

### Navigation

- [ ] Links to other sites (Discord invite, X/Twitter, help articles) open in the default browser, not in the app.
- [ ] Upgrade / checkout opens in the default browser.
- [ ] `target=_blank` links within suno.com open in the main view.
- [ ] Right-click: copy link, open link in browser, copy image, spelling suggestions in the Lyrics box, cut/copy/paste.
- [ ] Shortcuts: Ctrl+R, Ctrl+Shift+R, F5, Alt+Left/Right, mouse back/forward, Ctrl+Plus/Minus/0, Ctrl+wheel, Ctrl+, opens settings, F11 fullscreen. F12 does nothing unless **Allow developer tools** is on.

### Playback and media

- [ ] Play a song: the Windows media overlay (volume flyout / quick settings) shows title, artist and cover.
- [ ] Keyboard play/pause, next and previous keys work, including while another app is focused.
- [ ] Overlay buttons work. Next/previous are enabled when Suno exposes them.
- [ ] Taskbar thumbnail (hover the taskbar icon): previous, play/pause, next work; the play/pause icon follows state.
- [ ] Close the window with close-to-tray on: music keeps playing, a one-time "still running" notification appears.
- [ ] Tray icon: click toggles the window; menu shows the current song, Play/Pause, Next, Previous, Settings, Quit.
- [ ] With close-to-tray off, closing the window quits the app.
- [ ] Video fullscreen (if a song has video) fills the window and Esc exits.

### Deep links

Use Win+R or a browser address bar.

- [ ] `suno-desktop://open?path=/create` with the app closed: app starts on the Create page.
- [ ] Same with the app running (and minimized to tray): the existing window comes to front and navigates; no second instance.
- [ ] `suno-desktop://open?path=//example.com` is ignored.
- [ ] `suno-desktop://plugin/install?id=test` shows "Plugins aren't available yet".
- [ ] Launching the app a second time from the Start menu focuses the existing window.

### Downloads

- [ ] **Ask where to save** on: the save dialog appears with a sensible file name.
- [ ] Off, with a custom folder: file is saved there; downloading the same song twice gives `name (1).ext`.
- [ ] Taskbar icon shows download progress.
- [ ] "Download complete" notification appears; **Show in folder** (button or click) opens Explorer with the file selected.

### Discord Rich Presence

Needs a build with a real Discord application id in `config/app.config.json`, and the Discord desktop app running.

- [ ] Off by default; turning it on shows "Listening to <app name>" with title, artist, cover and a progress bar.
- [ ] Pause shows "Paused", skipping updates the song, seeking updates the progress bar.
- [ ] A friend sees the **Listen on Suno** button and it opens the song (Discord hides buttons from yourself).
- [ ] Turning it off clears the activity. Starting Discord after the app connects within about 2 minutes.

### Microphone

- [ ] Using a Suno feature that records audio shows "Allow suno.com to use your microphone?". Allow works; Block keeps the mic off until restart.

### Settings

- [ ] Launch on startup + start minimized: after signing in to Windows the app is in the tray only.
- [ ] Hardware acceleration off: restart banner appears, **Restart now** relaunches, the app still renders.
- [ ] Zoom slider matches Ctrl+Plus/Minus and persists.
- [ ] About page shows the version and the "not affiliated with Suno, Inc." notice; links open GitHub in the browser.

### Offline

- [ ] Disconnect the network and reload: the offline page appears instead of a white screen.
- [ ] **Try again** while offline keeps the page; reconnecting retries automatically and suno.com loads.

### Auto-update

- [ ] Install version N from a published release. Publish version N+1 (tag `vN+1`, wait for the workflow, publish the draft).
- [ ] Within a minute of launching N, Settings → Updates shows the download, then "ready"; **Restart to update** installs N+1 and you are still signed in.
- [ ] Beta channel: with a published pre-release (e.g. `v0.2.0-beta.1`), switching to Beta offers it; stable users do not get it.
- [ ] Portable exe: Settings → Updates says portable builds do not auto-update.

### Portable

- [ ] `Suno-Desktop-Portable-<version>-x64.exe` runs without installing, shares the same user data (signed in), and `suno-desktop://` links open it.
