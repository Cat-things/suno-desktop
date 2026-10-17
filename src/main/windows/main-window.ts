import os from 'node:os'
import {
  BrowserWindow,
  nativeTheme,
  screen,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type Event,
  type Input,
  type Session
} from 'electron'
import { APP_NAME, HOME_URL, TITLEBAR_HEIGHT } from '../../shared/constants'
import { IPC, type NavState, type OfflineInfo } from '../../shared/ipc-channels'
import { clampZoom, ZOOM_STEP } from '../../shared/settings'
import { classifyNavigation } from '../../shared/url-policy'
import {
  fitToDisplays,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowState
} from '../../shared/window-state'
import { attachContextMenu } from '../context-menu'
import { Injector } from '../injection/injector'
import type { InjectionRegistry } from '../injection/registry'
import type { RoleRegistry } from '../ipc/router'
import type { Logger } from '../logger'
import { authPopupWebPreferences, guardSunoNavigation } from '../navigation'
import { preloadPath } from '../paths'
import type { SettingsStore } from '../settings-store'
import { matchShortcut } from '../shortcuts'
import type { WindowStateStore } from '../window-state-store'
import { contentViewBounds, supportsMica, titleBarOverlayColors, windowBackground } from './layout'
import { loadLocalPage, localUiWebPreferences } from './local-ui'

export interface MainWindowDeps {
  readonly settings: SettingsStore
  readonly windowState: WindowStateStore
  readonly roles: RoleRegistry
  readonly session: Session
  readonly injection: InjectionRegistry
  readonly log: Logger
  readonly icon: string
  readonly appVersion: string
  readonly devToolsAllowed: () => boolean
  readonly openSettings: () => void
  /** True when closing the window should hide it to the tray. */
  readonly shouldHideOnClose: () => boolean
  readonly onHiddenToTray: () => void
  readonly onQuitRequested: () => void
}

/**
 * The main window: a frameless BrowserWindow whose own webContents renders the local title bar,
 * with suno.com in a WebContentsView underneath and an offline page overlay on top when needed.
 */
export class MainWindow {
  readonly window: BrowserWindow
  readonly view: WebContentsView
  private overlay: WebContentsView | null = null
  private offline: OfflineInfo | null = null
  private loadFailed = false
  private quitting = false
  private shownOnce = false
  private readonly mica: boolean
  private readonly restored: WindowState
  private readonly onThemeUpdated = (): void => {
    this.applyTheme()
  }

  constructor(private readonly deps: MainWindowDeps) {
    this.mica = supportsMica(process.platform, os.release())
    const dark = nativeTheme.shouldUseDarkColors
    this.restored = this.restoreState()

    this.window = new BrowserWindow({
      ...(this.restored.x !== undefined && this.restored.y !== undefined
        ? { x: this.restored.x, y: this.restored.y }
        : {}),
      width: this.restored.width,
      height: this.restored.height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      title: APP_NAME,
      icon: deps.icon,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...titleBarOverlayColors(dark, this.mica), height: TITLEBAR_HEIGHT },
      ...(this.mica ? { backgroundMaterial: 'mica' as const } : {}),
      backgroundColor: windowBackground(dark, this.mica),
      webPreferences: localUiWebPreferences()
    })
    deps.roles.assign(this.window.webContents, 'titlebar')

    this.view = new WebContentsView({
      webPreferences: {
        session: deps.session,
        preload: preloadPath('suno'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: true,
        safeDialogs: true,
        navigateOnDragDrop: false,
        // Keep the player's timers (auto-advance, progress) running while hidden in the tray.
        backgroundThrottling: false,
        additionalArguments: [`--suno-desktop-version=${deps.appVersion}`]
      }
    })
    this.view.setBackgroundColor(dark ? '#000000' : '#ffffff')
    deps.roles.assign(this.view.webContents, 'suno')
    this.window.contentView.addChildView(this.view)

    this.wireWindow()
    this.wireContent()
    nativeTheme.on('updated', this.onThemeUpdated)
    new Injector(this.view.webContents, deps.injection, deps.log.child('injector')).attach()

    this.layout()
    void loadLocalPage(this.window.webContents, 'titlebar')
    void this.view.webContents.loadURL(HOME_URL)
  }

  get contents(): Electron.WebContents {
    return this.view.webContents
  }

  // --- window lifecycle -----------------------------------------------------------------

  private restoreState(): WindowState {
    const displays = screen.getAllDisplays().map((d) => d.workArea)
    return fitToDisplays(
      this.deps.windowState.load(),
      displays,
      screen.getPrimaryDisplay().workArea
    )
  }

