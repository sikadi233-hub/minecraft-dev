/**
 * Render the Codex(Astra) architecture brief from the shipped template.
 *
 * The Cherry Studio agent this feature ports from hard-coded "Paper 1.21.1 /
 * paper-api 1.21.1-R0.1-SNAPSHOT / Java 21". Here the version block is derived
 * from the same `versions.js` matrix `mc_scaffold` uses, so the architect is
 * told exactly the coordinates the scaffold will emit — the repo's guard
 * against silently substituting a different Minecraft line.
 * @module minecraft-dev/lib/architect-brief
 */

import { PLATFORM_LABELS, paperApiVersion, resolveLine } from './versions.js'

/** Placeholders the shipped template may use. */
export const BRIEF_TOKENS = [
  '{{PLATFORM}}',
  '{{PLATFORM_LABEL}}',
  '{{MC_VERSION}}',
  '{{MC_LINE}}',
  '{{JAVA}}',
  '{{API_COORD}}',
  '{{COORDS}}',
  '{{PROJECT_DIR}}',
  '{{GOAL}}',
]

/** Render the pinned coordinate table for mod platforms (paper has none). */
function renderCoords(coords) {
  const entries = Object.entries(coords ?? {})
  if (entries.length === 0) return '(platform has no pinned coordinates)'
  return entries.map(([key, value]) => `- ${key}: ${value}`).join('\n')
}

/**
 * Resolve the pinned facts for one platform + Minecraft version.
 * @param {{ platform: string, minecraftVersion: string, javaVersion?: number }} input
 * @returns {{ platform: string, platformLabel: string, minecraftVersion: string, requestedVersion: string,
 *   line: string, javaVersion: number, apiCoord: string|null, coords: object }}
 * @throws when the platform or version has no shipped line (same message as mc_scaffold).
 */
export function architectFacts({ platform, minecraftVersion, javaVersion }) {
  const entry = resolveLine(platform, minecraftVersion)
  const coords = entry.coords ?? {}
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform] ?? platform,
    // The version actually targeted (the pinned line default), not the raw request.
    minecraftVersion: entry.defaultMcVersion,
    requestedVersion: minecraftVersion,
    line: entry.line,
    javaVersion: javaVersion ?? entry.javaVersion,
    apiCoord: platform === 'paper' ? `io.papermc.paper:paper-api:${paperApiVersion(entry.defaultMcVersion)}` : null,
    coords,
  }
}

/**
 * Fill the architecture template. Pure: no I/O, no clock.
 * @param {{ template: string, facts: object, projectDir: string, goal: string }} input
 * @returns {string} the complete text to hand to `codex exec -`.
 * @throws when a placeholder has no value (the template drifted from BRIEF_TOKENS).
 */
export function renderArchitectBrief({ template, facts, projectDir, goal }) {
  const values = {
    '{{PLATFORM}}': facts.platform,
    '{{PLATFORM_LABEL}}': facts.platformLabel,
    '{{MC_VERSION}}': facts.minecraftVersion,
    '{{MC_LINE}}': facts.line,
    '{{JAVA}}': String(facts.javaVersion),
    '{{API_COORD}}': facts.apiCoord ?? renderCoords(facts.coords),
    '{{COORDS}}': renderCoords(facts.coords),
    '{{PROJECT_DIR}}': projectDir,
    '{{GOAL}}': goal,
  }
  let text = template
  for (const [token, value] of Object.entries(values)) text = text.split(token).join(value)
  const leftovers = [...new Set(text.match(/\{\{[A-Z_]+\}\}/g) ?? [])]
  if (leftovers.length > 0) {
    throw new Error(`unresolved brief placeholders: ${leftovers.join(', ')} — update the template or BRIEF_TOKENS`)
  }
  return text
}
