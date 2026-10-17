import { z } from 'zod'
import rawConfig from '../../config/app.config.json'
import { isValidClientId } from './integrations/discord/protocol'

const configSchema = z.object({
  discord: z.object({ clientId: z.string() })
})

const parsed = configSchema.parse(rawConfig)

export interface AppConfig {
  /** Discord application id, or `null` while the placeholder is still in config/app.config.json. */
  readonly discordClientId: string | null
}

function resolveClientId(): string | null {
  const fromEnv = process.env['SUNO_DESKTOP_DISCORD_CLIENT_ID']?.trim()
  const id = fromEnv !== undefined && fromEnv !== '' ? fromEnv : parsed.discord.clientId
  return isValidClientId(id) ? id : null
}

export const appConfig: AppConfig = Object.freeze({ discordClientId: resolveClientId() })
