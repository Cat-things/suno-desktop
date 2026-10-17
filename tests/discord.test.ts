import { describe, expect, it } from 'vitest'
import { buildActivity, FALLBACK_ASSET } from '../src/main/integrations/discord/presence'
import {
  encodeFrame,
  FrameDecoder,
  ipcPath,
  isValidClientId,
  Opcode
} from '../src/main/integrations/discord/protocol'
import { EMPTY_MEDIA_SNAPSHOT, type MediaSnapshot } from '../src/shared/media'

describe('Discord IPC framing', () => {
  it('round-trips frames', () => {
    const frame = encodeFrame(Opcode.Handshake, { v: 1, client_id: '123' })
    expect(frame.readInt32LE(0)).toBe(0)
    expect(frame.readInt32LE(4)).toBe(frame.length - 8)
    expect(new FrameDecoder().push(frame)).toEqual([{ op: 0, data: { v: 1, client_id: '123' } }])
  })

  it('reassembles split and batched chunks', () => {
    const a = encodeFrame(Opcode.Frame, { cmd: 'DISPATCH', evt: 'READY' })
    const b = encodeFrame(Opcode.Frame, { cmd: 'SET_ACTIVITY', nonce: 'é' })
    const all = Buffer.concat([a, b])
    const decoder = new FrameDecoder()
    expect(decoder.push(all.subarray(0, 5))).toEqual([])
    expect(decoder.push(all.subarray(5, a.length + 3))).toHaveLength(1)
    expect(decoder.push(all.subarray(a.length + 3))).toEqual([
      { op: 1, data: { cmd: 'SET_ACTIVITY', nonce: 'é' } }
    ])
  })

  it('rejects absurd frame lengths', () => {
    const header = Buffer.alloc(8)
    header.writeInt32LE(1, 0)
    header.writeInt32LE(50 * 1024 * 1024, 4)
    expect(() => new FrameDecoder().push(header)).toThrow(/invalid Discord frame length/)
  })

  it('builds pipe paths', () => {
    expect(ipcPath(0, 'win32', {})).toBe('\\\\?\\pipe\\discord-ipc-0')
    expect(ipcPath(3, 'linux', { XDG_RUNTIME_DIR: '/run/user/1000/' })).toBe(
      '/run/user/1000/discord-ipc-3'
    )
    expect(ipcPath(1, 'darwin', {})).toBe('/tmp/discord-ipc-1')
  })

  it('detects the placeholder client id', () => {
    expect(isValidClientId('REPLACE_WITH_DISCORD_APPLICATION_ID')).toBe(false)
    expect(isValidClientId('1234567890123456789')).toBe(true)
  })
})

describe('buildActivity', () => {
  const playing: MediaSnapshot = {
    song: {
      title: 'Neon Rain',
      artist: 'Lamp',
      album: 'Night Drives',
      artwork: [
        {
          src: 'https://cdn2.suno.ai/image_large_0f0f0f0f-1111-2222-3333-444444444444.jpeg',
          sizes: '1024x1024'
        },
        { src: 'https://cdn2.suno.ai/image_small.jpeg', sizes: '128x128' }
      ]
    },
    playbackState: 'playing',
    position: { duration: 180, position: 30, playbackRate: 1 },
    canGoNext: true,
    canGoPrevious: true
  }

  it('shows title, artist, cover, progress and a Suno link', () => {
    const now = 1_000_000
    expect(buildActivity(playing, { now })).toEqual({
      type: 2,
      details: 'Neon Rain',
      state: 'by Lamp',
      assets: {
        large_image: 'https://cdn2.suno.ai/image_large_0f0f0f0f-1111-2222-3333-444444444444.jpeg',
        large_text: 'Night Drives'
      },
      timestamps: { start: now - 30_000, end: now + 150_000 },
      buttons: [
        {
          label: 'Listen on Suno',
          url: 'https://suno.com/song/0f0f0f0f-1111-2222-3333-444444444444'
        }
      ],
      instance: false
    })
  })

  it('prefers the song page the user is on for the button', () => {
    const activity = buildActivity(playing, {
      now: 0,
      pageUrl: 'https://suno.com/song/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    })
    expect(activity?.buttons?.[0]?.url).toBe(
      'https://suno.com/song/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    )
  })

  it('drops timestamps and says Paused while paused', () => {
    const activity = buildActivity({ ...playing, playbackState: 'paused' }, { now: 0 })
    expect(activity?.timestamps).toBeUndefined()
    expect(activity?.state).toBe('Paused · by Lamp')
  })

  it('clears presence when nothing is playing', () => {
    expect(buildActivity(EMPTY_MEDIA_SNAPSHOT, { now: 0 })).toBeNull()
    expect(buildActivity({ ...playing, playbackState: 'none' }, { now: 0 })).toBeNull()
  })

  it('never splits an emoji when truncating', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const activity = buildActivity(
      { ...playing, song: { ...playing.song, title: family.repeat(40) } },
      { now: 0 }
    )
    const details = activity?.details ?? ''
    expect(details.length).toBeLessThanOrEqual(128)
    expect(details.replace('…', '').length % family.length).toBe(0)
  })

  it('respects Discord limits', () => {
    const activity = buildActivity(
      {
        ...playing,
        song: { title: 'x'.repeat(300), artist: 'A', album: '', artwork: [] },
        position: null
      },
      { now: 0 }
    )
    expect(activity?.details.length).toBe(128)
    expect(activity?.details.endsWith('…')).toBe(true)
    expect(activity?.assets?.large_image).toBe(FALLBACK_ASSET)
    expect(activity?.buttons?.[0]?.url).toBe('https://suno.com/')
    const short = buildActivity(
      { ...playing, song: { title: 'X', artist: '', album: '', artwork: [] } },
      { now: 0 }
    )
    expect(short?.details).toBe('X\u2800')
    expect(short?.state).toBeUndefined()
  })
})
