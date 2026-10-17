// Decides whether a workflow run should publish a release, and which version.
//
//   node scripts/release-plan.mjs          plan the current run (reads GitHub Actions env, writes GITHUB_OUTPUT)
//   node scripts/release-plan.mjs notes <version> [previous-tag]   print release notes (Markdown)
//
// Rules (see .github/workflows/release.yml):
// - a pushed v* tag releases that version;
// - a manual run on main releases the next version;
// - a push to main releases the next version once RELEASE_EVERY non-merge commits have landed
//   since the last stable release tag (or immediately if there is none yet).
// The next version is the last release with the patch bumped, or package.json's version if that
// is higher, so bumping package.json starts a new minor/major line.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

export const RELEASE_EVERY = 3

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Parses `1.2.3`, `v1.2.3` or `1.2.3-beta.1`. Returns null for anything else. */
export function parseVersion(text) {
  const match = SEMVER.exec(text.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  }
}

/** Compares stable versions (prerelease suffixes are not expected here). */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`cannot compare "${a}" and "${b}"`)
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch
}

export function nextVersion(latestTag, packageVersion) {
  const base = parseVersion(packageVersion)
  if (!base || base.prerelease)
    throw new Error(`package.json version "${packageVersion}" must be x.y.z`)
  if (!latestTag) return `${base.major}.${base.minor}.${base.patch}`
  const last = parseVersion(latestTag)
  if (!last) throw new Error(`latest tag "${latestTag}" is not a version`)
  const bumped = `${last.major}.${last.minor}.${last.patch + 1}`
  return compareVersions(packageVersion, bumped) > 0 ? packageVersion : bumped
}

/**
 * @param {{ event: string, ref: string, latestTag: string | null, commitsSinceTag: number,
 *           packageVersion: string, every?: number }} input
 */
export function planRelease({
  event,
  ref,
  latestTag,
  commitsSinceTag,
  packageVersion,
  every = RELEASE_EVERY
}) {
  if (event === 'push' && ref.startsWith('refs/tags/')) {
    const tag = ref.slice('refs/tags/'.length)
    const parsed = parseVersion(tag)
    if (!parsed || !tag.startsWith('v')) {
      return { release: false, reason: `tag ${tag} is not a vX.Y.Z version` }
    }
    return { release: true, version: tag.slice(1), reason: `tag ${tag} pushed` }
  }
  if (event === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main')
      return { release: false, reason: 'manual releases run from main' }
    return {
      release: true,
      version: nextVersion(latestTag, packageVersion),
      reason: 'started manually'
    }
  }
  if (event === 'push' && ref === 'refs/heads/main') {
    if (!latestTag) {
      return {
        release: true,
        version: nextVersion(null, packageVersion),
        reason: 'first release'
      }
    }
    if (commitsSinceTag >= every) {
      return {
        release: true,
        version: nextVersion(latestTag, packageVersion),
        reason: `${commitsSinceTag} commits since ${latestTag}`
      }
    }
    return {
      release: false,
      reason: `${commitsSinceTag}/${every} commits since ${latestTag}`
    }
  }
  return { release: false, reason: `no release for ${event} on ${ref}` }
}

// --- CLI --------------------------------------------------------------------------------------

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Most recent stable release tag reachable from `rev`, or null. */
function latestStableTag(rev = 'HEAD') {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--exclude', '*-*', rev)
  } catch {
    return null
  }
}

function output(name, value) {
  const file = process.env.GITHUB_OUTPUT
  if (file) appendFileSync(file, `${name}=${value}\n`)
  console.log(`${name}=${value}`)
}

function plan() {
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
  const latestTag = latestStableTag()
  const commitsSinceTag = latestTag
    ? Number(git('rev-list', '--count', '--no-merges', `${latestTag}..HEAD`))
    : 0
  const result = planRelease({
    event: process.env.GITHUB_EVENT_NAME ?? '',
    ref: process.env.GITHUB_REF ?? '',
    latestTag,
    commitsSinceTag,
    packageVersion
  })
  output('release', String(result.release))
  output('version', result.version ?? '')
  output('tag', result.version ? `v${result.version}` : '')
  output('previous_tag', latestTag ?? '')
  output('reason', result.reason)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(
      summary,
      result.release
        ? `### Releasing v${result.version}\n\nReason: ${result.reason}.\n`
        : `### No release\n\n${result.reason}.\n`
    )
  }
}

function notes(version, previousTag) {
  const range = previousTag ? [`${previousTag}..HEAD`] : ['HEAD']
  const log = git('log', '--no-merges', '--pretty=format:- %s (%h)', ...range)
  const changes = log
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^- Initial commit \(/.test(line))
    .join('\n')
  return `## Changes${previousTag ? ` since ${previousTag}` : ''}

${changes || '- Maintenance release'}

## Downloads

| File | What it is |
| --- | --- |
| \`Suno-Desktop-Setup-${version}.exe\` | Installer for Windows 10/11, x64 and ARM64. Updates itself. |
| \`Suno-Desktop-Portable-${version}-x64.exe\` | Portable, Intel/AMD PCs. No auto-update. |
| \`Suno-Desktop-Portable-${version}-arm64.exe\` | Portable, ARM64 PCs. No auto-update. |

These builds are not code-signed yet, so Windows SmartScreen will warn: choose **More info → Run anyway**.

Suno Desktop is unofficial and not affiliated with, sponsored by or endorsed by Suno, Inc.
`
}

// Only act when run directly (tests import the functions above).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/release-plan.mjs')) {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'notes') {
    if (!rest[0]) {
      console.error('usage: release-plan.mjs notes <version> [previous-tag]')
      process.exit(1)
    }
    process.stdout.write(notes(rest[0], rest[1] || null))
  } else {
    plan()
  }
}
