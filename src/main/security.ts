import { app, dialog, type BrowserWindow, type Session, type WebContents } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { Logger } from './logger'
import { decidePermissionCheck, decidePermissionRequest } from './permission-policy'
import { cleanUserAgent } from './user-agent'

export function chromeUserAgent(userAgent: string): string {
  return cleanUserAgent(userAgent, [APP_NAME, app.getName(), 'suno-desktop'])
}

/** Global guards for every webContents the app creates. Windows override the popup handler. */
export function hardenAllWebContents(log: Logger): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      log.warn('blocked <webview> attachment')
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

export interface SunoSessionOptions {
  readonly log: Logger
  /** Window to parent the microphone prompt to. */
  readonly getParentWindow: () => BrowserWindow | null
}

/** Permission handlers and user agent for the persistent suno.com session. */
export function hardenSunoSession(ses: Session, options: SunoSessionOptions): void {
  const { log } = options
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()))

  // Remembered for this run only, like a browser tab's "allow this time".
  let microphone: 'unknown' | 'granted' | 'denied' = 'unknown'
  let prompt: Promise<boolean> | null = null

  const askMicrophone = async (): Promise<boolean> => {
    if (microphone !== 'unknown') return microphone === 'granted'
    prompt ??= (async () => {
      const parent = options.getParentWindow()
      const message = {
        type: 'question' as const,
        buttons: ['Allow', 'Block'],
        defaultId: 1,
        cancelId: 1,
        title: APP_NAME,
        message: 'Allow suno.com to use your microphone?',
        detail:
          'Suno asked for microphone access, which it uses for recording audio. ' +
          'Your choice is remembered until you restart Suno Desktop.'
      }
      const { response } = parent
        ? await dialog.showMessageBox(parent, message)
        : await dialog.showMessageBox(message)
      microphone = response === 0 ? 'granted' : 'denied'
      log.info(`microphone ${microphone} by user`)
      return microphone === 'granted'
    })()
    try {
      return await prompt
    } finally {
      prompt = null
    }
  }

  ses.setPermissionRequestHandler((_contents: WebContents, permission, callback, details) => {
    const decision = decidePermissionRequest({
      permission,
      requestingUrl: details.requestingUrl,
      mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined
    })
    if (decision === 'ask') {
      askMicrophone().then(callback, () => {
        callback(false)
      })
      return
    }
    if (decision === 'deny') log.info(`denied permission "${permission}"`, details.requestingUrl)
    callback(decision === 'allow')
  })

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    decidePermissionCheck({
      permission,
      requestingOrigin,
      mediaType: details.mediaType,
      microphoneGranted: microphone === 'granted'
    })
  )

  ses.setDevicePermissionHandler(() => false)
}
