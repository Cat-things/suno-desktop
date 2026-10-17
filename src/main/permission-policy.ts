import { isSunoAppUrl } from '../shared/url-policy'

/**
 * Permission policy for the suno.com session. Only suno.com gets anything, and only what the
 * site needs: notifications, clipboard writes, fullscreen video and (after asking) the microphone.
 */

export type PermissionDecision = 'allow' | 'deny' | 'ask'

const ALLOWED_FOR_SUNO = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])

export interface PermissionRequestInfo {
  readonly permission: string
  /** URL of the requesting frame. */
  readonly requestingUrl: string
  /** For `media`: which devices were requested ("audio", "video"). */
  readonly mediaTypes?: readonly string[]
}

/**
 * Microphone access returns `ask`: the caller shows a native prompt, so the user always knows
 * when Suno's recording feature wants the mic. Cameras are never granted.
 */
export function decidePermissionRequest(info: PermissionRequestInfo): PermissionDecision {
  if (!isSunoAppUrl(info.requestingUrl)) return 'deny'
  if (info.permission === 'media') {
    const types = info.mediaTypes ?? []
    if (types.length === 0 || types.some((t) => t !== 'audio')) return 'deny'
    return 'ask'
  }
  return ALLOWED_FOR_SUNO.has(info.permission) ? 'allow' : 'deny'
}

export interface PermissionCheckInfo {
  readonly permission: string
  readonly requestingOrigin: string
  readonly mediaType?: string
  /** Whether the user approved the microphone during this run. */
  readonly microphoneGranted: boolean
}

/** Synchronous checks (`navigator.permissions.query`, `Notification.permission`, device labels). */
export function decidePermissionCheck(info: PermissionCheckInfo): boolean {
  if (!isSunoAppUrl(info.requestingOrigin)) return false
  if (info.permission === 'media') return info.mediaType === 'audio' && info.microphoneGranted
  return ALLOWED_FOR_SUNO.has(info.permission)
}