  private wireWindow(): void {
    const w = this.window
    for (const event of [
      'resize',
      'maximize',
      'unmaximize',
      'restore',
      'enter-full-screen',
      'leave-full-screen'
    ] as const) {
      w.on(event as 'resize', () => {
        this.layout()
      })
    }
    w.on('resize', () => {
      this.saveState()
    })
    w.on('move', () => {
      this.saveState()
    })
    w.on('focus', () => {
      ;(this.offline ? this.overlay : this.view)?.webContents.focus()
    })
    w.on('app-command', (_event, command) => {
      if (command === 'browser-backward') this.back()
      if (command === 'browser-forward') this.forward()
    })
    w.on('close', (event) => {
      this.saveState()
      if (this.quitting) return
      event.preventDefault()
      if (this.deps.shouldHideOnClose()) {
        w.hide()
        this.deps.onHiddenToTray()
      } else {
        this.deps.onQuitRequested()
      }
    })
    w.on('closed', () => {
      nativeTheme.off('updated', this.onThemeUpdated)
    })
    w.webContents.on('before-input-event', (event, input) => {
      this.handleInput(event, input)
    })
  }

  /** Lets the next close event through (called from `before-quit`). */
  markQuitting(): void {
    this.quitting = true
  }

  private saveState(): void {
    const w = this.window
    if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return
    const b = w.getNormalBounds()
    this.deps.windowState.save({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(MIN_WINDOW_WIDTH, Math.round(b.width)),
      height: Math.max(MIN_WINDOW_HEIGHT, Math.round(b.height)),
      maximized: w.isMaximized()
    })
  }

  private layout(): void {
    if (this.window.isDestroyed()) return
    const [width = 0, height = 0] = this.window.getContentSize()
    const bounds = contentViewBounds({ width, height }, TITLEBAR_HEIGHT, this.window.isFullScreen())
    this.view.setBounds(bounds)
    this.overlay?.setBounds(bounds)
  }

  show(): void {
    const w = this.window
    if (w.isMinimized()) w.restore()
    if (!this.shownOnce && this.restored.maximized) w.maximize()
    this.shownOnce = true
    w.show()
    w.focus()
  }

  /** Start-minimized without close-to-tray: sit in the taskbar instead of the tray. */
  showMinimized(): void {
    this.shownOnce = true
    this.window.minimize()
  }

  hide(): void {
    this.window.hide()
  }

  isVisible(): boolean {
    return this.window.isVisible() && !this.window.isMinimized()
  }

