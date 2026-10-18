import { EventEmitter } from 'node:events'
import path from 'node:path'
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  settingsSchema,
  type Settings,
  type SettingsPatch
} from '../shared/settings'
import { DebouncedJsonWriter, readJsonFile } from './json-file'
import type { Logger } from './logger'

interface SettingsEvents {
  changed: [next: Settings, previous: Settings]
}

/** Settings persisted to <userData>/settings.json. Loaded synchronously before `app.ready`. */
export class SettingsStore extends EventEmitter<SettingsEvents> {
  private current: Settings
  private readonly writer: DebouncedJsonWriter

  constructor(userDataDir: string, log: Logger) {
    super()
    const file = path.join(userDataDir, 'settings.json')
    this.writer = new DebouncedJsonWriter(file, 300, log)
    const { settings, changed, warnings } = migrateSettings(readJsonFile(file, log))
    for (const warning of warnings) log.warn(`settings: ${warning}`)
    this.current = settings
    if (changed) {
      this.writer.schedule(settings)
      this.writer.flush()
    }
  }

  get(): Settings {
    return this.current
  }

  /** Applies a patch (already validated for IPC callers) and persists it. */
  update(patch: SettingsPatch | Partial<Settings>): Settings {
    const previous = this.current
    const next = settingsSchema.parse({ ...previous, ...patch })
    if (JSON.stringify(next) === JSON.stringify(previous)) return previous
    this.current = next
    this.writer.schedule(next)
    this.emit('changed', next, previous)
    return next
  }

  /** Back to defaults (used by "Reset app settings"). Suno's own data lives elsewhere. */
  reset(): Settings {
    const previous = this.current
    const next = settingsSchema.parse({ ...DEFAULT_SETTINGS })
    this.current = next
    this.writer.schedule(next)
    this.emit('changed', next, previous)
    return next
  }

  flush(): void {
    this.writer.flush()
  }
}
