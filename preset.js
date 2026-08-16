/**
 * Boot-time agent-preset installer plugin (`minecraft-preset`, v0.6.0).
 *
 * `dsh plugin add` installs the cordis plugin rows (skills / tools / the
 * four-subagent team) but nothing moves the bundled "Minecraft expert" agent
 * preset into the harness-home preset root the roster actually scans
 * (`$DSH_HOME/.agent-presets/`). This entry closes that gap at plugin mount:
 * every dsh boot after the install places the preset where discovery looks,
 * so a fresh install needs no manual copy step at all.
 *
 * Safe by construction: an existing composition is never overwritten (local
 * edits win), the copy is two small files, and the whole feature can be
 * disabled with `autoInstallPreset: false` in the plugin config.
 * @module minecraft-dev/preset
 */

import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { ensurePresetInstalled } from './lib/preset-install.js'

/** Cordis plugin name. */
export const name = 'minecraft-preset'

/** No service dependencies — this entry only writes files and logs. */
export const inject = []

/** Deployment switch. */
export const Config = Schema.object({
  autoInstallPreset: Schema.boolean().default(true),
})

/** The preset directory bundled with this package. */
const SRC_DIR = fileURLToPath(new URL('./preset/minecraft/', import.meta.url))

/**
 * Install the bundled preset on boot. Never throws into the boot path: a
 * failure is logged as a warning so a read-only home or an odd deployment
 * cannot take the server down.
 */
export async function apply(ctx, config = {}) {
  if (config.autoInstallPreset === false) return
  const logger = ctx.logger ?? console
  try {
    await ensurePresetInstalled({
      srcDir: SRC_DIR,
      log: (msg) => logger.info(msg),
      debug: (msg) => logger.debug(msg),
    })
  } catch (error) {
    logger.warn(`minecraft-preset: could not auto-install the agent preset: ${error.message}`)
  }
}
