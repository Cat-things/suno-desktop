import { createHash } from 'node:crypto'

const sha = (data: string) => createHash('sha256').update(data).digest('hex')

/** A desktop.json for the given files, as Suno++'s release workflow writes it. */
export function release(version: string, bundle = 'bundle', catalog = '{}', extra: object = {}) {
  return {
    formatVersion: 1,
    version,
    bridgeApi: 1,
    minDesktopVersion: '0.1.0',
    files: {
      bundle: { name: 'sunoplusplus.js', size: Buffer.byteLength(bundle), sha256: sha(bundle) },
      catalog: { name: 'catalog.json', size: Buffer.byteLength(catalog), sha256: sha(catalog) }
    },
    ...extra
  }
}

export function catalogJson(version: string, pluginIds: string[] = ['now-playing-title']): string {
  return JSON.stringify({
    formatVersion: 1,
    sunoplusplusVersion: version,
    plugins: pluginIds.map((id) => ({
      id,
      name: `Plugin ${id}`,
      description: 'A plugin.',
      version: '1.0.0',
      authors: [{ name: 'Someone' }],
      settings: [{ key: 'showArtist', type: 'boolean', label: 'Show artist', default: true }]
    })),
    themes: [
      {
        id: 'neon-accents',
        name: 'Neon accents',
        description: 'Pink.',
        version: '1.0.0',
        authors: [{ name: 'Someone' }],
        variables: [{ key: 'accent', label: 'Accent', type: 'color', default: '#ff2e97' }]
      }
    ]
  })
}
