// Generates the placeholder app icon, tray icons and taskbar thumbnail glyphs.
// Output is committed, so this only needs to run when the artwork changes: `pnpm icons`.
// To rebrand, replace build/icon.svg (and resources/tray.svg) and run it again.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = (...parts) => join(root, ...parts)

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  console.log(`wrote ${path.slice(root.length + 1)} (${data.length} bytes)`)
}

const appSvg = readFileSync(out('build', 'icon.svg'))
const traySvg = readFileSync(out('resources', 'tray.svg'))

// App icon: every size Windows asks for (shell, taskbar, Start, alt-tab at 100-400% scaling).
const appSizes = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256]
write(out('build', 'icon.ico'), ico(appSizes.map((size) => ({ size, data: render(appSvg, size) }))))
write(out('build', 'icon.png'), render(appSvg, 512))
write(out('resources', 'icon.png'), render(appSvg, 256))

// Tray: simplified artwork that stays legible at 16 px.
const traySizes = [16, 20, 24, 32, 40, 48, 64]
write(
  out('resources', 'tray.ico'),
  ico(traySizes.map((size) => ({ size, data: render(traySvg, size) })))
)
write(out('resources', 'tray.png'), render(traySvg, 32))

// Thumbnail toolbar glyphs: white on transparent, 16 px plus @2x.
const glyph = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#ffffff">${body}</svg>`
const glyphs = {
  play: glyph(
    '<path d="M4.5 2.8v10.4c0 .6.7 1 1.2.6l7.6-5.2a.75.75 0 0 0 0-1.2L5.7 2.2c-.5-.4-1.2 0-1.2.6z"/>'
  ),
  pause: glyph(
    '<rect x="3.5" y="2.5" width="3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3" height="11" rx="1"/>'
  ),
  next: glyph(
    '<path d="M2.5 3.3v9.4c0 .6.7.9 1.2.6l6.6-4.7a.75.75 0 0 0 0-1.2L3.7 2.7c-.5-.3-1.2 0-1.2.6z"/><rect x="11" y="2.5" width="2.5" height="11" rx="1"/>'
  ),
  previous: glyph(
    '<path d="M13.5 3.3v9.4c0 .6-.7.9-1.2.6L5.7 8.6a.75.75 0 0 1 0-1.2l6.6-4.7c.5-.3 1.2 0 1.2.6z"/><rect x="2.5" y="2.5" width="2.5" height="11" rx="1"/>'
  )
}
for (const [name, svg] of Object.entries(glyphs)) {
  write(out('resources', 'thumbar', `${name}.png`), render(svg, 16))
  write(out('resources', 'thumbar', `${name}@2x.png`), render(svg, 32))
}
