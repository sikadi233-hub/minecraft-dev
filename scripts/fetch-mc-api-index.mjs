#!/usr/bin/env node
/**
 * Generate the offline signature index for every platform line this plugin
 * supports.
 *
 * The line matrix is not maintained here: it is read from `lib/versions.js`
 * (`PLATFORM_LINES`), the same table `mc_scaffold` uses, so the corpus cannot
 * drift from the versions the plugin actually pins. Today that is 19 lines
 * spanning MC 1.7.10 … 26.3.
 *
 * Why this exists: the skills forbid writing API signatures from memory, and the
 * web fallback is unreliable (maven hosts are routinely unreachable here). A
 * local, greppable list of exact signatures — extracted from the same artefacts
 * the project compiles against — removes that guesswork.
 *
 * Resolution order per artefact:
 *   1. Gradle's module cache (exact version, then any version of the same line);
 *   2. `.cache/mc-api/` (previous downloads);
 *   3. upstream maven, with retries. Snapshots (`-R0.1-SNAPSHOT`) are resolved to
 *      their timestamped file name first, because the literal `-SNAPSHOT` URL
 *      does not exist on the server.
 *
 * Extraction uses `javap -public` on a compiled jar, which works even when only
 * the binary is published (Paper's snapshot lines and Forge's universal jars
 * publish no sources at all). A sources jar is used when it is the only thing
 * available, and the header records that.
 *
 * Every line gets a depth tier: each platform's newest line is `deep` (300 KB),
 * historical lines are `wide` (100 KB). Pass `--line` to force one line deep.
 *
 * Usage:
 *   node scripts/fetch-mc-api-index.mjs --all
 *   node scripts/fetch-mc-api-index.mjs --platform paper --all
 *   node scripts/fetch-mc-api-index.mjs --platform paper --line 1.20.6
 *   node scripts/fetch-mc-api-index.mjs --check
 *
 * @module minecraft-dev/scripts/fetch-mc-api-index
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultJavaVersion, paperApiVersion, PLATFORM_LINES } from '../lib/versions.js'
import {
  download,
  extractArchive,
  findJdk,
  fitIndex,
  javapClasses,
  listClasses,
  orderClasses,
  sha1Of,
  skillMentionedClasses,
  sourcesClasses,
  today,
} from './mc-index-lib.mjs'

const REPO = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const GRADLE_CACHE = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1')
const CACHE = join(REPO, '.cache', 'mc-api')

/** Per-line byte ceilings, by depth tier. */
const DEPTH_CAP = { deep: 300 * 1024, wide: 100 * 1024 }
/** Raw corpus ceiling, reported at the end of a run. */
const CORPUS_RAW_BUDGET = 3 * 1024 * 1024

/**
 * Platform wiring: which skill receives the index, which API packages are worth
 * listing, and the licence line recorded in the NOTICE.
 */
const PLATFORMS = {
  paper: {
    skill: 'minecraft-paper-plugin',
    packages: ['org.bukkit.', 'io.papermc.paper.'],
    packagePriority: ['org.bukkit', 'org.bukkit.event', 'io.papermc.paper'],
    license: 'Paper API — https://docs.papermc.io/ (Bukkit: GPLv3; Paper patches: MIT)',
  },
  fabric: {
    skill: 'minecraft-fabric-mod',
    packages: ['net.fabricmc.fabric.api.'],
    packagePriority: ['net.fabricmc.fabric.api'],
    license: 'Fabric API — Apache-2.0, https://github.com/FabricMC/fabric',
  },
  neoforge: {
    skill: 'minecraft-neoforge-mod',
    packages: ['net.neoforged.neoforge.', 'net.neoforged.fml.', 'net.neoforged.bus.'],
    packagePriority: ['net.minecraftforge.fml.common', 'net.minecraftforge.event', 'net.minecraftforge.registries', 'net.minecraftforge.common', 'net.minecraftforge.oredict'],
    packagePriority: ['net.neoforged.neoforge.event', 'net.neoforged.neoforge.registries', 'net.neoforged.neoforge.common', 'net.neoforged.fml', 'net.neoforged.bus'],
    license: 'NeoForge — LGPL-2.1, https://github.com/neoforged/NeoForge',
  },
  forge: {
    skill: 'minecraft-forge-mod',
    packages: ['net.minecraftforge.fml.', 'net.minecraftforge.event.', 'net.minecraftforge.registries.', 'net.minecraftforge.common.'],
    license: 'MinecraftForge — LGPL-2.1, https://github.com/MinecraftForge/MinecraftForge',
  },
  spigot: {
    skill: 'minecraft-spigot-legacy',
    packages: ['org.bukkit.'],
    packagePriority: ['org.bukkit', 'org.bukkit.event'],
    license: 'Spigot API — GPLv3, https://hub.spigotmc.org/',
  },
}

