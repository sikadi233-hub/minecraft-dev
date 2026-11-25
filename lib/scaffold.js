/**
 * Filesystem driver for mc_scaffold: walks the template tree under
 * assets/templates, renders placeholders, writes the project, and rolls back
 * on failure or cancellation. Real node:fs only; unit tests exercise it
 * against real temp directories.
 * @module minecraft-dev/lib/scaffold
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { renderTemplateTree } from './templates.js'
import {
  toApiVersion,
  toMainClass,
  toPackagePath,
  validateJavaPackage,
  validateJavaVersion,
  validateMcVersion,
  validateProjectName,
} from './validate.js'
import { PLATFORM_LINES, defaultJavaVersion, lineCoords, paperApiVersion, resolveLine } from './versions.js'
import { DYNAMIC_PLATFORMS, resolveDynamic } from './dynamic-versions.js'

const TEMPLATES_ROOT = fileURLToPath(new URL('../assets/templates/', import.meta.url))
const WRAPPER_DIR = path.join(TEMPLATES_ROOT, 'common', 'wrapper')

/** Recursively list a directory as { rel, content } with paths relative to the root. */
async function readTree(root) {
  /** @param {string} dir */
  async function walk(dir) {
    const entries = await readdir(dir)
    const files = []
    for (const entry of entries) {
      const full = path.join(dir, entry)
      const info = await stat(full)
      if (info.isDirectory()) {
        files.push(...await walk(full))
      } else {
        files.push({
          rel: path.relative(root, full).split(path.sep).join('/'),
          content: await readFile(full),
        })
      }
    }
    return files
  }
  return walk(root)
}

/** Ensure a target directory does not exist or is empty. */
async function assertTargetAvailable(targetDir) {
  try {
    const info = await stat(targetDir)
    if (!info.isDirectory()) {
      throw new Error(`target ${targetDir} exists and is not a directory`)
    }
    const entries = await readdir(targetDir)
    if (entries.length > 0) {
      throw new Error(`target ${targetDir} is not empty; scaffold requires a new or empty directory`)
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
}

/**
 * Scaffold one project from the shipped template.
 * @param {object} options
 * @param {string} options.platform - supported platform key (v0.2: paper/fabric/forge/neoforge).
 * @param {string} options.minecraftVersion - full or line version, e.g. "1.21.8".
 * @param {string} options.targetDir - absolute path of the new project root.
 * @param {string} options.name - kebab-case project name.
 * @param {string} options.packageName - Java package name.
 * @param {number} [options.javaVersion] - Java level; defaults to the era value.
 * @param {AbortSignal} [options.signal] - cancellation; aborts before the write phase.
 * @returns {Promise<{ platform: string, minecraftVersion: string, projectDir: string, filesCreated: string[], buildCommand: string, wrapperReady: boolean }>}
 */
export async function scaffoldProject(options) {
  const { platform, targetDir, name } = options
  const minecraftVersion = validateMcVersion(options.minecraftVersion)
  const packageName = validateJavaPackage(options.packageName)
  validateProjectName(name)
  // A version the matrix pins keeps the verified path. Anything else on Paper,
  // Fabric or NeoForge goes through the loaders' own metadata (network), because
  // silently lending a pinned line's coordinates to another Minecraft version is
  // how a project ends up built for the wrong one.
  const exactPinned = (PLATFORM_LINES[platform] ?? []).some(entry => entry.defaultMcVersion === minecraftVersion)
  let lineEntry
  let resolution = 'pinned'
  let unverified = false
  let sources = []
  let note = ''
  if (exactPinned) {
    lineEntry = resolveLine(platform, minecraftVersion)
  } else if (DYNAMIC_PLATFORMS.includes(platform)) {
    try {
      const dynamic = await resolveDynamic({
        platform,
        minecraftVersion,
        fetchImpl: options.fetchImpl,
        cacheDir: options.cacheDir,
        cacheTtlMs: options.cacheTtlMs,
      })
      lineEntry = { templateDir: dynamic.templateDir, javaVersion: dynamic.javaVersion, coords: dynamic.coords }
      resolution = 'dynamic'
      unverified = dynamic.unverified
      sources = dynamic.sources
      note = `resolved from ${dynamic.sources.join(', ')}; this line has not been through the pinned build verification`
    } catch (error) {
      if (platform !== 'paper') throw error
      // Paper is lenient: a published paper-api is not required to generate the
      // project, so keep the old lenient path but say the check failed.
      lineEntry = resolveLine(platform, minecraftVersion)
      resolution = 'pinned-lenient'
      unverified = true
      note = `dynamic check failed (${error.message}); generated from the pinned template without verifying the paper-api build`
    }
  } else {
    lineEntry = resolveLine(platform, minecraftVersion)
  }
  // The resolved entry already carries the era's Java level, which is what an
  // unpinned dynamic version has to use (defaultJavaVersion would re-run the
  // strict pinned lookup and throw).
  const javaVersion = validateJavaVersion(options.javaVersion ?? lineEntry.javaVersion ?? defaultJavaVersion(platform, minecraftVersion))
  const mainClass = toMainClass(name)

  await assertTargetAvailable(targetDir)
  if (options.signal?.aborted) throw new Error('scaffold cancelled')

  const templateDir = path.join(TEMPLATES_ROOT, lineEntry.templateDir)
  const templateFiles = await readTree(templateDir)
  const wrapperFiles = await readTree(WRAPPER_DIR)

  const vars = {
    name,
    pkg: packageName,
    pkgPath: toPackagePath(packageName),
    MainClass: mainClass,
    mcVersion: minecraftVersion,
    javaVersion,
    apiVersion: toApiVersion(minecraftVersion),
    paperApiVersion: paperApiVersion(minecraftVersion),
    // v0.2: per-line static coordinates (loom/loader/fabric-api, forgeGradle/
    // forgeVersion/mappings, moddev/neoVersion, gradleVersion).
    // The resolved entry carries the coordinates; a dynamic resolution puts its
    // own there, and only a pinned entry without coords falls back to the table.
    ...(lineEntry.coords ?? lineCoords(platform, minecraftVersion)),
  }
  const rendered = renderTemplateTree(templateFiles, vars)
  const renderedRels = new Set(rendered.map(file => file.rel))

  // Write template files first, then wrapper files — a wrapper file whose rel
  // path the template already provided is skipped (each template dir ships its
  // own gradle-wrapper.properties with the pinned gradleVersion; the common
  // wrapper keeps an 8.14.3 fallback only). On any failure remove everything.
  const filesCreated = []
  try {
    const toWrite = [...rendered, ...wrapperFiles.filter(file => !renderedRels.has(file.rel))]
    for (const file of toWrite) {
      if (options.signal?.aborted) throw new Error('scaffold cancelled')
      const full = path.join(targetDir, ...file.rel.split('/'))
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, file.content)
      filesCreated.push(file.rel)
    }
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    platform,
    minecraftVersion,
    projectDir: targetDir,
    filesCreated,
    buildCommand: process.platform === 'win32' ? 'gradlew.bat build' : './gradlew build',
    wrapperReady: true,
    resolution,
    unverified,
    sources,
    note,
  }
}
