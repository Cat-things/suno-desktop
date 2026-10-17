import {
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
  type ContextMenuParams
} from 'electron'
import { isSafeExternalUrl } from '../shared/url-policy'
import type { Logger } from './logger'
import { openExternalSafely } from './navigation'

export interface ContextMenuOptions {
  readonly log: Logger
  readonly devToolsAllowed: () => boolean
  /** Adds Back / Forward / Reload when right-clicking the page itself. */
  readonly pageNavigation: boolean
}

function editItems(params: ContextMenuParams): MenuItemConstructorOptions[] {
  const f = params.editFlags
  return [
    { role: 'undo', enabled: f.canUndo },
    { role: 'redo', enabled: f.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: f.canCut },
    { role: 'copy', enabled: f.canCopy },
    { role: 'paste', enabled: f.canPaste },
    { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: f.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: f.canSelectAll }
  ]
}

/** Electron ships no context menu at all; this provides the usual browser basics. */
export function attachContextMenu(contents: WebContents, options: ContextMenuOptions): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    const section = (entries: MenuItemConstructorOptions[]): void => {
      if (entries.length === 0) return
      if (items.length > 0) items.push({ type: 'separator' })
      items.push(...entries)
    }

    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions
        .slice(0, 5)
        .map((word): MenuItemConstructorOptions => ({
          label: word,
          click: () => {
            contents.replaceMisspelling(word)
          }
        }))
      section([
        ...(suggestions.length > 0 ? suggestions : [{ label: 'No suggestions', enabled: false }]),
        {
          label: 'Add to dictionary',
          click: () => {
            contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          }
        }
      ])
    }

    if (params.linkURL && isSafeExternalUrl(params.linkURL)) {
      section([
        {
          label: 'Open link in browser',
          click: () => {
            openExternalSafely(params.linkURL, options.log)
          }
        },
        {
          label: 'Copy link address',
          click: () => {
            clipboard.writeText(params.linkURL).catch(() => undefined)
          }
        }
      ])
    }

    if (params.mediaType === 'image' && params.srcURL.startsWith('https://')) {
      section([
        {
          label: 'Copy image',
          click: () => {
            contents.copyImageAt(params.x, params.y)
          }
        },
        {
          label: 'Save image as…',
          click: () => {
            contents.downloadURL(params.srcURL)
          }
        }
      ])
    }

    if (params.isEditable) {
      section(editItems(params))
    } else if (params.selectionText.trim() !== '') {
      section([{ role: 'copy' }])
    }

    if (
      options.pageNavigation &&
      !params.isEditable &&
      !params.linkURL &&
      params.mediaType === 'none' &&
      params.selectionText.trim() === ''
    ) {
      section([
        {
          label: 'Back',
          enabled: contents.navigationHistory.canGoBack(),
          click: () => {
            contents.navigationHistory.goBack()
          }
        },
        {
          label: 'Forward',
          enabled: contents.navigationHistory.canGoForward(),
          click: () => {
            contents.navigationHistory.goForward()
          }
        },
        {
          label: 'Reload',
          click: () => {
            contents.reload()
          }
        }
      ])
    }

    if (options.devToolsAllowed()) {
      section([
        {
          label: 'Inspect element',
          click: () => {
            contents.inspectElement(params.x, params.y)
          }
        }
      ])
    }

    if (items.length > 0) Menu.buildFromTemplate(items).popup()
  })
}