/** Fetch a URL as text with a short timeout; `undefined` on any failure. */
async function fetchText(url, timeout = 25_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.status === 200 ? await response.text() : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve a `-SNAPSHOT` artefact to its timestamped file name.
 *
 * Maven stores snapshots as `<artifact>-<version-minus-SNAPSHOT>-<timestamp>-<build>.<ext>`;
 * requesting the literal `-SNAPSHOT` URL returns 404. The per-version metadata
 * carries the timestamp/build pair.
 * @param {string} base - version directory URL, no trailing slash.
 * @param {string} artifact - artefact id, e.g. `paper-api`.
 * @param {string} version - e.g. `1.21.11-R0.1-SNAPSHOT`.
 * @param {string} extension - `jar` or `sources.jar`.
 * @returns {Promise<string|undefined>} absolute download URL.
 */
async function resolveSnapshot(base, artifact, version, extension) {
  const metadata = await fetchText(`${base}/maven-metadata.xml`)
  if (!metadata) return undefined
  const stamp = /<timestamp>([^<]+)<\/timestamp>/.exec(metadata)?.[1]
  const build = /<buildNumber>([^<]+)<\/buildNumber>/.exec(metadata)?.[1]
  if (!stamp || !build) return undefined
  const snapshotVersion = version.replace(/-SNAPSHOT$/, '')
  return `${base}/${artifact}-${snapshotVersion}-${stamp}-${build}.${extension}`
}

/**
 * Look for an artefact in Gradle's module cache.
 * Layout: `<files-2.1>/<group as dirs>/<artifact>/<version>/<sha1>/<file>`.
 * @param {string} groupPath - group + artifact, slash separated.
 * @param {string|undefined} version - exact version, or `undefined` for any.
 * @param {'binary'|'sources'} kind - artefact kind to prefer.
 * @returns {{ path: string, version: string } | undefined} newest match.
 */
function fromGradleCache(groupPath, version, kind) {
  const root = join(GRADLE_CACHE, ...groupPath.split('/'))
  if (!existsSync(root)) return undefined
  const wanted = new RegExp(kind === 'sources' ? '-sources\\.jar$' : '(?<!-sources)\\.jar$')
  const candidates = []
  for (const artifactVersion of readdirSync(root)) {
    if (version !== undefined && artifactVersion !== version) continue
    const versionDir = join(root, artifactVersion)
    if (!statSync(versionDir).isDirectory()) continue
    for (const hashDir of readdirSync(versionDir)) {
      const dir = join(versionDir, hashDir)
      if (!statSync(dir).isDirectory()) continue
      for (const file of readdirSync(dir)) {
        if (wanted.test(file)) candidates.push({ path: join(dir, file), version: artifactVersion })
      }
    }
  }
  return candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0]
}

/** Same lookup, but accepting any cached version sharing a line prefix. */
function fromGradleCacheByPrefix(groupPath, prefix, kind) {
  const root = join(GRADLE_CACHE, ...groupPath.split('/'))
  if (!existsSync(root)) return undefined
  const versions = readdirSync(root).filter(version => version.startsWith(prefix))
  for (const version of versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const hit = fromGradleCache(groupPath, version, kind)
    if (hit) return hit
  }
  return undefined
}

/** Download `url` into the cache; returns the path when it landed. */
async function cachedDownload(platform, name, url, timeout = 120_000) {
  const dest = join(CACHE, platform, name)
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest) && statSync(dest).size > 0) return dest
  return (await download(url, dest, timeout)) ? dest : undefined
}

/**
 * Resolve one (platform, line) to a local artefact.
 * @param {string} platformName - key of {@link PLATFORMS}.
 * @param {{ line: string, defaultMcVersion: string, coords?: object }} entry - one `lib/versions.js` line.
 * @returns {Promise<object>} `{ path, kind, version, origin, modules? }` or `{ error }`.
 */
