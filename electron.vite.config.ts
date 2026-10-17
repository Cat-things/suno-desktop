import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      // Both preloads run in sandboxed renderers, which can only `require('electron')`.
      // Each entry must therefore be a single self-contained file with no shared chunks.
      isolatedEntries: true,
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          suno: resolve(__dirname, 'src/preload/suno.ts'),
          ui: resolve(__dirname, 'src/preload/ui.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rolldownOptions: {
        input: {
          titlebar: resolve(__dirname, 'src/renderer/titlebar.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          offline: resolve(__dirname, 'src/renderer/offline.html')
        }
      }
    }
  }
})
