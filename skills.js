/**
 * Bundled Minecraft development skills for DeepSeek Harness. One provider
 * registers every skill shipped under assets/skills; the model loads a skill
 * body on demand through the `skill` tool (or the /<name> gesture).
 * Mirrors the dsh-skill-badge provider pattern (rank: bundled 600).
 * @module minecraft-dev/skills
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'minecraft-dev'

/**
 * One skill per entry. `description` is the model-routing signal (when to load
 * this skill); keep it under ~500 chars and English. v0.3 ships the shared
 * build skill, the Paper / Fabric / Forge / NeoForge skills, the Spigot
 * legacy-line skill and the major-mods addon-reference skill.
 */
const SKILLS = [
  {
    name: 'minecraft-java-build',
    description: 'Java, Gradle, and toolchain knowledge for Minecraft projects spanning MC 1.7.10 to 26.x: JDK level per version (Java 8 for 1.7.10/1.12.2, 17 for 1.18-1.20.4, 21 for 1.20.5-1.21.x, 25 for 26.x), era-appropriate Gradle wrappers, foojay toolchain auto-provisioning, dependency repositories (PaperMC, Fabric, NeoForged, Spigot hub), common build tasks and troubleshooting. Use when a Minecraft project has build, Gradle, or Java version problems, or when planning build setup for any new Minecraft project.',
  },
  {
    name: 'minecraft-paper-plugin',
    description: 'Develop Paper/Spigot server plugins for Minecraft 1.20.x, 1.21.x and 26.x. Project setup with paper-api and shadow jar, plugin.yml fields, the JavaPlugin lifecycle, events, commands, permissions, config, scheduler, and the build/test/reload loop. Also notes the Paper family (Purpur, Pufferfish, Folia). Use when creating or extending a modern Paper/Spigot server plugin.',
  },
  {
    name: 'minecraft-fabric-mod',
    description: 'Develop Fabric mods for Minecraft 1.20.1, 1.21.x and 26.x. Project setup with the fabric-loom Gradle plugin (loom 1.17.19, loader 0.19.3, Fabric API per version), fabric.mod.json entrypoints and depends blocks, official Mojang mappings, Mixin, client/common source sets, and the build/runClient/runServer loop. Use when creating or extending a Fabric mod, or fixing Fabric build, remap or dependency problems.',
  },
  {
    name: 'minecraft-forge-mod',
    description: 'Develop Forge mods across the four eras: 1.7.10 (ForgeGradle 1.2 fork, Gradle 7.4.2, MCP), 1.12.2 (ForgeGradle 3, Gradle 4.9, MCP snapshot 20171003), 1.16.5 (ForgeGradle 5, Gradle 7.3.3, official mappings), 1.20.1 (ForgeGradle 6, Gradle 8.8, mods.toml). Covers mcmod.info vs mods.toml metadata, @Mod lifecycle per era, reobfJar, JDK 8 requirement for old lines, runClient/runServer/runData. Use when creating or extending a Forge mod, or fixing era-specific Forge build problems.',
  },
  {
    name: 'minecraft-neoforge-mod',
    description: 'Develop NeoForge mods for 1.20.1, 1.21.x and 26.2. Project setup with the net.neoforged.moddev Gradle plugin (2.0.144; legacyforge 2.0.91 for 1.20.1), NeoForm pipeline, neoforge.mods.toml mandatory fields, @Mod and event bus, DeferredRegister, data generation, runClient/runServer/runData, optional Parchment mappings. Use when creating or extending a NeoForge mod, or fixing moddev/NeoForm/mods.toml problems.',
  },
  {
    name: 'minecraft-spigot-legacy',
    description: 'Develop Spigot/Bukkit server plugins for legacy Minecraft 1.7.10 and 1.12.2: Java 8 build setup with spigot-api compileOnly (1.12.2 from the Spigot hub maven, 1.7.10 from a vendored server jar), plugin.yml fields without api-version, the JavaPlugin lifecycle, events, commands, permissions, config, and the build/copy-to-server/reload loop on old servers. Also covers Cauldron/KCauldron/Thermos hybrid servers (Forge mods + Bukkit plugins on one 1.7.10 server). Use when creating or extending a plugin for a 1.7.10 or 1.12.2 server.',
  },
  {
    name: 'minecraft-major-mods',
    description: 'Reference for addon development against major mods on the legacy lines: Thaumcraft, Tinkers Construct, Botania, Twilight Forest, Applied Energistics 2, Mekanism, IndustrialCraft 2, Thermal Expansion, Draconic Evolution and SlashBlade for Minecraft 1.7.10 and 1.12.2. Covers the general addon patterns: soft-dependency detection across Forge/Cauldron/Spigot, compileOnly optional dependencies, curse.maven and Modrinth maven coordinates per mod, and recipe/event integration hooks. Per-mod coordinates and API entry points live in references/api/mods-1.7.10.md and mods-1.12.2.md. Use when developing an addon for one of these mods.',
  },
]

const candidates = SKILLS.map(skill => {
  // skills.js sits at the package root, so assets are a sibling directory
  // (unlike dsh-skill-badge, whose ../ escapes its src/ subdirectory).
  const dir = fileURLToPath(new URL(`./assets/skills/${skill.name}/`, import.meta.url))
  return {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dir },
    rank: BUNDLED_SKILL_RANK,
    locator: new URL(`./assets/skills/${skill.name}/SKILL.md`, import.meta.url),
  }
})

const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([...candidates]),
  async get(candidate) {
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      resourceBase: candidate.resourceBase,
      content: await readFile(candidate.locator, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'minecraft-skills'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled Minecraft skills provider on `ctx.skills`. */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)
}
