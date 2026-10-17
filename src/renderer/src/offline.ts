import type { OfflineInfo } from '../../shared/ipc-channels'
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

const glyph = el('glyph')
const heading = el('heading')
const message = el('message')
const detail = el('detail')
const hint = el('hint')
const retry = el('retry', HTMLButtonElement)

retry.addEventListener('click', () => {
  retry.disabled = true
  void ui.nav.retry().finally(() => {
    setTimeout(() => {
      retry.disabled = false
    }, 1500)
  })
})
el('settings').addEventListener('click', () => void ui.app.openSettings())

function render(info: OfflineInfo | null): void {
  hint.hidden = true
  if (info?.kind === 'crashed') {
    glyph.innerHTML = icons.warning
    heading.textContent = 'Suno stopped unexpectedly'
    message.textContent = 'The page crashed or ran out of memory. Reloading usually fixes it.'
    retry.textContent = 'Reload'
    detail.textContent = `Reason: ${info.errorDescription}`
    return
  }
  glyph.innerHTML = icons.offline
  heading.textContent = navigator.onLine ? "Can't reach Suno" : "You're offline"
  message.textContent = navigator.onLine
    ? 'suno.com did not respond. It may be down, or something is blocking the connection.'
    : 'Check your internet connection. Suno Desktop will retry when you are back online.'
  retry.textContent = 'Try again'
  detail.textContent = info ? `${info.errorDescription} (${info.errorCode})` : ''
}

window.addEventListener('online', () => {
  hint.hidden = false
  void ui.nav.retry()
})
window.addEventListener('offline', () => {
  void ui.offline.getInfo().then(render)
})

ui.offline.onInfo(render)
void ui.offline.getInfo().then(render)