async function resolveLineArtifact(platformName, entry) {
  const mc = entry.defaultMcVersion
  const coords = entry.coords ?? {}

  if (platformName === 'paper') {
    const version = paperApiVersion(mc)
    const groupPath = 'io.papermc.paper/paper-api'
    const exact = fromGradleCache(groupPath, version, 'binary')
    if (exact) return { path: exact.path, kind: 'binary', version: exact.version, origin: `gradle-cache ${exact.path}` }
    if (version.endsWith('.build.+')) {
      const metadata = await fetchText('https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml')
      const builds = [...(metadata ?? '').matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1])
      const resolved = builds.filter(candidate => candidate.startsWith(version.replace('.+', '.')) && candidate.endsWith('-stable')).at(-1)
      if (!resolved) return { error: 'no-build-found' }
      const cached = fromGradleCache(groupPath, resolved, 'binary') ?? fromGradleCacheByPrefix(groupPath, version.replace('.+', '.'), 'binary')
      if (cached) return { path: cached.path, kind: 'binary', version: cached.version, origin: `gradle-cache ${cached.path}` }
      const url = `https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/${resolved}/paper-api-${resolved}.jar`
      const path = await cachedDownload('paper', `paper-api-${resolved}.jar`, url)
      return path ? { path, kind: 'binary', version: resolved, origin: `download ${url}` } : { error: 'host-unreachable' }
    }
    // `-R0.1-SNAPSHOT`: resolve the timestamped file name first.
    const base = `https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/${version}`
    const url = await resolveSnapshot(base, 'paper-api', version, 'jar')
    if (!url) return { error: 'snapshot-unresolved' }
    const path = await cachedDownload('paper', `paper-api-${version}.jar`, url)
    return path ? { path, kind: 'binary', version, origin: `download ${url}` } : { error: 'host-unreachable' }
  }

  if (platformName === 'neoforge') {
    const version = coords.neoVersion
    const groupPath = 'net.neoforged/neoforge'
    const exact = fromGradleCache(groupPath, version, 'sources') ?? fromGradleCache(groupPath, version, 'binary')
    if (exact) {
      return {
        path: exact.path,
        kind: /-sources\.jar$/.test(exact.path) ? 'sources' : 'binary',
        version,
        origin: `gradle-cache ${exact.path}`,
      }
    }
    for (const [suffix, kind] of [['-sources.jar', 'sources'], ['.jar', 'binary']]) {
      const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}${suffix}`
      const path = await cachedDownload('neoforge', `neoforge-${version}${suffix}`, url, 60_000)
      if (path) return { path, kind, version, origin: `download ${url}` }
    }
    return { error: 'host-unreachable' }
  }

  if (platformName === 'forge') {
    const combined = `${mc}-${coords.forgeVersion}`
    const groupPath = 'net.minecraftforge/forge'
    const cached = fromGradleCache(groupPath, combined, 'binary')
    if (cached) return { path: cached.path, kind: 'binary', version: combined, origin: `gradle-cache ${cached.path}` }
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${combined}/forge-${combined}-universal.jar`
    const path = await cachedDownload('forge', `forge-${combined}-universal.jar`, url, 90_000)
    return path ? { path, kind: 'binary', version: combined, origin: `download ${url}` } : { error: 'host-unreachable' }
  }

  if (platformName === 'spigot') {
    const version = `${mc}-R0.1-SNAPSHOT`
    const base = `https://hub.spigotmc.org/nexus/content/repositories/snapshots/org/spigotmc/spigot-api/${version}`
    const url = await resolveSnapshot(base, 'spigot-api', version, 'jar')
    if (!url) return { error: 'snapshot-unresolved' }
    const path = await cachedDownload('spigot', `spigot-api-${version}.jar`, url, 90_000)
    return path ? { path, kind: 'binary', version, origin: `download ${url}` } : { error: 'host-unreachable' }
  }

  // fabric: the aggregate artefact is a bundle; modules come from its POM.
  const apiVersion = coords.fabricApiVersion
  const pomBase = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api'
  const pom = await fetchText(`${pomBase}/${apiVersion}/fabric-api-${apiVersion}.pom`)
  if (!pom) return { error: 'fabric-pom-unavailable' }
  const modules = []
  for (const match of pom.matchAll(/<artifactId>(fabric-[^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/g)) {
    modules.push([match[1], match[2]])
  }
  if (modules.length === 0) return { error: 'fabric-pom-empty' }
  const jars = []
  for (const [module, moduleVersion] of modules) {
    const cached = fromGradleCache(`net.fabricmc.fabric-api/${module}`, moduleVersion, 'binary')
    if (cached) { jars.push(cached.path); continue }
    const url = `${'https://maven.fabricmc.net'}/net/fabricmc/fabric-api/${module}/${moduleVersion}/${module}-${moduleVersion}.jar`
    const path = await cachedDownload('fabric', `${module}-${moduleVersion}.jar`, url, 60_000)
    if (path) jars.push(path)
  }
  if (jars.length === 0) return { error: 'fabric-modules-unavailable' }
  return {
    path: jars.join(';'),
    kind: 'binary',
    version: apiVersion,
    origin: `fabric modules (${jars.length}/${modules.length})`,
    modules: jars,
  }
}

/**
 * Extract classes from one resolved artefact.
 * @param {object} platform - platform wiring.
 * @param {object} resolved - result of {@link resolveLineArtifact}.
 * @param {number} javaVersion - the line's Java level, for JDK selection.
 * @returns {{ classes: Map<string, string[]>, backend: string, jdk: number } | undefined} extracted classes.
 */
function extract(platform, resolved, javaVersion) {
  const jdk = findJdk(javaVersion)
  if (!jdk) return undefined
  if (resolved.kind === 'sources') {
    const unpacked = join(CACHE, 'sources', sha1Of(String(resolved.path)).slice(0, 8))
    if (!existsSync(unpacked)) extractArchive(String(resolved.path), unpacked)
    const classes = sourcesClasses(unpacked, platform.packages)
    return classes.size === 0 ? undefined : { classes, backend: 'sources', jdk: jdk.version }
  }
  const jars = resolved.modules ?? [resolved.path]
  const merged = new Map()
  for (const jar of jars) {
    const names = listClasses(jar, platform.packages)
    if (names.length === 0) continue
    for (const [name, members] of javapClasses(jar, names, jdk.bin)) merged.set(name, members)
  }
  return merged.size === 0 ? undefined : { classes: merged, backend: 'javap', jdk: jdk.version }
}

/** Render and write one line's index; returns a coverage record. */
function writeIndex(platformName, platform, lineLabel, extractResult, artifact, origin, sha1Override, cap) {
  const fitted = fitIndex(
    {
      platform: platformName,
      line: lineLabel,
      artifact,
      sha1: sha1Override ?? sha1Of(origin.path),
      origin: origin.label,
      fetchedAt: today(),
      jdk: String(extractResult.jdk),
      backend: extractResult.backend,
      notes: [platform.license],
    },
    orderClasses(extractResult.classes, skillMentionedClasses(), platform.packagePriority),
    cap,
  )
  const dir = join(REPO, 'assets', 'skills', platform.skill, 'references', 'api-index')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${lineLabel}.md`), fitted.body, 'utf8')
  writeFileSync(
    join(dir, 'NOTICE.md'),
    [
      `# ${platformName} API 索引来源`,
      '',
      `- 官方文档/许可证：${platform.license}`,
      '- 索引只包含公开成员的**签名**（类名 + 成员声明），不含源码正文、方法体或 javadoc 原文。',
      '- 生成器：`scripts/fetch-mc-api-index.mjs`；每个 `<line>.md` 头部记录来源坐标、sha1、抓取日期、JDK 与命名映射。',
      '- 它是**检索辅助**，可能被截断；签名确认以官方文档为准。',
      '',
    ].join('\n'),
    'utf8',
  )
  return {
    status: `ok${fitted.kept < fitted.total ? ` (truncated ${fitted.kept}/${fitted.total})` : ''} ${(Buffer.byteLength(fitted.body) / 1024).toFixed(0)} KB`,
    bytes: Buffer.byteLength(fitted.body),
  }
}

