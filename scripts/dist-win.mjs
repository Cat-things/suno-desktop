// Builds the Windows release artifacts:
//   1. one NSIS installer containing x64 and arm64 (plus latest.yml / beta.yml for updates)
//   2. one portable exe per architecture
// Usage: node scripts/dist-win.mjs [--publish never|always]
// Run `pnpm build` first. Publishing needs GH_TOKEN; signing needs CSC_LINK + CSC_KEY_PASSWORD.
import { spawnSync } from 'node:child_process'

const publishIndex = process.argv.indexOf('--publish')
const publish = publishIndex === -1 ? 'never' : process.argv[publishIndex + 1]
if (!['never', 'always', 'onTag', 'onTagOrDraft'].includes(publish)) {
  console.error(`invalid --publish value: ${publish}`)
  process.exit(1)
}

const runs = [
  ['--win', 'nsis', '--x64', '--arm64'],
  ['--win', 'portable', '--x64'],
  ['--win', 'portable', '--arm64']
]

for (const args of runs) {
  const full = [...args, '--publish', publish]
  console.log(`\n> electron-builder ${full.join(' ')}`)
  const result = spawnSync('electron-builder', full, { stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
