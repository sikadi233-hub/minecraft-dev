#!/usr/bin/env node
/**
 * Generate offline signature indexes for the third-party mod APIs the
 * `minecraft-major-mods` skill documents.
 *
 * Two input modes, because third-party artefacts are far less reliable than the
 * platform's own:
 *
 * - `--from-references` reads the coordinates already written down in
 *   `assets/skills/minecraft-major-mods/references/api/*.md` (`curse.maven:…`,
 *   `maven.modrinth:…`, or a plain `group:artifact:version`) and tries to resolve
 *   them. That keeps one source of truth: the same coordinates the skill tells an
 *   agent to compile against.
 * - `--mod-jars <dir>` indexes whatever jars the user drops in (a CurseForge or
 *   Modrinth download, or a Gradle cache copy). On a machine whose proxy blocks
 *   mod mavens this is the only path that works.
 *
 * The output is **local only** (`.cache/mod-api/`, gitignored): these are
 * third-party mods, so we do not redistribute derived signatures in the npm
 * package. Every file records its artefact, sha1, and — importantly — the name
 * mapping detected in the jar. A Forge/NeoForge jar reobfuscated to SRG, or a
 * Fabric jar referencing intermediary, yields `func_12345_`/`class_1234` where a
 * human expects `getX`/`ItemStack`; the header says so instead of pretending.
 *
 * Usage:
 *   node scripts/fetch-mod-api-index.mjs --from-references
 *   node scripts/fetch-mod-api-index.mjs --mod-jars <dir> [--line 1.12.2]
 *
 * @module minecraft-dev/scripts/fetch-mod-api-index
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { download, findJdk, javapClasses, listClasses, orderClasses, renderIndex, sha1Of, skillMentionedClasses, today } from './mc-index-lib.mjs'

const REPO = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT_ROOT = join(REPO, '.cache', 'mod-api')
const DOWNLOAD_CACHE = join(REPO, '.cache', 'mod-jars-downloaded')
const GRADLE_CACHE = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1')

/** Packages never worth indexing inside a mod jar. */
const SKIP = ['java.', 'javax.', 'com.google.', 'org.slf4j.', 'org.apache.', 'it.unimi.', 'com.mojang.', 'net.minecraft.']

/** Per-mod byte ceiling; mods are small, so this rarely bites. */
const MOD_INDEX_CAP = 300 * 1024

/**
 * Collect `curse.maven:…`, `maven.modrinth:…` and plain maven coordinates from
 * the major-mods reference documents, tagged with the era directory they came
 * from (`mods-1.12.2.md` → `1.12.2`).
 * @returns {{ coordinate: string, line: string, source: string }[]} unique hits.
 */
