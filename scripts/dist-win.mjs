// Builds the Windows release artifacts:
//   1. one NSIS installer containing x64 and arm64 (plus latest.yml / beta.yml for updates)
//   2. one portable exe per architecture
// Usage: node scripts/dist-win.mjs [--publish never|always] [-- <extra electron-builder args>]
// Run `pnpm build` first. Publishing needs GH_TOKEN; signing needs CSC_LINK + CSC_KEY_PASSWORD.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const separator = process.argv.indexOf('--')
const own = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator)
const extra = separator === -1 ? [] : process.argv.slice(separator + 1)

const publishIndex = own.indexOf('--publish')
const publish = publishIndex === -1 ? 'never' : own[publishIndex + 1]
if (!['never', 'always', 'onTag', 'onTagOrDraft'].includes(publish)) {
  console.error(`invalid --publish value: ${publish}`)
  process.exit(1)
}

// Resolve the CLI ourselves so this works without node_modules/.bin on PATH (e.g. plain `node` in CI).
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js')

const runs = [
  ['--win', 'nsis', '--x64', '--arm64'],
  ['--win', 'portable', '--x64'],
  ['--win', 'portable', '--arm64']
]

for (const args of runs) {
  const full = [...args, '--publish', publish, ...extra]
  console.log(`\n> electron-builder ${full.join(' ')}`)
  const result = spawnSync(process.execPath, [cli, ...full], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
