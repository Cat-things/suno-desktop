import iconUrl from '../../../resources/icon.png'
import { REPO_URL, SPP_REPO_URL } from '../../shared/constants'
import type { AppInfo, UpdateState } from '../../shared/ipc-channels'
import type { Settings, SettingsPatch } from '../../shared/settings'
import type {
  SppAction,
  SppInfo,
  SppPlugin,
  SppSetting,
  SppState,
  SppTheme
} from '../../shared/sunoplusplus'

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
    const value = settings[select.dataset['setting'] as keyof Settings]
    if (typeof value === 'string') select.value = value
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

  render(await ui.settings.get())
  renderUpdate(await ui.updates.getState())
  renderSpp(await ui.sunoPlusPlus.getInfo())
}

// --- Suno++ -------------------------------------------------------------------------------------

/** Plugins, settings and themes come from Suno++'s catalog: build them without innerHTML. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value)
  for (const child of children) if (child !== null && child !== false) node.append(child)
  return node
}

let sppStructure = ''

function act(action: SppAction, rerender = true): void {
  void ui.sunoPlusPlus.act(action).then((info) => {
    if (rerender) renderSpp(info)
  })
}

function sppToggle(
  id: string,
  checked: boolean,
  label: string,
  onChange: (on: boolean) => void
): HTMLElement {
  const input = h('input', { attrs: { type: 'checkbox', id, 'aria-label': label } })
  input.checked = checked
  const state = h('span', { class: 'toggle-state', text: checked ? 'On' : 'Off' })
  input.addEventListener('change', () => {
    state.textContent = input.checked ? 'On' : 'Off'
    onChange(input.checked)
  })
  return h('label', { class: 'toggle' }, state, input, h('span', { class: 'track' }))
}

function settingControl(
  plugin: SppPlugin,
  def: SppSetting,
  value: unknown,
  id: string
): HTMLElement {
  const save = (next: boolean | string | number): void => {
    act({ type: 'setPluginSetting', id: plugin.id, key: def.key, value: next }, false)
  }
  switch (def.type) {
    case 'boolean':
      // Nothing saved yet means the plugin uses its default, so show that.
      return sppToggle(id, typeof value === 'boolean' ? value : def.default, def.label, save)
    case 'string': {
      const input = h('input', {
        class: 'text-input',
        attrs: {
          type: 'text',
          id,
          maxlength: String(def.maxLength),
          placeholder: def.placeholder ?? ''
        }
      })
      input.value = typeof value === 'string' ? value : def.default
      input.addEventListener('change', () => save(input.value.slice(0, def.maxLength)))
      return input
    }
    case 'number': {
      const input = h('input', { class: 'text-input number', attrs: { type: 'number', id } })
      if (def.min !== undefined) input.min = String(def.min)
      if (def.max !== undefined) input.max = String(def.max)
      if (def.step !== undefined) input.step = String(def.step)
      const current = typeof value === 'number' ? value : def.default
      input.value = String(current)
      input.addEventListener('change', () => {
        const next = Number(input.value)
        const ok =
          input.value !== '' &&
          Number.isFinite(next) &&
          next >= (def.min ?? -Infinity) &&
          next <= (def.max ?? Infinity)
        if (ok) save(next)
        else input.value = String(current)
      })
      return input
    }
    case 'select': {
      const select = h(
        'select',
        { class: 'select', attrs: { id } },
        ...def.options.map((o) => h('option', { text: o.label, attrs: { value: o.value } }))
      )
      select.value =
        typeof value === 'string' && def.options.some((o) => o.value === value)
          ? value
          : def.default
      select.addEventListener('change', () => save(select.value))
      return select
    }
  }
}

const byline = (authors: readonly { name: string }[]): string =>
  `by ${authors.map((a) => a.name).join(', ')}`

function pluginCard(plugin: SppPlugin, state: SppState): HTMLElement {
  const on = state.enabled[plugin.id] ?? plugin.enabledByDefault
  const values = state.settings[plugin.id] ?? {}
  return h(
    'div',
    { class: on ? 'card spp-card on' : 'card spp-card' },
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'row-text' },
        h(
          'div',
          { class: 'row-title' },
          plugin.name,
          h('span', { class: 'spp-meta', text: `${plugin.version} · ${byline(plugin.authors)}` })
        ),
        h('div', { class: 'row-desc', text: plugin.description })
      ),
      sppToggle(`spp-plugin-${plugin.id}`, on, `Turn on ${plugin.name}`, (enabled) => {
        act({ type: 'setPluginEnabled', id: plugin.id, enabled })
      })
    ),
    ...(on
      ? plugin.settings.map((def) => {
          const id = `spp-setting-${plugin.id}-${def.key}`
          return h(
            'div',
            { class: 'row spp-setting' },
            h(
              'label',
              { class: 'row-text', attrs: { for: id } },
              h('div', { class: 'row-title', text: def.label }),
              def.description ? h('div', { class: 'row-desc', text: def.description }) : null
            ),
            settingControl(plugin, def, values[def.key], id)
          )
        })
      : [])
  )
}

const APPEARANCE: Record<SppTheme['appearance'], string> = {
  dark: 'Dark',
  light: 'Light',
  any: 'Light & dark'
}

function themeRow(theme: SppTheme | null, state: SppState): HTMLElement[] {
  const id = `spp-theme-${theme?.id ?? 'none'}`
  const active = state.theme === (theme?.id ?? null)
  const radio = h('input', { attrs: { type: 'radio', name: 'spp-theme', id } })
  radio.checked = active
  radio.addEventListener('change', () => {
    if (radio.checked) act({ type: 'setTheme', id: theme?.id ?? null })
  })
  const rows: HTMLElement[] = [
    h(
      'label',
      { class: 'row spp-theme', attrs: { for: id } },
      radio,
      h(
        'div',
        { class: 'row-text' },
        h(
          'div',
          { class: 'row-title' },
          theme?.name ?? "Suno's own look",
          theme ? h('span', { class: 'spp-badge', text: APPEARANCE[theme.appearance] }) : null,
          theme
            ? h('span', { class: 'spp-meta', text: `${theme.version} · ${byline(theme.authors)}` })
            : null
        ),
        h('div', { class: 'row-desc', text: theme?.description ?? 'No theme.' })
      )
    )
  ]
  if (theme && active && theme.variables.length > 0) {
    const colors = state.themeVariables[theme.id] ?? {}
    for (const variable of theme.variables) {
      const inputId = `spp-color-${theme.id}-${variable.key}`
      const input = h('input', { class: 'color', attrs: { type: 'color', id: inputId } })
      input.value = colors[variable.key] ?? variable.default
      // Live preview while picking, without re-rendering (that would close the picker).
      input.addEventListener('input', () => {
        act(
          { type: 'setThemeVariable', id: theme.id, key: variable.key, value: input.value },
          false
        )
      })
      rows.push(
        h(
          'div',
          { class: 'row spp-setting' },
          h(
            'label',
            { class: 'row-text', attrs: { for: inputId } },
            h('div', { class: 'row-title', text: variable.label })
          ),
          input
        )
      )
    }
    const reset = h('button', {
      class: 'button',
      text: 'Reset colors',
      attrs: { id: `spp-reset-${theme.id}` }
    })
    reset.addEventListener('click', () => {
      act({ type: 'resetThemeVariables', id: theme.id })
    })
    rows.push(h('div', { class: 'row spp-setting' }, h('div', { class: 'row-text' }), reset))
  }
  return rows
}

function ago(time: number): string {
  const seconds = (Date.now() - time) / 1000
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(time).toLocaleDateString()
}

function sppStatus(info: SppInfo): string {
  switch (info.status) {
    case 'off':
      return ''
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading Suno++${info.latestVersion ? ` ${info.latestVersion}` : ''}…`
    case 'error':
      return `Couldn't update: ${info.message ?? 'unknown error'}.${info.installedVersion ? ` Still using ${info.installedVersion}.` : ''}`
    case 'idle':
      if (info.message) return info.message
      if (!info.installedVersion) return 'Not downloaded yet.'
      return info.lastChecked ? `Up to date · checked ${ago(info.lastChecked)}` : 'Up to date.'
  }
}

function renderSpp(info: SppInfo): void {
  for (const node of all<HTMLElement>('[data-spp-when-on]')) node.hidden = !info.enabled
  for (const node of all<HTMLElement>('[data-spp-when-off]')) node.hidden = info.enabled
  el('spp-version').textContent = info.installedVersion
    ? `Suno++ ${info.installedVersion}`
    : 'Suno++'
  el('spp-status').textContent = sppStatus(info)
  const check = el('spp-check', HTMLButtonElement)
  check.textContent = info.installedVersion ? 'Check for updates' : 'Download'
  check.disabled = info.status === 'checking' || info.status === 'downloading'

  // Rebuild the lists only when what they show changes. Setting values and colors are edited in
  // place, and rebuilding while someone types or picks a color would get in their way.
  const { catalog, state } = info
  const structure = JSON.stringify({
    on: info.enabled,
    version: catalog?.sunoplusplusVersion,
    plugins: catalog?.plugins.map((p) => state.enabled[p.id] ?? p.enabledByDefault),
    theme: state.theme,
    reset: Object.keys(state.themeVariables)
  })
  if (structure === sppStructure) return
  sppStructure = structure
  const focused = document.activeElement?.id
  el('spp-plugins').replaceChildren(
    ...(catalog
      ? catalog.plugins.length > 0
        ? catalog.plugins.map((p) => pluginCard(p, state))
        : [
            h(
              'div',
              { class: 'card info' },
              h('p', { text: 'No plugins yet. Be the first to make one!' })
            )
          ]
      : [])
  )
  el('spp-themes').replaceChildren(
    ...(catalog
      ? [
          h(
            'div',
            { class: 'card' },
            ...themeRow(null, state),
            ...catalog.themes.flatMap((t) => themeRow(t, state))
          )
        ]
      : [
          h(
            'div',
            { class: 'card info' },
            h('p', { text: 'Themes appear here once Suno++ is downloaded.' })
          )
        ])
  )
  if (focused) document.getElementById(focused)?.focus()
}

el('spp-check').addEventListener('click', () => {
  void ui.sunoPlusPlus.check().then(renderSpp)
})

for (const button of all<HTMLButtonElement>('[data-spp-link]')) {
  button.addEventListener('click', () => {
    void ui.app.openExternal(`${SPP_REPO_URL}${button.dataset['sppLink'] ?? ''}`)
  })
}

ui.settings.onChanged(render)
ui.updates.onState(renderUpdate)
ui.sunoPlusPlus.onInfo(renderSpp)
void init()