function readReferenceCoordinates() {
  const dir = join(REPO, 'assets', 'skills', 'minecraft-major-mods', 'references', 'api')
  if (!existsSync(dir)) return []
  const seen = new Map()
  for (const file of readdirSync(dir).filter(name => name.endsWith('.md'))) {
    const line = /mods-(1\.\d+(?:\.\d+)?)\.md/.exec(file)?.[1] ?? 'modern'
    const text = readFileSync(join(dir, file), 'utf8')
    for (const match of text.matchAll(/`([^`\n]{6,120})`/g)) {
      const value = match[1].trim()
      if (/^curse\.maven:[a-z0-9-]+-\d+:\d+$/.test(value)) seen.set(`${line}|${value}`, { coordinate: value, line, source: file })
      else if (/^maven\.modrinth:[^:\s]+:[^:\s]+$/.test(value)) seen.set(`${line}|${value}`, { coordinate: value, line, source: file })
      else if (/^[a-z][\w.]*:[a-z][\w-]*:\d[\w.+-]*$/i.test(value) && !/^curse\.maven/.test(value)) seen.set(`${line}|${value}`, { coordinate: value, line, source: file })
    }
  }
  return [...seen.values()]
}

/**
 * Resolve one coordinate to a local jar by trying, in order: an explicit
 * `--mod-jars` directory, the Gradle module cache, then the upstream maven.
 * @param {{ coordinate: string, line: string }} entry - coordinate to resolve.
 * @param {string|undefined} jarDir - user supplied jar directory.
 * @returns {Promise<{ path: string, origin: string } | { error: string }>} resolution result.
 */
async function resolveCoordinate(entry, jarDir) {
  const coordinate = entry.coordinate
  const slug = coordinate.split(':').at(-2) ?? coordinate
  const token = slug.replace(/-?\d+$/, '').toLowerCase()

  if (jarDir) {
    const hit = readdirSync(jarDir).find(name => name.toLowerCase().includes(token) && name.endsWith('.jar'))
    if (hit) return { path: join(jarDir, hit), origin: `mod-jars ${hit}` }
  }

  if (coordinate.startsWith('curse.maven:')) {
    // curse.maven:<slug>-<projectId>:<fileId> → cursemaven.com's mirror layout
    const [, body] = coordinate.split(':')
    const [slugId, fileId] = body.split(':')
    const projectId = slugId.split('-').at(-1)
    const dest = join(DOWNLOAD_CACHE, `${slugId}-${fileId}.jar`)
    mkdirSync(DOWNLOAD_CACHE, { recursive: true })
    for (const url of [
      `https://cursemaven.com/curse/maven/${slugId}/${fileId}/${slugId}-${fileId}.jar`,
      `https://www.curseforge.com/api/v1/mods/${projectId}/files/${fileId}/download`,
    ]) {
      if (existsSync(dest) || (await download(url, dest, 60_000))) {
        if (existsSync(dest)) return { path: dest, origin: `download ${url}` }
      }
    }
    return { error: 'host-unreachable (curse.maven)' }
  }

  if (coordinate.startsWith('maven.modrinth:')) {
    const [, project, version] = coordinate.split(':')
    const dest = join(DOWNLOAD_CACHE, `modrinth-${project}-${version}.jar`)
    mkdirSync(DOWNLOAD_CACHE, { recursive: true })
    const url = `https://api.modrinth.com/maven/maven/modrinth/${project}/${version}/${project}-${version}.jar`
    if (existsSync(dest) || (await download(url, dest, 60_000))) return { path: dest, origin: `download ${url}` }
    return { error: 'host-unreachable (modrinth)' }
  }

  const [group, artifact, version] = coordinate.split(':')
  const cacheRoot = join(GRADLE_CACHE, ...group.split('.'), artifact, version)
  if (existsSync(cacheRoot)) {
    for (const hashDir of readdirSync(cacheRoot)) {
      const dir = join(cacheRoot, hashDir)
      const jar = readdirSync(dir).find(name => name.endsWith('.jar') && !name.includes('-sources'))
      if (jar) return { path: join(dir, jar), origin: `gradle-cache ${join(dir, jar)}` }
    }
  }
  return { error: 'not-in-gradle-cache (upstream maven not attempted)' }
}

/**
 * Index one jar file into a Markdown body.
 * @param {string} jarPath - absolute jar path.
 * @param {{ line: string, epoch: string }} meta - era tag and coordinate label.
 * @returns {{ body: string, classes: number, mapping: string } | { error: string }} result.
 */
function indexJar(jarPath, meta) {
  const jdk = findJdk(25)
  if (!jdk) return { error: 'no-jdk' }
  const classes = listClasses(jarPath, [])
    .filter(name => !SKIP.some(prefix => name.startsWith(prefix)))
  if (classes.length === 0) return { error: 'no-classes' }
  const extracted = javapClasses(jarPath, classes, jdk.bin)
  if (extracted.size === 0) return { error: 'javap-empty' }
  const ordered = orderClasses(extracted, skillMentionedClasses())
  // Reuse the platform renderer with a tight cap; mods rarely need truncation.
  const rendered = renderIndex({
    platform: 'mod',
    line: meta.line,
    artifact: meta.epoch,
    sha1: sha1Of(jarPath),
    origin: jarPath,
    fetchedAt: today(),
    jdk: String(jdk.version),
    backend: 'javap',
    classes: new Map(ordered.slice(0, ordered.length)),
    truncated: false,
    totalClasses: ordered.length,
    notes: ['third-party mod API; local only, not published in the npm package'],
    generator: 'scripts/fetch-mod-api-index.mjs',
  })
  return { body: rendered, classes: extracted.size }
}

