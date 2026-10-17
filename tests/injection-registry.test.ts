import { describe, expect, it, vi } from 'vitest'
import {
  InjectionRegistry,
  isAllowedPattern,
  matchUrlPattern,
  type InjectionEntry
} from '../src/main/injection/registry'

const entry = (overrides: Partial<InjectionEntry> = {}): InjectionEntry => ({
  id: 'test.entry',
  owner: 'test',
  matches: ['https://suno.com/create*'],
  css: 'body { color: red }',
  world: 'isolated',
  runOn: ['load', 'route'],
  ...overrides
})

describe('matchUrlPattern', () => {
  it('matches globs against origin, path and query', () => {
    expect(matchUrlPattern('https://suno.com/create*', 'https://suno.com/create')).toBe(true)
    expect(matchUrlPattern('https://suno.com/create*', 'https://suno.com/create?x=1')).toBe(true)
    expect(matchUrlPattern('https://suno.com/create*', 'https://suno.com/library')).toBe(false)
    expect(matchUrlPattern('https://suno.com/*', 'https://suno.com/song/1#frag')).toBe(true)
    expect(matchUrlPattern('https://suno.com/song/*', 'https://suno.com/songs')).toBe(false)
  })

  it('escapes regex characters', () => {
    expect(matchUrlPattern('https://suno.com/a.b', 'https://suno.com/aXb')).toBe(false)
  })
})

describe('isAllowedPattern', () => {
  it('requires a suno.com origin', () => {
    expect(isAllowedPattern('https://suno.com/*')).toBe(true)
    expect(isAllowedPattern('https://studio.suno.com/x')).toBe(true)
    expect(isAllowedPattern('*')).toBe(false)
    expect(isAllowedPattern('https://*')).toBe(false)
    expect(isAllowedPattern('https://accounts.google.com/*')).toBe(false)
    expect(isAllowedPattern('https://suno.com.evil.example/*')).toBe(false)
    expect(isAllowedPattern('http://suno.com/*')).toBe(false)
  })
})

describe('InjectionRegistry', () => {
  it('registers, matches and removes entries', () => {
    const registry = new InjectionRegistry()
    const onChange = vi.fn()
    registry.onChange(onChange)
    const dispose = registry.register(entry({ js: 'console.log(1)' }))
    expect(registry.matching('https://suno.com/create')).toHaveLength(1)
    expect(registry.scriptsFor('https://suno.com/create', 'route')).toHaveLength(1)
    expect(registry.matching('https://suno.com/library')).toHaveLength(0)
    dispose()
    expect(registry.list()).toHaveLength(0)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('filters scripts by trigger and skips css-only entries', () => {
    const registry = new InjectionRegistry()
    registry.register(entry({ id: 'css.only' }))
    registry.register(entry({ id: 'load.only', js: '1', runOn: ['load'] }))
    expect(registry.scriptsFor('https://suno.com/create', 'route')).toHaveLength(0)
    expect(registry.scriptsFor('https://suno.com/create', 'load').map((e) => e.id)).toEqual([
      'load.only'
    ])
  })

  it('removes everything an owner registered', () => {
    const registry = new InjectionRegistry()
    registry.register(entry({ id: 'a.1', owner: 'a' }))
    registry.register(entry({ id: 'a.2', owner: 'a' }))
    registry.register(entry({ id: 'b.1', owner: 'b' }))
    expect(registry.unregisterOwner('a')).toBe(2)
    expect(registry.list().map((e) => e.id)).toEqual(['b.1'])
  })

  it('rejects invalid entries', () => {
    const registry = new InjectionRegistry()
    expect(() => registry.register(entry({ id: '../x' }))).toThrow(/invalid id/)
    expect(() => registry.register(entry({ css: undefined }))).toThrow(/css or js/)
    expect(() => registry.register(entry({ matches: [] }))).toThrow(/match pattern/)
    expect(() => registry.register(entry({ matches: ['https://evil.example/*'] }))).toThrow(
      /not anchored/
    )
    expect(() => registry.register(entry({ js: 'x', runOn: [] }))).toThrow(/trigger/)
  })
})