  toggleVisibility(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  // --- suno.com view ----------------------------------------------------------------------

  private wireContent(): void {
    const wc = this.view.webContents
    const log = this.deps.log

    guardSunoNavigation(wc, {
      log: log.child('nav'),
      openInMainView: (url) => {
        this.loadUrl(url)
      },
      popupOptions: () => this.popupOptions(),
      onPopupCreated: (popup) => {
        attachContextMenu(popup, {
          log,
          devToolsAllowed: this.deps.devToolsAllowed,
          pageNavigation: false
        })
      }
    })
    attachContextMenu(wc, { log, devToolsAllowed: this.deps.devToolsAllowed, pageNavigation: true })

    wc.on('did-start-loading', () => {
      this.loadFailed = false
      this.pushNavState()
    })
    wc.on('did-stop-loading', () => {
      if (!this.loadFailed) this.hideOverlay()
      this.pushNavState()
    })
    wc.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
      // -3 (ERR_ABORTED) means the navigation was replaced or cancelled, not a failure.
      if (!isMainFrame || errorCode === -3) return
      this.loadFailed = true
      log.warn(`load failed: ${errorCode} ${errorDescription}`, url)
      this.showOverlay({ kind: 'load-failed', url, errorCode, errorDescription })
    })
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      log.error('suno.com renderer gone', details)
      this.showOverlay({
        kind: 'crashed',
        url: wc.getURL(),
        errorCode: details.exitCode,
        errorDescription: details.reason
      })
    })
    wc.on('did-navigate', () => {
      this.applyZoom()
      this.pushNavState()
    })
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.pushNavState()
      let path = '/'
      try {
        path = new URL(url).pathname
      } catch {
        // keep "/"
      }
      wc.send(IPC.bridgeEvent, { event: 'routeChanged', payload: { url, path } })
    })
    wc.on('page-title-updated', () => {
      this.pushNavState()
    })
    wc.on('zoom-changed', (_event, direction) => {
      this.zoomBy(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP)
    })
    wc.on('enter-html-full-screen', () => {
      this.layout()
    })
    wc.on('leave-html-full-screen', () => {
      this.layout()
    })
    wc.on('before-input-event', (event, input) => {
      this.handleInput(event, input)
    })
    wc.on('devtools-opened', () => {
      if (!this.deps.devToolsAllowed()) wc.closeDevTools()
    })
    wc.on('unresponsive', () => {
      log.warn('suno.com view is unresponsive')
    })
  }

  private popupOptions(): BrowserWindowConstructorOptions {
    const dark = nativeTheme.shouldUseDarkColors
    return {
      parent: this.window,
      width: 520,
      height: 720,
      minWidth: 360,
      minHeight: 480,
      autoHideMenuBar: true,
      title: `Sign in – ${APP_NAME}`,
      icon: this.deps.icon,
      backgroundColor: dark ? '#202020' : '#ffffff',
      webPreferences: authPopupWebPreferences()
    }
  }

  loadUrl(url: string): void {
    if (classifyNavigation(url) !== 'allow') {
      this.deps.log.warn('refused to load URL in main view', url)
      return
    }
    void this.view.webContents.loadURL(url).catch(() => undefined)
  }

  goHome(): void {
    this.loadUrl(HOME_URL)
  }

  back(): void {
    const history = this.view.webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
  }

  forward(): void {
    const history = this.view.webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
  }

  reload(): void {
    if (this.offline) this.retry()
    else this.view.webContents.reload()
  }

  hardReload(): void {
    if (this.offline) this.retry()
    else this.view.webContents.reloadIgnoringCache()
  }

  retry(): void {
    const target = this.offline?.url
    this.loadUrl(target && classifyNavigation(target) === 'allow' ? target : HOME_URL)
  }

  currentUrl(): string {
    return this.view.webContents.getURL()
  }

  navState(): NavState {
    const wc = this.view.webContents
    return {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
      title: wc.getTitle(),
      url: wc.getURL()
    }
  }

  private pushNavState(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(IPC.navState, this.navState())
  }

  // --- offline overlay --------------------------------------------------------------------

  offlineInfo(): OfflineInfo | null {
    return this.offline
  }

  private showOverlay(info: OfflineInfo): void {
    this.offline = info
    if (!this.overlay) {
      const overlay = new WebContentsView({ webPreferences: localUiWebPreferences() })
      overlay.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors, false))
      this.deps.roles.assign(overlay.webContents, 'offline')
      overlay.webContents.on('before-input-event', (event, input) => {
        this.handleInput(event, input)
      })
      void loadLocalPage(overlay.webContents, 'offline')
      this.overlay = overlay
    }
    // Re-adding moves the view to the top of the stack.
    this.window.contentView.addChildView(this.overlay)
    this.overlay.setVisible(true)
    this.layout()
    this.overlay.webContents.send(IPC.offlineInfo, info)
    this.pushNavState()
  }

  private hideOverlay(): void {
    if (!this.offline) return
    this.offline = null
    this.overlay?.setVisible(false)
    this.view.webContents.focus()
  }

  // --- input, zoom, theme -----------------------------------------------------------------

  private handleInput(event: Event, input: Input): void {
    const action = matchShortcut(input)
    if (!action) return
    event.preventDefault()
    switch (action) {
      case 'reload':
        this.reload()
        break
      case 'hardReload':
        this.hardReload()
        break
      case 'back':
        this.back()
        break
      case 'forward':
        this.forward()
        break
      case 'zoomIn':
        this.zoomBy(ZOOM_STEP)
        break
      case 'zoomOut':
        this.zoomBy(-ZOOM_STEP)
        break
      case 'zoomReset':
        this.setZoom(1)
        break
      case 'openSettings':
        this.deps.openSettings()
        break
      case 'toggleFullscreen':
        this.window.setFullScreen(!this.window.isFullScreen())
        break
      case 'toggleDevTools':
        if (this.deps.devToolsAllowed()) this.view.webContents.toggleDevTools()
        break
    }
  }

  setZoom(factor: number): void {
    this.deps.settings.update({ zoomFactor: clampZoom(factor) })
  }

  private zoomBy(delta: number): void {
    this.setZoom(this.deps.settings.get().zoomFactor + delta)
  }

  /** Called on navigation and whenever the zoom setting changes. */
  applyZoom(): void {
    this.view.webContents.setZoomFactor(this.deps.settings.get().zoomFactor)
  }

  private applyTheme(): void {
    if (this.window.isDestroyed()) return
    const dark = nativeTheme.shouldUseDarkColors
    if (process.platform !== 'darwin') {
      this.window.setTitleBarOverlay({
        ...titleBarOverlayColors(dark, this.mica),
        height: TITLEBAR_HEIGHT
      })
    }
    if (!this.mica) this.window.setBackgroundColor(windowBackground(dark, false))
    this.view.setBackgroundColor(dark ? '#000000' : '#ffffff')
    this.overlay?.setBackgroundColor(windowBackground(dark, false))
  }
}