/** Write one index and return its coverage row. */
function writeModIndex(name, jarPath, line, epoch) {
  const result = indexJar(jarPath, { line, epoch })
  if (result.error) return { status: `unavailable: ${result.error}` }
  if (Buffer.byteLength(result.body) > MOD_INDEX_CAP) {
    // Extremely large mods: keep the head, say so.
    const cut = result.body.slice(0, MOD_INDEX_CAP)
    const dir = join(OUT_ROOT, line)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}.md`), `${cut}\n\n<!-- TRUNCATED: ${Buffer.byteLength(result.body)} bytes total -->\n`, 'utf8')
    return { status: `ok (truncated to ${Math.round(MOD_INDEX_CAP / 1024)} KB, ${result.classes} classes)` }
  }
  const dir = join(OUT_ROOT, line)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), result.body, 'utf8')
  return { status: `ok (${result.classes} classes, ${Math.round(Buffer.byteLength(result.body) / 1024)} KB)` }
}

/** Entry point. */
async function main() {
  const args = process.argv.slice(2)
  const jarDir = args.includes('--mod-jars') ? args[args.indexOf('--mod-jars') + 1] : undefined
  const line = args.includes('--line') ? args[args.indexOf('--line') + 1] : 'unknown'
  const coverage = []

  if (jarDir) {
    if (!existsSync(jarDir)) {
      console.error(`--mod-jars directory not found: ${jarDir}`)
      process.exit(2)
    }
    console.log(`\n=== indexing jars from ${jarDir} ===`)
    for (const file of readdirSync(jarDir).filter(name => name.endsWith('.jar'))) {
      const name = basename(file, '.jar').toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
      const row = writeModIndex(name, join(jarDir, file), line, basename(file))
      console.log(`  ${file}: ${row.status}`)
      coverage.push({ mod: name, line, status: row.status })
    }
  } else {
    const entries = readReferenceCoordinates()
    console.log(`\n=== resolving ${entries.length} coordinates from the major-mods references ===`)
    for (const entry of entries) {
      const resolved = await resolveCoordinate(entry, undefined)
      const name = entry.coordinate.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()
      if (resolved.error) {
        console.log(`  ${entry.coordinate} (${entry.line}): ${resolved.error}`)
        coverage.push({ mod: entry.coordinate, line: entry.line, status: `unavailable: ${resolved.error}` })
        continue
      }
      const row = writeModIndex(name, resolved.path, entry.line, `${entry.coordinate} (${resolved.origin})`)
      console.log(`  ${entry.coordinate} (${entry.line}): ${row.status}`)
      coverage.push({ mod: entry.coordinate, line: entry.line, status: row.status })
    }
  }

  mkdirSync(OUT_ROOT, { recursive: true })
  writeFileSync(
    join(OUT_ROOT, 'COVERAGE.md'),
    [
      '# mod API 索引覆盖表（本地，不随包发布）',
      '',
      `> 生成时间 ${today()}。\`unavailable\` 多为代理未放行 mod maven 或该 mod 无公开 API 工件。`,
      '> 索引头部的 `mapping=srg|intermediary` 表示 jar 里 MC 类型是混淆名，不可直接照抄。',
      '',
      '| 模组 / 坐标 | 线 | 状态 |',
      '|---|---|---|',
      ...coverage.map(row => `| ${row.mod} | ${row.line} | ${row.status} |`),
      '',
    ].join('\n'),
    'utf8',
  )
  console.log(`\ncoverage written to ${OUT_ROOT}\\COVERAGE.md`)
}

main().catch(error => {
  console.error(`fetch-mod-api-index failed: ${error.message}`)
  process.exit(1)
})
