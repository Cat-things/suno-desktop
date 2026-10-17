/** Values shared by the main process, preloads and local UI. Keep this file free of imports. */

export const APP_NAME = 'Suno Desktop'
export const APP_ID = 'com.catthings.sunodesktop'
export const REPO_URL = 'https://github.com/Cat-things/suno-desktop'

/** Registered with Windows so links like `suno-desktop://open?path=/song/xyz` reach the app. */
export const DEEP_LINK_SCHEME = 'suno-desktop'

export const SUNO_ORIGIN = 'https://suno.com'
export const HOME_URL = `${SUNO_ORIGIN}/`

/** Persistent session partition for suno.com so logins survive restarts. */
export const SUNO_PARTITION = 'persist:suno'

/** Privileged scheme that serves the bundled local UI (title bar, settings, offline page). */
export const APP_SCHEME = 'app'
export const APP_HOST = 'ui'

/** Isolated world used for plugin scripts injected by the injection pipeline. */
export const PLUGIN_WORLD_ID = 1001

/** Version of the `window.sunoDesktop` bridge contract. Bump on breaking changes. */
export const BRIDGE_API_VERSION = 1

export const TITLEBAR_HEIGHT = 40
