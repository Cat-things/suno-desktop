import iconUrl from '../../../resources/icon.png'
import type { NavState } from '../../shared/ipc-channels'
import { icons } from './icons'

const ui = window.sunoDesktopUI

function el<T extends HTMLElement = HTMLElement>(
  id: string,
  type: new () => T = HTMLElement as new () => T
): T {
  const node = document.getElementById(id)
  if (!(node instanceof type)) throw new Error(`#${id} missing`)
  return node
}

const back = el('back', HTMLButtonElement)
const forward = el('forward', HTMLButtonElement)
const reload = el('reload', HTMLButtonElement)
const home = el('home', HTMLButtonElement)
const settings = el('settings', HTMLButtonElement)
const title = el('title')
const progress = el('progress')
const bar = el('titlebar')

el('app-icon', HTMLImageElement).src = iconUrl
back.innerHTML = icons.back
forward.innerHTML = icons.forward
reload.innerHTML = icons.reload
home.innerHTML = icons.home
settings.innerHTML = icons.settings

back.addEventListener('click', () => void ui.nav.back())
forward.addEventListener('click', () => void ui.nav.forward())
reload.addEventListener('click', () => void ui.nav.reload())
home.addEventListener('click', () => void ui.nav.home())
settings.addEventListener('click', () => void ui.app.openSettings())

function render(state: NavState): void {
  back.disabled = !state.canGoBack
  forward.disabled = !state.canGoForward
  bar.classList.toggle('loading', state.isLoading)
  progress.hidden = !state.isLoading
  const text = state.title.trim() || 'Suno Desktop'
  title.textContent = text
  document.title = text
}

ui.nav.onState(render)
void ui.nav.getState().then(render)
