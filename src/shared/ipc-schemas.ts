import { z } from 'zod'
import { APP_HOST, APP_SCHEME, REPO_URL } from './constants'
import { IPC, type IpcChannel } from './ipc-channels'
import { settingsPatchSchema, themeSourceSchema } from './settings'
import { SPP_REPO_URL, sppActionSchema } from './sunoplusplus'
import { isSunoAppUrl } from './url-policy'

/**
 * Runtime validation for every IPC message main accepts. Each channel declares which
 * renderer roles may use it and the payload shape; anything else is dropped.
 */

export type SenderRole = 'titlebar' | 'settings' | 'offline' | 'onboarding' | 'suno'

const noPayload = z.undefined()

const text = (max: number) => z.string().max(max)

export const artworkSchema = z.object({
  src: z.url({ protocol: /^https?$/ }).max(2048),
  sizes: text(64).optional(),
  type: text(64).optional()
})

export const songInfoSchema = z.object({
  title: text(512),
  artist: text(512),
  album: text(512),
  artwork: z.array(artworkSchema).max(16)
})

export const positionSchema = z.object({
  duration: z.number().min(0).max(86_400),
  position: z.number().min(0).max(86_400),
  playbackRate: z.number().min(0).max(16)
})

export const mediaSnapshotSchema = z.strictObject({
  song: songInfoSchema.nullable(),
  playbackState: z.enum(['none', 'paused', 'playing']),
  position: positionSchema.nullable(),
  canGoNext: z.boolean(),
  canGoPrevious: z.boolean()
})

export const mediaCommandSchema = z.enum(['play', 'pause', 'toggle', 'next', 'previous'])

const linkableRepos = [new URL(REPO_URL), new URL(SPP_REPO_URL)]

/** The settings window may only open links into this project's or Suno++'s GitHub repo. */
export const externalLinkSchema = z
  .string()
  .max(2048)
  .refine((raw) => {
    try {
      const url = new URL(raw)
      return linkableRepos.some(
        (repo) =>
          url.origin === repo.origin &&
          (url.pathname === repo.pathname || url.pathname.startsWith(`${repo.pathname}/`))
      )
    } catch {
      return false
    }
  }, 'link must point to the Suno Desktop or Suno++ repository')

interface Contract {
  readonly roles: readonly SenderRole[]
  readonly payload: z.ZodType
}

const LOCAL: readonly SenderRole[] = ['titlebar', 'settings', 'offline', 'onboarding']

/** Channels main listens on. Main -> renderer channels are not listed: they are never received. */
export const IPC_CONTRACTS = {
  [IPC.navBack]: { roles: ['titlebar'], payload: noPayload },
  [IPC.navForward]: { roles: ['titlebar'], payload: noPayload },
  [IPC.navReload]: { roles: ['titlebar'], payload: noPayload },
  [IPC.navHome]: { roles: ['titlebar', 'offline'], payload: noPayload },
  [IPC.navRetry]: { roles: ['offline'], payload: noPayload },
  [IPC.navGetState]: { roles: ['titlebar'], payload: noPayload },
  [IPC.openSettings]: { roles: ['titlebar', 'offline'], payload: noPayload },
  [IPC.settingsGet]: { roles: ['settings'], payload: noPayload },
  [IPC.settingsUpdate]: { roles: ['settings'], payload: settingsPatchSchema },
  [IPC.settingsChooseDownloadFolder]: { roles: ['settings'], payload: noPayload },
  [IPC.settingsResetApp]: { roles: ['settings'], payload: noPayload },
  [IPC.sessionClear]: { roles: ['settings'], payload: noPayload },
  [IPC.appGetInfo]: { roles: LOCAL, payload: noPayload },
  [IPC.appRelaunch]: { roles: ['settings'], payload: noPayload },
  [IPC.appOpenExternal]: { roles: ['settings'], payload: externalLinkSchema },
  [IPC.updateCheck]: { roles: ['settings'], payload: noPayload },
  [IPC.updateInstall]: { roles: ['settings'], payload: noPayload },
  [IPC.updateGetState]: { roles: ['settings'], payload: noPayload },
  [IPC.sunoPlusPlusGetInfo]: { roles: ['settings'], payload: noPayload },
  [IPC.sunoPlusPlusCheck]: { roles: ['settings'], payload: noPayload },
  [IPC.sunoPlusPlusAction]: { roles: ['settings'], payload: sppActionSchema },
  [IPC.offlineGetInfo]: { roles: ['offline'], payload: noPayload },
  [IPC.onboardingGetState]: { roles: ['onboarding'], payload: noPayload },
  [IPC.onboardingSetTheme]: { roles: ['onboarding'], payload: themeSourceSchema },
  [IPC.onboardingFinish]: { roles: ['onboarding'], payload: noPayload },
  [IPC.mediaUpdate]: { roles: ['suno'], payload: mediaSnapshotSchema }
} as const satisfies Partial<Record<IpcChannel, Contract>>

export type ContractChannel = keyof typeof IPC_CONTRACTS

export type IpcCheck =
  { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly reason: string }

export interface SenderInfo {
  /** Role main assigned to the sending webContents, or `undefined` if it is not ours. */
  readonly role: SenderRole | undefined
  /** URL of the sending frame. */
  readonly url: string
  readonly isMainFrame: boolean
}

export interface TrustOptions {
  /** electron-vite dev server origin, only set in development. */
  readonly devServerUrl?: string | undefined
}

/** Local UI is served from `app://ui/` (or the dev server while developing). */
export function isTrustedLocalUiUrl(raw: string, options: TrustOptions = {}): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) return true
  if (options.devServerUrl) {
    try {
      return url.origin === new URL(options.devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}

export function isTrustedSender(sender: SenderInfo, options: TrustOptions = {}): boolean {
  if (!sender.role || !sender.isMainFrame) return false
  return sender.role === 'suno'
    ? isSunoAppUrl(sender.url)
    : isTrustedLocalUiUrl(sender.url, options)
}

/** Validates the sender and payload of an incoming message against its contract. */
export function checkIpcMessage(
  channel: string,
  sender: SenderInfo,
  payload: unknown,
  options: TrustOptions = {}
): IpcCheck {
  if (!Object.hasOwn(IPC_CONTRACTS, channel)) return { ok: false, reason: 'unknown channel' }
  const contract: Contract = IPC_CONTRACTS[channel as ContractChannel]
  if (!isTrustedSender(sender, options)) return { ok: false, reason: 'untrusted sender' }
  if (!sender.role || !contract.roles.includes(sender.role)) {
    return { ok: false, reason: `role "${sender.role ?? 'none'}" may not use ${channel}` }
  }
  const parsed = contract.payload.safeParse(payload)
  if (!parsed.success) return { ok: false, reason: `invalid payload: ${parsed.error.message}` }
  return { ok: true, payload: parsed.data }
}