/** Write the per-platform coverage table. */
function writeCoverage(platformName, platform, coverage) {
  const dir = join(REPO, 'assets', 'skills', platform.skill, 'references', 'api-index')
  mkdirSync(dir, { recursive: true })
  const lines = [
    `# ${platformName} 索引覆盖表`,
    '',
    `> 由 \`node scripts/fetch-mc-api-index.mjs --platform ${platformName} --all\` 生成，${today()}。`,
    '> 线来自 `lib/versions.js` 的钉选矩阵；`unavailable` 表示该线的工件拿不到（上游不可达或无公开工件），技能里的 web 兜底仍然有效。',
    '',
    '| 线 | 状态 | 工件 / 备注 |',
    '|---|---|---|',
    ...coverage.map(entry => `| ${entry.line} | ${entry.status} | ${entry.artifact ?? ''} |`),
    '',
  ]
  writeFileSync(join(dir, 'COVERAGE.md'), lines.join('\n'), 'utf8')
}

/** Index every line of one platform; returns its coverage rows. */
async function runPlatform(platformName, options = {}) {
  const platform = PLATFORMS[platformName]
  const lines = (PLATFORM_LINES[platformName] ?? []).filter(entry => !options.onlyLine || entry.defaultMcVersion === options.onlyLine)
  const coverage = []
  for (const entry of lines) {
    const label = entry.defaultMcVersion
    const depth = options.forceDeep || options.deepLines?.has(`${platformName}:${label}`) ? 'deep' : 'wide'
    const cap = DEPTH_CAP[depth]
    const resolved = await resolveLineArtifact(platformName, entry)
    if (resolved.error) {
      coverage.push({ line: label, status: `unavailable: ${resolved.error}`, bytes: 0 })
      continue
    }
    const extractResult = extract(platform, resolved, defaultJavaVersion(platformName, label))
    if (!extractResult) {
      coverage.push({ line: label, status: 'unavailable: no-classes-in-whitelist', bytes: 0 })
      continue
    }
    const artifact = `${platformName === 'fabric' ? 'fabric-api' : platformName}:${resolved.version}`
    const row = writeIndex(
      platformName,
      platform,
      label,
      extractResult,
      artifact,
      { path: resolved.path.split(';')[0], label: resolved.origin },
      resolved.modules ? createHash('sha1').update(resolved.modules.join('\n')).digest('hex') : undefined,
      cap,
    )
    coverage.push({ line: label, artifact, ...row })
  }
  writeCoverage(platformName, platform, coverage)
  return coverage
}

