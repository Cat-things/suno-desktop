import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { Logger } from '../../logger'
import type { DiscordActivity } from './presence'
import { encodeFrame, FrameDecoder, ipcPath, Opcode } from './protocol'

interface ClientEvents {
  disconnected: []
}

const CONNECT_TIMEOUT_MS = 3000
const READY_TIMEOUT_MS = 5000

function connectPipe(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/**
 * Minimal client for Discord's local RPC socket, enough for Rich Presence. Talks to the desktop
 * Discord client only; nothing is sent over the network by this app.
 */
export class DiscordIpcClient extends EventEmitter<ClientEvents> {
  private socket: net.Socket | null = null

  constructor(
    private readonly clientId: string,
    private readonly log: Logger
  ) {
    super()
  }

  get connected(): boolean {
    return this.socket !== null
  }

  async connect(): Promise<void> {
    if (this.socket) return
    let lastError: unknown = null
    for (let i = 0; i < 10; i++) {
      try {
        const socket = await connectPipe(ipcPath(i))
        await this.handshake(socket)
        this.attach(socket)
        this.log.info(`connected to Discord on discord-ipc-${i}`)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`Discord is not running (${String(lastError)})`)
  }

  private handshake(socket: net.Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const decoder = new FrameDecoder()
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.off('data', onData)
        socket.off('close', onClose)
      }
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error('handshake timeout'))
      }, READY_TIMEOUT_MS)
      const onClose = (): void => {
        cleanup()
        reject(new Error('closed during handshake'))
      }
      const onData = (chunk: Buffer): void => {
        try {
          for (const frame of decoder.push(chunk)) {
            const data = frame.data as { evt?: string; code?: number; message?: string }
            if (frame.op === Opcode.Frame && data.evt === 'READY') {
              cleanup()
              resolve()
              return
            }
            if (frame.op === Opcode.Close) {
              cleanup()
              socket.destroy()
              reject(new Error(`Discord refused: ${data.message ?? 'unknown'}`))
              return
            }
          }
        } catch (error) {
          cleanup()
          socket.destroy()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
      socket.on('data', onData)
      socket.on('close', onClose)
      socket.write(encodeFrame(Opcode.Handshake, { v: 1, client_id: this.clientId }))
    })
  }

  private attach(socket: net.Socket): void {
    this.socket = socket
    const decoder = new FrameDecoder()
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (frame.op === Opcode.Ping) socket.write(encodeFrame(Opcode.Pong, frame.data))
          else if (frame.op === Opcode.Close) socket.destroy()
          else {
            const data = frame.data as { evt?: string; data?: { message?: string } }
            if (data.evt === 'ERROR') this.log.warn(`Discord error: ${data.data?.message ?? '?'}`)
          }
        }
      } catch (error) {
        this.log.warn('bad frame from Discord', error)
        socket.destroy()
      }
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.emit('disconnected')
      }
    })
  }

  setActivity(activity: DiscordActivity | null): void {
    if (this.socket) this.setActivityOn(this.socket, activity)
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    try {
      this.setActivityOn(socket, null)
      socket.end()
    } catch {
      socket.destroy()
    }
  }

  private setActivityOn(socket: net.Socket, activity: DiscordActivity | null): void {
    socket.write(
      encodeFrame(Opcode.Frame, {
        cmd: 'SET_ACTIVITY',
        args: activity ? { pid: process.pid, activity } : { pid: process.pid },
        nonce: randomUUID()
      })
    )
  }
}
