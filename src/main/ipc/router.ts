import {
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import type { z } from 'zod'
import {
  checkIpcMessage,
  type IPC_CONTRACTS,
  type ContractChannel,
  type SenderInfo,
  type SenderRole,
  type TrustOptions
} from '../../shared/ipc-schemas'
import type { Logger } from '../logger'

export type PayloadOf<C extends ContractChannel> = z.output<(typeof IPC_CONTRACTS)[C]['payload']>

/** Tracks which of our webContents plays which role. Unknown senders get no role. */
export class RoleRegistry {
  private readonly roles = new Map<number, SenderRole>()

  assign(contents: WebContents, role: SenderRole): void {
    const id = contents.id
    this.roles.set(id, role)
    contents.once('destroyed', () => {
      if (this.roles.get(id) === role) this.roles.delete(id)
    })
  }

  get(contents: WebContents): SenderRole | undefined {
    return this.roles.get(contents.id)
  }

  /** Live webContents currently holding one of `roles`. */
  withRole(roles: readonly SenderRole[]): WebContents[] {
    const out: WebContents[] = []
    for (const [id, role] of this.roles) {
      const contents = webContents.fromId(id)
      if (contents && !contents.isDestroyed() && roles.includes(role)) out.push(contents)
    }
    return out
  }
}

/** Registers IPC handlers that only run after `checkIpcMessage` accepted sender and payload. */
export class IpcRouter {
  constructor(
    private readonly roles: RoleRegistry,
    private readonly trust: TrustOptions,
    private readonly log: Logger
  ) {}

  private sender(event: IpcMainEvent | IpcMainInvokeEvent): SenderInfo {
    const frame = event.senderFrame
    return {
      role: this.roles.get(event.sender),
      url: frame?.url ?? '',
      isMainFrame: frame !== null && frame.parent === null
    }
  }

  private check(
    channel: ContractChannel,
    event: IpcMainEvent | IpcMainInvokeEvent,
    payload: unknown
  ): { ok: true; payload: unknown } | { ok: false } {
    const sender = this.sender(event)
    const result = checkIpcMessage(channel, sender, payload, this.trust)
    if (!result.ok) {
      this.log.warn(`rejected IPC ${channel}: ${result.reason}`, {
        role: sender.role,
        url: sender.url
      })
    }
    return result
  }

  handle<C extends ContractChannel>(
    channel: C,
    handler: (payload: PayloadOf<C>, event: IpcMainInvokeEvent) => unknown
  ): void {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const result = this.check(channel, event, payload)
      if (!result.ok) throw new Error(`IPC ${channel} rejected`)
      return await handler(result.payload as PayloadOf<C>, event)
    })
  }

  on<C extends ContractChannel>(
    channel: C,
    handler: (payload: PayloadOf<C>, event: IpcMainEvent) => void
  ): void {
    ipcMain.on(channel, (event, payload: unknown) => {
      const result = this.check(channel, event, payload)
      if (result.ok) handler(result.payload as PayloadOf<C>, event)
    })
  }
}
