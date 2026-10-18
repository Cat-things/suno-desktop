import iconUrl from '../../../resources/icon.png'
import type { ThemeSource } from '../../shared/settings'
import { icons } from './icons'

const ui = window.sunoDesktopUI

const STEPS = ['welcome', 'theme', 'done'] as const
type Step = (typeof STEPS)[number]

const all = <T extends Element>(selector: string): T[] => [
  ...document.querySelectorAll<T>(selector)
]

for (const img of all<HTMLImageElement>('[data-app-icon]')) img.src = iconUrl
for (const el of all<HTMLElement>('[data-icon]')) {
  const name = el.dataset['icon'] as keyof typeof icons
  el.innerHTML = icons[name]
}

let current = 0
let finishing = false

function show(index: number): void {
  current = Math.max(0, Math.min(STEPS.length - 1, index))
  const step: Step = STEPS[current] ?? 'welcome'
  for (const section of all<HTMLElement>('[data-step]')) {
    section.hidden = section.dataset['step'] !== step
  }
  all<HTMLElement>('.dots li').forEach((dot, i) => dot.classList.toggle('active', i === current))
  const section = document.querySelector<HTMLElement>(`[data-step="${step}"]`)
  const target =
    step === 'theme'
      ? section?.querySelector<HTMLElement>('[aria-checked="true"]')
      : section?.querySelector<HTMLElement>('[data-next], [data-finish]')
  target?.focus()
}

async function finish(): Promise<void> {
  if (finishing) return
  finishing = true
  try {
    await ui.onboarding.finish()
  } catch (error) {
    finishing = false
    console.error('could not finish onboarding', error)
  }
}

for (const button of all<HTMLButtonElement>('[data-next]')) {
  button.addEventListener('click', () => {
    show(current + 1)
  })
}
for (const button of all<HTMLButtonElement>('[data-back]')) {
  button.addEventListener('click', () => {
    show(current - 1)
  })
}
for (const button of all<HTMLButtonElement>('[data-finish], [data-skip]')) {
  button.addEventListener('click', () => void finish())
}

// --- theme picker (a radio group of cards) -----------------------------------------------------

const cards = all<HTMLButtonElement>('[data-theme-choice]')

function select(theme: ThemeSource, apply: boolean): void {
  for (const card of cards) {
    const checked = card.dataset['themeChoice'] === theme
    card.setAttribute('aria-checked', String(checked))
    card.tabIndex = checked ? 0 : -1
  }
  if (apply) {
    ui.onboarding.setTheme(theme).catch((error: unknown) => {
      console.error('could not set theme', error)
    })
  }
}

cards.forEach((card, i) => {
  card.addEventListener('click', () => {
    select(card.dataset['themeChoice'] as ThemeSource, true)
    card.focus()
  })
  card.addEventListener('keydown', (event) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const next = cards[(i + delta + cards.length) % cards.length]
    if (!next) return
    select(next.dataset['themeChoice'] as ThemeSource, true)
    next.focus()
  })
})

void ui.onboarding.getState().then((state) => {
  select(state.theme, false)
  const fine = document.getElementById('fine')
  if (fine)
    fine.textContent = `Version ${state.version} · unofficial app, not affiliated with Suno, Inc.`
  show(0)
})
