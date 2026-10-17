/**
 * Discord local RPC framing: an 8-byte little-endian header (opcode, length) followed by UTF-8
 * JSON. Documented by Discord for the IPC transport used by Rich Presence.
 */

export const Opcode = {
  Handshake: 0,
  Frame: 1,
  Close: 2,
  Ping: 3,
  Pong: 4
} as const

export type OpcodeValue = (typeof Opcode)[keyof typeof Opcode]

export interface DecodedFrame {
  readonly op: number
  readonly data: unknown
}

const HEADER_SIZE = 8
const MAX_FRAME_SIZE = 1024 * 1024

export function encodeFrame(op: OpcodeValue, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(HEADER_SIZE)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

/** Reassembles frames from arbitrary socket chunks. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): DecodedFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: DecodedFrame[] = []
    while (this.buffer.length >= HEADER_SIZE) {
      const op = this.buffer.readInt32LE(0)
      const length = this.buffer.readInt32LE(4)
      if (length < 0 || length > MAX_FRAME_SIZE) {
        this.buffer = Buffer.alloc(0)
        throw new Error(`invalid Discord frame length ${length}`)
      }
      if (this.buffer.length < HEADER_SIZE + length) break
      const body = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + length).toString('utf8')
      this.buffer = this.buffer.subarray(HEADER_SIZE + length)
      frames.push({ op, data: JSON.parse(body) as unknown })
    }
    return frames
  }
}

/** Discord listens on discord-ipc-0..9; Windows uses named pipes, other platforms Unix sockets. */
export function ipcPath(
  index: number,
  platform: string = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`
  const dir = env['XDG_RUNTIME_DIR'] ?? env['TMPDIR'] ?? env['TMP'] ?? env['TEMP'] ?? '/tmp'
  return `${dir.replace(/\/$/, '')}/discord-ipc-${index}`
}

/** Discord application ids are snowflakes. Anything else means the placeholder is still in place. */
export function isValidClientId(id: string): boolean {
  return /^\d{17,20}$/.test(id)
}
