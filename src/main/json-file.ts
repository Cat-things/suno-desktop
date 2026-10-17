import fs from 'node:fs'
import path from 'node:path'
import type { Logger } from './logger'

/** Reads JSON, returning `undefined` when the file is missing. Corrupt files are moved aside. */
export function readJsonFile(file: string, log: Logger): unknown {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`cannot read ${file}`, error)
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`
    log.warn(`corrupt JSON in ${file}; moved to ${backup}`, error)
    try {
      fs.renameSync(file, backup)
    } catch {
      // Nothing else to do; defaults will overwrite it.
    }
    return undefined
  }
}

/** Writes via a temp file + rename so a crash never leaves a half-written file behind. */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

/** Coalesces frequent writes (window moves, zoom changes) into one write per `delayMs`. */
export class DebouncedJsonWriter {
  private pending: { data: unknown } | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly delayMs: number,
    private readonly log: Logger
  ) {}

  schedule(data: unknown): void {
    this.pending = { data }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.flush()
    }, this.delayMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pending) return
    const { data } = this.pending
    this.pending = null
    try {
      writeJsonFileAtomic(this.file, data)
    } catch (error) {
      this.log.error(`cannot write ${this.file}`, error)
    }
  }
}
