/** Inline 16px stroke icons in the spirit of Fluent System Icons (drawn for this project). */

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  back: svg('<path d="M13 8H3.5M7.5 3.5 3 8l4.5 4.5"/>'),
  forward: svg('<path d="M3 8h9.5M8.5 3.5 13 8l-4.5 4.5"/>'),
  reload: svg('<path d="M13 3.5V6.5H10"/><path d="M12.7 6.3A5 5 0 1 0 13 9"/>'),
  home: svg('<path d="M2.5 7 8 2.5 13.5 7"/><path d="M4 6v7h3v-3.5h2V13h3V6"/>'),
  settings: svg(
    '<path d="M6.9 1.75h2.2l.4 1.6c.45.17.86.4 1.23.7l1.58-.47 1.1 1.9-1.18 1.13a4.6 4.6 0 0 1 0 1.42l1.18 1.13-1.1 1.9-1.58-.47c-.37.3-.78.53-1.23.7l-.4 1.6H6.9l-.4-1.6a4.6 4.6 0 0 1-1.23-.7l-1.58.47-1.1-1.9 1.18-1.13a4.6 4.6 0 0 1 0-1.42L2.59 5.48l1.1-1.9 1.58.47c.37-.3.78-.53 1.23-.7z"/><circle cx="8" cy="8" r="1.9"/>'
  ),
  offline: svg(
    '<path d="M2 2l12 12"/><path d="M5.3 9.2a4 4 0 0 1 2.4-1M3 7a7 7 0 0 1 2.6-1.6M13 7a7 7 0 0 0-4.4-1.9"/><circle cx="8" cy="12" r=".75" fill="currentColor"/>'
  ),
  warning: svg(
    '<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3"/><circle cx="8" cy="11.5" r=".5" fill="currentColor"/>'
  )
}
