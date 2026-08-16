/**
 * Platform × Minecraft-version support matrix and era defaults for mc_scaffold.
 * One entry per shipped (platform, mcLine) combination; the scaffold tool
 * rejects anything absent so an unsupported era fails with the supported list.
 * v0.2 adds the Fabric / Forge (four eras) / NeoForge lines, each with a
 * `coords` object of statically pinned coordinates (loom/loader/fabric-api,
 * forgeGradle/forgeVersion/mappings, moddev/neoVersion, gradleVersion).
 * v0.3 adds the Spigot legacy lines (1.7 / 1.12): the spigotApi coordinate is
 * the canonical name for 1.12.2 (live on the Spigot hub nexus, verified
 * 2026-08-16) and a spec placeholder for 1.7.10 — no public maven hosts
 * 1.7.10 spigot-api, so the 1.7.10 template uses a vendored jar instead.
 * @module minecraft-dev/lib/versions
 */

/**
 * Normalize a Minecraft version string to its major.minor line:
 * "1.21" / "1.21.8" / "1.21.x" → "1.21"; "26.2" / "26.x" → "26.2".
 * @param {string} version - user-supplied Minecraft version.
 * @returns {string} the normalized line, e.g. "1.21" or "26.2".
 */
export function normalizeMcLine(version) {
  const stripped = version.replace(/\.x$/i, '')
  const parts = stripped.split('.')
  if (parts.length < 2) return stripped
  return `${parts[0]}.${parts[1]}`
}

/**
 * Supported platform → line entries. `defaultMcVersion` is the full version the
 * template pins when the caller omits one; `javaVersion` is the default Java
 * language level for that line; `templateDir` names the assets/templates child.
 * Entries may carry `coords` — statically pinned coordinates (loom/loader/
 * fabric-api, forgeGradle/forgeVersion/mappings, moddev/neoVersion,
 * gradleVersion, spigotApi) merged into the scaffold render vars. Pinned
 * values verified against official sources on 2026-08-16 (see V02_PLAN.md and
 * V03_PLAN.md appendices).
 */
export const PLATFORM_LINES = {
  paper: [
    { line: '1.20', javaVersion: 17, defaultMcVersion: '1.20.6', templateDir: 'paper' },
    { line: '1.21', javaVersion: 21, defaultMcVersion: '1.21.8', templateDir: 'paper' },
    { line: '26', javaVersion: 25, defaultMcVersion: '26.2', templateDir: 'paper' },
  ],
  fabric: [
    { line: '1.20', javaVersion: 17, defaultMcVersion: '1.20.1', templateDir: 'fabric',
      coords: { gradleVersion: '9.5.1', loomVersion: '1.17.19', loaderVersion: '0.19.3', fabricApiVersion: '0.92.11+1.20.1' } },
    { line: '1.21', javaVersion: 21, defaultMcVersion: '1.21.11', templateDir: 'fabric',
      coords: { gradleVersion: '9.5.1', loomVersion: '1.17.19', loaderVersion: '0.19.3', fabricApiVersion: '0.141.6+1.21.11' } },
    { line: '26', javaVersion: 25, defaultMcVersion: '26.2', templateDir: 'fabric-26',
      coords: { gradleVersion: '9.5.1', loomVersion: '1.17.19', loaderVersion: '0.19.3', fabricApiVersion: '0.157.0+26.2' } },
  ],
  forge: [
    { line: '1.7', javaVersion: 8, defaultMcVersion: '1.7.10', templateDir: 'forge-1.7.10',
      coords: { gradleVersion: '7.4.2', forgeGradle: 'com.anatawa12.forge:ForgeGradle:1.2-1.1.+', forgeVersion: '10.13.4.1614-1.7.10' } },
    { line: '1.12', javaVersion: 8, defaultMcVersion: '1.12.2', templateDir: 'forge-1.12.2',
      coords: { gradleVersion: '4.9', forgeGradle: 'net.minecraftforge.gradle:ForgeGradle:3.0.197', forgeVersion: '14.23.5.2860', mappingsChannel: 'snapshot', mappingsVersion: '20171003-1.12' } },
    { line: '1.16', javaVersion: 8, defaultMcVersion: '1.16.5', templateDir: 'forge-1.16.5',
      coords: { gradleVersion: '7.3.3', forgeGradle: 'net.minecraftforge.gradle:ForgeGradle:5.1.77', forgeVersion: '36.2.39', mappingsChannel: 'official', mappingsVersion: '1.16.5' } },
    { line: '1.20', javaVersion: 17, defaultMcVersion: '1.20.1', templateDir: 'forge-1.20.1',
      coords: { gradleVersion: '8.8', forgeGradle: 'net.minecraftforge.gradle:ForgeGradle:6.0.54', forgeGradlePluginVersion: '6.0.54', forgeVersion: '47.3.0', mappingsChannel: 'official', mappingsVersion: '1.20.1' } },
  ],
  neoforge: [
    { line: '1.20', javaVersion: 17, defaultMcVersion: '1.20.1', templateDir: 'neoforge-1.20.1',
      coords: { gradleVersion: '8.14.5', moddevPlugin: 'net.neoforged.moddev.legacyforge', moddevVersion: '2.0.91', forgeVersion: '47.1.3' } },
    { line: '1.21', javaVersion: 21, defaultMcVersion: '1.21.11', templateDir: 'neoforge',
      coords: { gradleVersion: '9.2.1', moddevPlugin: 'net.neoforged.moddev', moddevVersion: '2.0.144', neoVersion: '21.11.45' } },
    { line: '26', javaVersion: 25, defaultMcVersion: '26.2', templateDir: 'neoforge-26',
      coords: { gradleVersion: '9.2.1', moddevPlugin: 'net.neoforged.moddev', moddevVersion: '2.0.144', neoVersion: '26.2.0.59' } },
  ],
  spigot: [
    // 1.7.10: spigot-api has NO public maven (hub's earliest is 1.8; every
    // mirror 404s — 2026-08-16). The spigotApi coordinate stays as the
    // canonical spec name for docs; the template uses a vendored jar.
    { line: '1.7', javaVersion: 8, defaultMcVersion: '1.7.10', templateDir: 'spigot-1.7.10',
      coords: { gradleVersion: '8.14.3', spigotApi: 'org.spigotmc:spigot-api:1.7.10-R0.1-SNAPSHOT' } },
    // 1.12.2: resolvable from the Spigot hub nexus snapshots + groups/public.
    { line: '1.12', javaVersion: 8, defaultMcVersion: '1.12.2', templateDir: 'spigot-1.12.2',
      coords: { gradleVersion: '8.14.3', spigotApi: 'org.spigotmc:spigot-api:1.12.2-R0.1-SNAPSHOT' } },
  ],
}