/** `--check`: verify committed indexes carry a parseable provenance header. */
function checkIndexes() {
  let problems = 0
  for (const [platformName, platform] of Object.entries(PLATFORMS)) {
    const dir = join(REPO, 'assets', 'skills', platform.skill, 'references', 'api-index')
    if (!existsSync(dir)) {
      console.log(`  ${platformName}: no index directory`)
      continue
    }
    for (const file of readdirSync(dir).filter(name => name.endsWith('.md') && name !== 'COVERAGE.md' && name !== 'NOTICE.md')) {
      const text = readFileSync(join(dir, file), 'utf8')
      const ok = /<!-- PROVENANCE/.test(text) && /artifact=/.test(text) && /sha1=[0-9a-f]{40}/.test(text) && /mapping=(official|srg|intermediary)/.test(text)
      console.log(`  ${platformName}/${file}: ${ok ? 'ok' : 'MISSING PROVENANCE'}`)
      if (!ok) problems += 1
    }
  }
  return problems === 0 ? 0 : 1
}

/** CLI entry point. */
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--check')) process.exit(checkIndexes())
  const platformName = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : undefined
  const onlyLine = args.includes('--line') ? args[args.indexOf('--line') + 1] : undefined
  const targets = platformName ? [platformName] : Object.keys(PLATFORMS)

  // Deep tier: each platform's newest supported line.
  const deepLines = new Set(
    Object.entries(PLATFORM_LINES)
      .map(([platform, lines]) => `${platform}:${lines.at(-1)?.defaultMcVersion}`)
      .filter(entry => !entry.endsWith(':undefined')),
  )

  let total = 0
  for (const target of targets) {
    if (!PLATFORMS[target]) { console.error(`unknown platform: ${target}`); process.exit(2) }
    const count = (PLATFORM_LINES[target] ?? []).filter(entry => !onlyLine || entry.defaultMcVersion === onlyLine).length
    console.log(`\n=== ${target} (${count} 条线) ===`)
    const coverage = await runPlatform(target, { deepLines, onlyLine, forceDeep: Boolean(onlyLine) })
    for (const row of coverage) {
      console.log(`  ${row.line}: ${row.status}`)
      total += row.bytes ?? 0
    }
  }
  console.log(`\ncorpus ≈ ${Math.round(total / 1024)} KB (budget ${Math.round(CORPUS_RAW_BUDGET / 1024)} KB)`)
  if (total > CORPUS_RAW_BUDGET) console.log('  over budget: shrink the wide tier or drop lines')
}

main().catch(error => {
  console.error(`fetch-mc-api-index failed: ${error.message}`)
  process.exit(1)
})
