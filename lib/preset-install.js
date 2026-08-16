/**
 * Boot-time agent-preset installer for minecraft-dev.
 *
 * The npm package ships the "Minecraft expert" agent preset under
 * preset/minecraft/ (preset.yml + agent.cordis.yml), but `dsh plugin add`
 * only installs the cordis plugin rows: the preset files land inside the
 * profile's node_modules, where the preset roster never scans. This module
 * mirrors the harness's own path resolution (@deepseek-ai/dsh-agent-presets
 * discovery: `$DSH_HOME` or `~/.dsh`, plus `.agent-presets/<presetId>`) so
 * the preset is placed exactly where discovery looks.
 *
 * Idempotent by design: an existing composition file is left untouched (a
 * user's local edits win), and a preset directory whose composition file is
 * missing is treated as broken and healed.
 * @module minecraft-dev/lib/preset-install
 */

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name of the writable preset root under the harness home (mirrors dsh-agent-presets). */
export const USER_PRESET_DIR = '.agent-presets'
/** The preset id shipped by this package (the directory name under the root). */
export const PRESET_ID = 'minecraft'
/** The composition file that makes a directory a preset (mirrors discovery.ts). */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** Expand supported tilde prefixes like @deepseek-ai/dsh-home-paths. */
function expandTilde(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home the same way the host does: an explicit `$DSH_HOME`
 * (non-blank, tilde-expanded), else `~/.dsh`. Mirrors resolveDshHome from
 * @deepseek-ai/dsh-home-paths without taking the peer dependency.
 * @param env - environment mapping used to read DSH_HOME.
 * @returns the normalized absolute harness home path.
 */
export function resolveDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandTilde(selected))
}

/**
 * Install the bundled "Minecraft expert" preset into the harness-home preset
 * root unless a composition already exists there.
 * @param {object} [options]
 * @param {string} options.srcDir - package preset directory holding the files to install.
 * @param {string} [options.home] - harness home; defaults to {@link resolveDshHome}.
 * @param {(msg: string) => void} [options.log] - called once when the preset is installed.
 * @param {(msg: string) => void} [options.debug] - called when the preset is skipped.
 * @returns {Promise<{ installed: boolean, reason?: string, destDir: string, written?: string[] }>}
 */
export async function ensurePresetInstalled(options = {}) {
  const { srcDir, home = resolveDshHome(), log = () => {}, debug = () => {} } = options
  if (!srcDir) throw new Error('ensurePresetInstalled: srcDir is required')
  const destDir = join(resolve(home), USER_PRESET_DIR, PRESET_ID)
  const composition = join(destDir, COMPOSITION_FILE)

  let compositionPresent = false
  try {
    compositionPresent = (await stat(composition)).isFile()
  } catch {
    compositionPresent = false // absent or unreadable — (re)install
  }
  if (compositionPresent) {
    debug(`agent preset '${PRESET_ID}' already installed at ${destDir} — skipping (remove the directory to force a refresh)`)
    return { installed: false, reason: 'exists', destDir }
  }

  await mkdir(destDir, { recursive: true })
  const entries = await readdir(srcDir, { withFileTypes: true })
  const written = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    await copyFile(join(srcDir, entry.name), join(destDir, entry.name))
    written.push(entry.name)
  }
  if (written.length === 0) {
    throw new Error(`ensurePresetInstalled: preset source ${srcDir} contains no files`)
  }
  log(`installed the Minecraft expert agent preset to ${destDir} (${written.join(', ')}) — new sessions can pick it from the preset selector`)
  return { installed: true, destDir, written }
}
