import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  nextVersion,
  parseVersion,
  planRelease,
  RELEASE_EVERY
} from '../scripts/release-plan.mjs'

describe('versions', () => {
  it('parses stable and prerelease versions', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null })
    expect(parseVersion('0.2.0-beta.1')).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: 'beta.1'
    })
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('compares numerically, not as strings', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
  })

  it('bumps the patch of the last release', () => {
    expect(nextVersion('v0.1.0', '0.1.0')).toBe('0.1.1')
    expect(nextVersion('v0.1.9', '0.1.0')).toBe('0.1.10')
  })

  it('uses package.json when it is ahead (new minor/major line)', () => {
    expect(nextVersion('v0.1.4', '0.2.0')).toBe('0.2.0')
    expect(nextVersion(null, '0.1.0')).toBe('0.1.0')
  })

  it('rejects a prerelease package.json version', () => {
    expect(() => nextVersion(null, '1.0.0-rc.1')).toThrow(/must be x.y.z/)
  })
})

describe('planRelease', () => {
  const main = { event: 'push', ref: 'refs/heads/main', packageVersion: '0.1.0' }

  it('makes the first release immediately', () => {
    expect(planRelease({ ...main, latestTag: null, commitsSinceTag: 0 })).toMatchObject({
      release: true,
      version: '0.1.0',
      reason: 'first release'
    })
  })

  it(`waits for ${RELEASE_EVERY} commits since the last release`, () => {
    expect(planRelease({ ...main, latestTag: 'v0.1.0', commitsSinceTag: 2 })).toEqual({
      release: false,
      reason: '2/3 commits since v0.1.0'
    })
    expect(planRelease({ ...main, latestTag: 'v0.1.0', commitsSinceTag: 3 })).toMatchObject({
      release: true,
      version: '0.1.1'
    })
    expect(planRelease({ ...main, latestTag: 'v0.1.0', commitsSinceTag: 7 })).toMatchObject({
      release: true,
      version: '0.1.1'
    })
  })

  it('honours a custom threshold', () => {
    expect(
      planRelease({ ...main, latestTag: 'v0.1.0', commitsSinceTag: 1, every: 1 }).release
    ).toBe(true)
  })

  it('releases pushed version tags as-is, including prereleases', () => {
    expect(
      planRelease({
        event: 'push',
        ref: 'refs/tags/v0.3.0-beta.1',
        latestTag: 'v0.2.0',
        commitsSinceTag: 0,
        packageVersion: '0.1.0'
      })
    ).toMatchObject({ release: true, version: '0.3.0-beta.1' })
    expect(
      planRelease({
        event: 'push',
        ref: 'refs/tags/nightly',
        latestTag: null,
        commitsSinceTag: 0,
        packageVersion: '0.1.0'
      }).release
    ).toBe(false)
  })

  it('releases the next version when started manually', () => {
    expect(
      planRelease({
        event: 'workflow_dispatch',
        ref: 'refs/heads/main',
        latestTag: 'v0.1.2',
        commitsSinceTag: 0,
        packageVersion: '0.1.0'
      })
    ).toMatchObject({ release: true, version: '0.1.3' })
  })

  it('refuses manual releases from other branches', () => {
    expect(
      planRelease({
        event: 'workflow_dispatch',
        ref: 'refs/heads/feature',
        latestTag: 'v0.1.2',
        commitsSinceTag: 0,
        packageVersion: '0.1.0'
      })
    ).toEqual({ release: false, reason: 'manual releases run from main' })
  })

  it('never releases from other branches', () => {
    expect(
      planRelease({
        event: 'push',
        ref: 'refs/heads/feature',
        latestTag: null,
        commitsSinceTag: 9,
        packageVersion: '0.1.0'
      }).release
    ).toBe(false)
  })
})
