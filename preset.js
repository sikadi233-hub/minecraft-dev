/**
 * Boot-time agent-preset installer plugin (`minecraft-preset`; two presets
 * since v0.8.0, dual-model since v0.9.0).
 *
 * The bundled presets have to reach the harness twice over, because dsh changed
 * how a preset exists:
 *
 * - **dsh 0.1.5 – 0.1.6**: a preset is a DIRECTORY under the harness-home root
 *   the roster scans (`$DSH_HOME/.agent-presets/<id>/` with `preset.yml` plus a
 *   composition file). `dsh plugin add` never moves anything there, so this
 *   plugin copies the bundled directories at mount and never overwrites an
 *   existing composition (local edits win).
 * - **dsh 0.1.7+**: directory discovery is gone. A preset is an
 *   `@deepseek-ai/dsh-agent-preset` declaration registered through the
 *   `agentPresets` service, so this plugin hands the same rows over as plain
 *   objects (`preset/<id>/rows.js`) and lets Cordis own their lifetime.
 *
 * The two forms are generated from the same source of truth: the YAML files are
 * the directory-install form, `rows.js` is generated from them, and
 * `test/preset-rows-parity.test.js` fails the build when they drift apart.
 *
 * The shipped presets are:
 * - `minecraft` — the Minecraft expert (composition unchanged since v0.7).
 * - `minecraft-architect` — the expert plus the Codex(Astra) architecture
 *   handoff: the `mc_codex` tool and the `minecraft-codex-architect` skill,
 *   both mounted by that preset alone.
 *
 * Whole feature can be disabled with `autoInstallPreset: false` (the 0.1.5 file
 * copy only; the 0.1.7 registration is a service declaration with no filesystem
 * side effect, and its absence would silently drop both presets).
 * @module minecraft-dev/preset
 */

import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { ensurePresetInstalled } from './lib/preset-install.js'
import { registerPresetDefinitions } from './lib/preset-register.js'
import { minecraftPreset } from './preset/minecraft/rows.js'
import { minecraftArchitectPreset } from './preset/minecraft-architect/rows.js'

/** Cordis plugin name. */
export const name = 'minecraft-preset'

/**
 * The preset registry is a hard dependency, on both lines.
 *
 * Both dsh 0.1.5 (`@deepseek-ai/dsh-agent-presets`) and 0.1.7
 * (`@deepseek-ai/dsh-agent-preset-registry`) publish a service named
 * `agentPresets`; 0.1.7's registry row is inserted at the END of the web patch
 * and initializes asynchronously, so a plain `ctx.get('agentPresets')` at
 * plugin-apply time returned `undefined` and the plugin silently fell back to
 * writing `.agent-presets/` directories — which 0.1.7 does not scan. Injecting
 * makes Cordis hold this plugin until the registry is published, so the
 * capability check below sees the real service. Neither line puts the row in an
 * `isolate` realm, so the service is reachable from this row.
 */
export const inject = ['agentPresets']

/** Deployment switch (0.1.5-era directory install only). */
export const Config = Schema.object({
  autoInstallPreset: Schema.boolean().default(true),
})

/** The presets bundled with this package, in install order. */
export const BUNDLED_PRESETS = [
  { id: 'minecraft', srcDir: fileURLToPath(new URL('./preset/minecraft/', import.meta.url)) },
  { id: 'minecraft-architect', srcDir: fileURLToPath(new URL('./preset/minecraft-architect/', import.meta.url)) },
]

/** The same two presets in their dsh 0.1.7+ declaration form. */
export const PRESET_DEFINITIONS = [minecraftPreset, minecraftArchitectPreset]

/**
 * Install both bundled presets on boot, in whichever form the running dsh
 * understands. Never throws into the boot path: a failure is logged as a
 * warning so a read-only home or an odd deployment cannot take the server down,
 * and one broken preset cannot block the other.
 */
export async function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const declared = registerPresetDefinitions({
    registry: ctx.agentPresets,
    definitions: PRESET_DEFINITIONS,
    effect: (body) => ctx.effect(body),
    logger,
  })
  if (declared) return
  if (config.autoInstallPreset === false) return
  for (const { id, srcDir } of BUNDLED_PRESETS) {
    try {
      await ensurePresetInstalled({
        srcDir,
        presetId: id,
        log: (msg) => logger.info(msg),
        debug: (msg) => logger.debug(msg),
      })
    } catch (error) {
      logger.warn(`minecraft-preset: could not auto-install agent preset '${id}': ${error.message}`)
    }
  }
}
