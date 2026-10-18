import path from 'node:path'
import { StubThemeHost, type ThemeHost, type ThemeHostContext } from './theme-host'

export type { ThemeHost, ThemeHostContext } from './theme-host'

export function themesDirFor(userDataDir: string): string {
  return path.join(userDataDir, 'themes')
}

/** Suno++ will replace this factory with a real host. */
export function createThemeHost(
  context: ThemeHostContext,
  notifyUnavailable: () => void
): ThemeHost {
  return new StubThemeHost(context, notifyUnavailable)
}
