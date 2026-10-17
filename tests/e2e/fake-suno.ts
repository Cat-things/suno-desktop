/** A tiny stand-in for suno.com that exercises navigator.mediaSession like a real player. */

/** Two seconds of 8 kHz mono silence as a WAV file. */
export function silentWav(seconds = 2): Buffer {
  const rate = 8000
  const samples = rate * seconds
  const buffer = Buffer.alloc(44 + samples)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate, 28)
  buffer.writeUInt16LE(1, 32)
  buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples, 40)
  buffer.fill(128, 44)
  return buffer
}

export const COVER_ID = '0f0f0f0f-1111-2222-3333-444444444444'

export const FAKE_SUNO_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Fake Suno</title></head>
  <body style="margin:0;font:16px sans-serif;background:#101010;color:#fff">
    <h1 style="padding:24px">Fake suno.com for e2e tests</h1>
    <audio id="player" loop src="https://cdn1.suno.ai/e2e.wav"></audio>
    <script>
      window.__calls = []
      const s = navigator.mediaSession
      s.metadata = new MediaMetadata({
        title: 'Neon Rain',
        artist: 'Lamp',
        album: 'E2E Sessions',
        artwork: [{ src: 'https://cdn2.suno.ai/image_${COVER_ID}.jpeg', sizes: '512x512', type: 'image/jpeg' }]
      })
      s.setActionHandler('play', () => { window.__calls.push('play'); s.playbackState = 'playing' })
      s.setActionHandler('pause', () => { window.__calls.push('pause'); s.playbackState = 'paused' })
      s.setActionHandler('nexttrack', () => window.__calls.push('next'))
      s.setActionHandler('previoustrack', () => window.__calls.push('previous'))
      s.playbackState = 'playing'
      document.getElementById('player').play().catch(() => {})
    </script>
  </body>
</html>`
