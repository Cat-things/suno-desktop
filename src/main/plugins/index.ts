import path from 'node:path'
import { StubPluginHost, type PluginHost, type PluginHostContext } from './plugin-host'

export type { PluginHost, PluginHostContext } from './plugin-host'

export function pluginsDirFor(userDataDir: string): string {
  return path.join(userDataDir, 'plugins')
}

/** Suno++ will replace this factory with a real host. */
export function createPluginHost(
  context: PluginHostContext,
  notifyUnavailable: () => void
): PluginHost {
  return new StubPluginHost(context, notifyUnavailable)
}
