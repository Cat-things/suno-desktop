import fs from 'node:fs'
import path from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
  child(scope: string): Logger
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_LOG_BYTES = 2 * 1024 * 1024

function formatMeta(meta: unknown): string {
  if (meta === undefined) return ''
  if (meta instanceof Error) return ` ${meta.stack ?? meta.message}`
  try {
    return ` ${JSON.stringify(meta)}`
  } catch {
    return ' [unserializable]'
  }
}

export interface LoggerOptions {
  readonly level: LogLevel
  readonly toConsole: boolean
}

/** Small file logger: <userData>/logs/main.log, rotated to main.old.log at startup past 2 MB. */
export function createLogger(dir: string, options: LoggerOptions): Logger {
  let stream: fs.WriteStream | null = null
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'main.log')
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(dir, 'main.old.log'))
    }
    stream = fs.createWriteStream(file, { flags: 'a' })
    stream.on('error', () => {
      stream = null
    })
  } catch {
    stream = null
  }

  const write = (level: LogLevel, scope: string, message: string, meta: unknown): void => {
    if (ORDER[level] < ORDER[options.level]) return
    const line = `${new Date().toISOString()} [${level}]${scope ? ` [${scope}]` : ''} ${message}${formatMeta(meta)}`
    stream?.write(`${line}\n`)
    if (options.toConsole) {
      const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      out(line)
    }
  }

  const make = (scope: string): Logger => ({
    debug: (m, meta) => write('debug', scope, m, meta),
    info: (m, meta) => write('info', scope, m, meta),
    warn: (m, meta) => write('warn', scope, m, meta),
    error: (m, meta) => write('error', scope, m, meta),
    child: (s) => make(scope ? `${scope}:${s}` : s)
  })
  return make('')
}
