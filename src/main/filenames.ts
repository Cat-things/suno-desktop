/** Filename helpers for the download manager. Windows rules, applied on every platform. */

const MAX_NAME_LENGTH = 200
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

export function sanitizeFilename(name: string, fallback = 'download'): string {
  let clean = name.replace(ILLEGAL, '_').trim()
  clean = clean.replace(/[. ]+$/, '')
  if (clean === '' || /^_+$/.test(clean) || /^\.+$/.test(clean)) clean = fallback
  if (RESERVED.test(clean)) clean = `_${clean}`
  if (clean.length > MAX_NAME_LENGTH) {
    const [base, ext] = splitExtension(clean)
    const keepExt = ext.length <= 16 ? ext : ''
    clean = base.slice(0, MAX_NAME_LENGTH - keepExt.length) + keepExt
  }
  return clean
}

/** Returns `name`, or `name (1)`, `name (2)`, ... for the first candidate that does not exist. */
export function uniqueFilename(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name
  const [base, ext] = splitExtension(name)
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!exists(candidate)) return candidate
  }
  return `${base} (${Date.now()})${ext}`
}