/** All mc_scaffold platforms the tool currently accepts. */
export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_LINES)

/** Human-readable platform labels for cards and messages. */
export const PLATFORM_LABELS = {
  paper: 'Paper plugin',
  fabric: 'Fabric mod',
  forge: 'Forge mod',
  neoforge: 'NeoForge mod',
  spigot: 'Spigot plugin',
}

/**
 * Resolve the shipped template entry for a platform + Minecraft version,
 * or throw with the supported list.
 * @param {string} platform - tool platform enum value.
 * @param {string} minecraftVersion - user-supplied version (full or line).
 * @returns {{ line: string, javaVersion: number, defaultMcVersion: string, templateDir: string, coords?: object }}
 */
export function resolveLine(platform, minecraftVersion) {
  const entries = PLATFORM_LINES[platform]
  if (!entries) {
    throw new Error(`unsupported platform ${JSON.stringify(platform)}; supported: ${SUPPORTED_PLATFORMS.join(', ')}`)
  }
  const line = normalizeMcLine(minecraftVersion)
  const entry = entries.find(e => line.startsWith(e.line))
  if (!entry) {
    const supported = entries.map(e => e.line).join(', ')
    throw new Error(`no template for ${platform} ${minecraftVersion}; supported Minecraft lines: ${supported}`)
  }
  return entry
}

/**
 * Derive the Java language level when the model omitted it.
 * @param {string} platform - tool platform enum value.
 * @param {string} minecraftVersion - user-supplied version.
 * @returns {number} default Java level for the resolved line.
 */
export function defaultJavaVersion(platform, minecraftVersion) {
  return resolveLine(platform, minecraftVersion).javaVersion
}

/**
 * Derive the statically pinned coordinates for a platform + version line
 * (loom/loader/fabric-api, forgeGradle/forgeVersion/mappings, moddev/neoVersion,
 * gradleVersion, spigotApi). All coordinates are pinned per (platform, line) —
 * no arithmetic — so this is a plain lookup; scaffold.js merges the result
 * into the template render vars. Paper has no coords and falls back to {}.
 * @param {string} platform - tool platform enum value.
 * @param {string} minecraftVersion - user-supplied version.
 * @returns {object} the resolved line's coords (possibly empty).
 */
export function lineCoords(platform, minecraftVersion) {
  return resolveLine(platform, minecraftVersion).coords ?? {}
}

/**
 * Derive the paper-api Maven version for a Minecraft version. The 1.x era uses
 * `<mc>-R0.1-SNAPSHOT` (e.g. 1.21.8-R0.1-SNAPSHOT); the 26.x era uses
 * `26.<drop>.build.+` (e.g. 26.2.build.+), resolved from the PaperMC repo.
 * @param {string} minecraftVersion - user-supplied version.
 * @returns {string} paper-api artifact version.
 */
export function paperApiVersion(minecraftVersion) {
  const stripped = minecraftVersion.replace(/\.x$/i, '')
  const major = Number(stripped.split('.')[0])
  if (major >= 26) {
    const line = normalizeMcLine(stripped)
    return `${line}.build.+`
  }
  return `${stripped}-R0.1-SNAPSHOT`
}
