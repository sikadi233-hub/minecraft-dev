// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Workspace scoping for the bundled skills.
 *
 * `dsh-skill` hands every provider the viewing `cwd` (`SkillLookupOptions.cwd`),
 * which makes "show Minecraft skills only in a Minecraft workspace" a question the
 * provider can answer without touching global state. The default is `auto`:
 *
 * - no `cwd` (no workspace mounted) → show, because the person may be about to
 *   start a project and hiding the catalog would make it undiscoverable;
 * - `cwd` that carries Minecraft markers → show;
 * - `cwd` that is clearly another stack (package.json, pyproject.toml, Cargo.toml,
 *   go.mod …) and has no Minecraft marker → hide;
 * - anything else (empty or unrecognised directory) → show.
 *
 * `listed` restricts the catalog to configured roots, and `always` restores the
 * pre-0.12.14 behaviour of listing everywhere.
 *
 * Marker detection is bounded on purpose: a few top-level reads plus at most
 * thirty shallow Java sources. It runs on a catalog read, so it must stay cheap;
 * results are cached per resolved root for a short while.
 *
 * @module minecraft-dev/lib/skill-scope
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/** Files whose mere presence identifies a Minecraft project. */
export const MC_FILES = [
  'plugin.yml',
  'paper-plugin.yml',
  'fabric.mod.json',
  'mcmod.info',
  'mods.toml',
  'neoforge.mods.toml',
]

/** Same markers under the resource directory, where they usually live. */
export const MC_RESOURCE_FILES = [
  'src/main/resources/plugin.yml',
  'src/main/resources/paper-plugin.yml',
  'src/main/resources/fabric.mod.json',
  'src/main/resources/mcmod.info',
  'src/main/resources/META-INF/mods.toml',
  'src/main/resources/META-INF/neoforge.mods.toml',
]

/** Build files that may declare a Minecraft toolchain. */
export const BUILD_FILES = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'pom.xml']

/** Hints that a build file belongs to a Minecraft project. */
export const MC_BUILD_HINT = /paper-api|paperweight|fabric-loom|net\.neoforged|net\.minecraftforge|forgegradle|net\.fabricmc|moddev|minecraft[_-]?version|mojang/i

/** Hints that a Java source imports a Minecraft API. */
export const MC_JAVA_HINT = /\borg\.bukkit\b|\bnet\.minecraft\b|\bnet\.minecraftforge\b|\bnet\.neoforged\b|\bnet\.fabricmc\b|\bio\.papermc\b/

/** Files that identify a different stack when no Minecraft marker is present. */
export const OTHER_PROJECT_FILES = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile', 'mix.exs']

/** How many Java sources the shallow scan may open. */
const JAVA_SCAN_LIMIT = 30

/** How deep the Java scan walks below `src/main/java`. */
const JAVA_SCAN_DEPTH = 4

/** Cache lifetime for a detection result. */
const CACHE_TTL_MS = 30_000

/** `cwd` → `{ at, minecraft, other }`. */
const cache = new Map()

/** Drop cached detections (tests, or after a workspace is edited). */
export function clearScopeCache() {
  cache.clear()
}

/** Normalize a path for prefix comparison. */
function normalizePath(value) {
  const text = String(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? text.toLowerCase() : text
}

/** Whether `cwd` sits inside `root` (root itself included). */
export function isUnder(cwd, root) {
  if (!cwd || !root) return false
  const target = normalizePath(cwd)
  const base = normalizePath(root)
  return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`)
}

/** Bounded shallow scan of Java sources for a Minecraft import. */
function javaSourcesMentionMinecraft(cwd) {
  const root = join(cwd, 'src', 'main', 'java')
  if (!existsSync(root)) return false
  let opened = 0
  const walk = (dir, depth) => {
    if (opened >= JAVA_SCAN_LIMIT || depth > JAVA_SCAN_DEPTH) return false
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
    for (const entry of entries) {
      if (opened >= JAVA_SCAN_LIMIT) return false
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (walk(full, depth + 1)) return true
        continue
      }
      if (!entry.name.endsWith('.java')) continue
      opened += 1
      try {
        if (MC_JAVA_HINT.test(readFileSync(full, 'utf8').slice(0, 20_000))) return true
      } catch { /* unreadable file: keep scanning */ }
    }
    return false
  }
  return walk(root, 1)
}

/** Whether a build file mentions a Minecraft toolchain. */
function buildFilesMentionMinecraft(cwd) {
  for (const file of BUILD_FILES) {
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    try {
      if (MC_BUILD_HINT.test(readFileSync(path, 'utf8').slice(0, 40_000))) return true
    } catch { /* unreadable file: try the next one */ }
  }
  return false
}

/** Detect the kind of project at `cwd` (cached briefly). */
export function detectProjectKind(cwd) {
  if (!cwd) return { minecraft: false, other: false }
  const key = resolve(cwd)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.kind

  let minecraft = false
  for (const file of MC_FILES) {
    if (existsSync(join(key, file))) { minecraft = true; break }
  }
  if (!minecraft) {
    for (const file of MC_RESOURCE_FILES) {
      if (existsSync(join(key, file))) { minecraft = true; break }
    }
  }
  if (!minecraft) minecraft = buildFilesMentionMinecraft(key)
  if (!minecraft) minecraft = javaSourcesMentionMinecraft(key)

  const other = !minecraft && OTHER_PROJECT_FILES.some(file => {
    try { return statSync(join(key, file)).isFile() } catch { return false }
  })

  const kind = { minecraft, other }
  cache.set(key, { at: Date.now(), kind })
  return kind
}

/**
 * Decide whether the bundled skills should be listed for a workspace.
 * @param {object} options - viewing `cwd`, the configured scope, and listed roots.
 * @returns {boolean} true when the catalog should be visible.
 */
export function shouldExposeSkills({ cwd, scope = 'auto', workspaces = [] } = {}) {
  const mode = String(scope ?? 'auto').toLowerCase()
  if (mode === 'always') return true
  if (mode === 'off' || mode === 'never') return false
  if (mode === 'listed') {
    if (!cwd) return false
    return (Array.isArray(workspaces) ? workspaces : []).some(root => isUnder(cwd, root))
  }
  // auto
  if (!cwd) return true
  const { minecraft, other } = detectProjectKind(cwd)
  if (minecraft) return true
  if (other) return false
  return true
}

/** Explain the decision (the tool/status surfaces use this). */
export function explainScope({ cwd, scope = 'auto', workspaces = [] } = {}) {
  const visible = shouldExposeSkills({ cwd, scope, workspaces })
  const mode = String(scope ?? 'auto').toLowerCase()
  if (mode === 'always') return { visible, reason: 'scope=always' }
  if (mode === 'off' || mode === 'never') return { visible, reason: 'scope=off' }
  if (mode === 'listed') {
    const matched = (Array.isArray(workspaces) ? workspaces : []).find(root => isUnder(cwd, root))
    return { visible, reason: matched ? `under ${matched}` : 'not under any configured workspace' }
  }
  if (!cwd) return { visible, reason: 'no workspace cwd' }
  const kind = detectProjectKind(cwd)
  if (kind.minecraft) return { visible, reason: 'Minecraft markers found' }
  if (kind.other) return { visible, reason: 'another stack, no Minecraft markers' }
  return { visible, reason: 'no markers either way' }
}

/** Separator used by path comparisons, exported for tests. */
export const PATH_SEPARATOR = sep
