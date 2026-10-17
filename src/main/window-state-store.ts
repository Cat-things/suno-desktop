import path from 'node:path'
import { parseWindowState, type WindowState } from '../shared/window-state'
import { DebouncedJsonWriter, readJsonFile } from './json-file'
import type { Logger } from './logger'

/** Window size, position and maximized state in <userData>/window-state.json. */
export class WindowStateStore {
  private readonly writer: DebouncedJsonWriter
  private readonly initial: WindowState

  constructor(userDataDir: string, log: Logger) {
    const file = path.join(userDataDir, 'window-state.json')
    this.writer = new DebouncedJsonWriter(file, 500, log)
    this.initial = parseWindowState(readJsonFile(file, log))
  }

  load(): WindowState {
    return this.initial
  }

  save(state: WindowState): void {
    this.writer.schedule(state)
  }

  flush(): void {
    this.writer.flush()
  }
}
