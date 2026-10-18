import iconUrl from '../../../resources/icon.png'
import { REPO_URL } from '../../shared/constants'
import type { AppInfo, UpdateState } from '../../shared/ipc-channels'
import type { Settings, SettingsPatch } from '../../shared/settings'

const ui = window.sunoDesktopUI

function el<T extends HTMLElement = HTMLElement>(
  id: string,
  type: new () => T = HTMLElement as new () => T
): T {
  const node = document.getElementById(id)
  if (!(node instanceof type)) throw new Error(`#${id} missing`)
  return node
}

const all = <T extends Element>(selector: string): T[] => [
  ...document.querySelectorAll<T>(selector)
]

let info: AppInfo | null = null
let current: Settings | null = null

for (const img of all<HTMLImageElement>('[data-app-icon]')) img.src = iconUrl

// --- tabs -----------------------------------------------------------------------------------

function selectTab(name: string): void {
  for (const tab of all<HTMLButtonElement>('[data-tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset['tab'] === name))
    tab.tabIndex = tab.dataset['tab'] === name ? 0 : -1
  }
  for (const panel of all<HTMLElement>('[data-panel]'))
    panel.hidden = panel.dataset['panel'] !== name
  try {
    sessionStorage.setItem('settings-tab', name)
  } catch {
    // Storage may be unavailable; the first tab is fine.
  }
}

for (const tab of all<HTMLButtonElement>('[data-tab]')) {
  tab.addEventListener('click', () => {
    selectTab(tab.dataset['tab'] ?? 'general')
  })
}

let initialTab = 'general'
try {
  initialTab = sessionStorage.getItem('settings-tab') ?? 'general'
} catch {
  // ignore
}
selectTab(initialTab)

// --- settings binding -----------------------------------------------------------------------

async function update(patch: SettingsPatch): Promise<void> {
  try {
    render(await ui.settings.update(patch))
  } catch (error) {
    console.error('settings update failed', error)
    if (current) render(current)
  }
}

for (const input of all<HTMLInputElement>('input[type="checkbox"][data-setting]')) {
  input.addEventListener('change', () => {
    const key = input.dataset['setting'] as keyof SettingsPatch
    void update({ [key]: input.checked })
  })
}

for (const select of all<HTMLSelectElement>('select[data-setting]')) {
  select.addEventListener('change', () => {
    const key = select.dataset['setting'] as keyof SettingsPatch
    void update({ [key]: select.value })
  })
}

const zoom = el('zoom', HTMLInputElement)
const zoomValue = el('zoom-value', HTMLOutputElement)
zoom.addEventListener('input', () => {
  zoomValue.textContent = `${zoom.value}%`
})
zoom.addEventListener('change', () => {
  void update({ zoomFactor: Number(zoom.value) / 100 })
})
el('zoom-reset').addEventListener('click', () => {
  void update({ zoomFactor: 1 })
})

el('download-change').addEventListener('click', () => {
  void ui.settings.chooseDownloadFolder().then(render)
})
el('download-reset').addEventListener('click', () => {
  void update({ downloadFolder: null })
})

el('clear-session').addEventListener('click', () => {
  void ui.settings.clearSession()
})
el('reset-app').addEventListener('click', () => {
  void ui.settings.resetApp()
})
el('restart').addEventListener('click', () => {
  void ui.app.relaunch()
})

for (const button of all<HTMLButtonElement>('[data-link]')) {
  button.addEventListener('click', () => {
    void ui.app.openExternal(`${REPO_URL}${button.dataset['link'] ?? ''}`)
  })
}

function render(settings: Settings): void {
  current = settings
  for (const input of all<HTMLInputElement>('input[type="checkbox"][data-setting]')) {
    const key = input.dataset['setting'] as keyof Settings
    input.checked = settings[key] === true
    const state = input.parentElement?.querySelector('.toggle-state')
    if (state) state.textContent = input.checked ? 'On' : 'Off'
  }
  for (const select of all<HTMLSelectElement>('select[data-setting]')) {
    const key = select.dataset['setting'] as keyof Settings
    select.value = String(settings[key])
  }
  const percent = Math.round(settings.zoomFactor * 100)
  zoom.value = String(percent)
  zoomValue.textContent = `${percent}%`
  el('download-folder').textContent = settings.downloadFolder ?? 'Your Downloads folder'
  el('download-reset', HTMLButtonElement).disabled = settings.downloadFolder === null
  el('restart-banner').hidden =
    !info || info.hardwareAccelerationAtLaunch === settings.hardwareAcceleration
}

// --- updates ----------------------------------------------------------------------------------

function renderUpdate(state: UpdateState): void {
  const status = el('update-status')
  const check = el('update-check', HTMLButtonElement)
  const install = el('update-install', HTMLButtonElement)
  install.hidden = state.status !== 'downloaded'
  check.disabled =
    state.status === 'disabled' || state.status === 'checking' || state.status === 'downloading'
  const version = state.version ? ` ${state.version}` : ''
  const messages: Record<UpdateState['status'], string> = {
    disabled: state.message ?? 'Automatic updates are off for this build.',
    idle: 'Updates are checked automatically.',
    checking: 'Checking for updates…',
    available: `Update${version} found. Downloading…`,
    'not-available': "You're up to date.",
    downloading: `Downloading update${version}… ${state.percent ?? 0}%`,
    downloaded: `Update${version} is ready. It installs when you quit, or restart now.`,
    error: `Couldn't check for updates: ${state.message ?? 'unknown error'}`
  }
  status.textContent = messages[state.status]
}

el('update-check').addEventListener('click', () => void ui.updates.check())
el('update-install').addEventListener('click', () => void ui.updates.install())

// --- startup --------------------------------------------------------------------------------

async function init(): Promise<void> {
  info = await ui.app.getInfo()
  el('update-title').textContent = `Suno Desktop ${info.version}`
  el('about-version').textContent = `Version ${info.version}${info.isPortable ? ' (portable)' : ''}`
  el('about-runtime').textContent =
    `Electron ${info.electron} · Chromium ${info.chrome} · ${info.platform} ${info.arch}`

  const discord = all<HTMLInputElement>('input[data-setting="discordRichPresence"]')[0]
  if (!info.discordConfigured && discord) {
    discord.disabled = true
    el('discord-desc').textContent =
      'Not available in this build: no Discord application id is configured.'
  }
  if (!info.isPackaged) {
    const startup = all<HTMLInputElement>('input[data-setting="launchOnStartup"]')[0]
    if (startup) startup.title = 'Only applied in installed builds.'
  }

  if (info.pluginsAvailable) {
    for (const node of all<HTMLElement>('[data-tab="plugins"]')) node.hidden = false
    el('plugins-dir').textContent = `Plugins folder: ${info.pluginsDir}`
    const plugins = await ui.plugins.list()
    el('plugins-empty').hidden = plugins.length > 0
    const list = el('plugin-list')
    list.replaceChildren(
      ...plugins.map((p) => {
        const item = document.createElement('li')
        item.textContent = `${p.name} ${p.version}${p.enabled ? '' : ' (disabled)'}`
        return item
      })
    )
  }

  if (info.themesAvailable) {
    for (const node of all<HTMLElement>('[data-tab="themes"]')) node.hidden = false
    el('themes-dir').textContent = `Themes folder: ${info.themesDir}`
    const themes = await ui.themes.list()
    el('themes-empty').hidden = themes.length > 0
    el('theme-list').replaceChildren(
      ...themes.map((t) => {
        const item = document.createElement('li')
        item.textContent = `${t.name} ${t.version} by ${t.author}${t.active ? ' (active)' : ''}`
        return item
      })
    )
  }

  render(await ui.settings.get())
  renderUpdate(await ui.updates.getState())
}

ui.settings.onChanged(render)
ui.updates.onState(renderUpdate)
void init()
