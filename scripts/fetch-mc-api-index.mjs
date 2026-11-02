#!/usr/bin/env node
/**
 * Generate the offline signature index for one platform line.
 *
 * Why this exists: the skills forbid writing API signatures from memory, and the
 * web fallback is unreliable (maven hosts are routinely unreachable here). A
 * local, greppable list of exact signatures — extracted from the same artefacts
 * the project compiles against — removes that guesswork.
 *
 * Resolution order per artefact:
 *   1. Gradle's module cache (`~/.gradle/caches/modules-2/files-2.1`), because a
 *      machine that has built the project already owns the jars;
 *   2. `.cache/mc-api/` (previous downloads);
 *   3. the upstream maven (Paper/Forge/NeoForge/Fabric), with retries.
 *
 * Extraction uses `javap -public` on a compiled jar (exact signatures, no
 * parser); when only a sources jar exists, a conservative regex backend runs and
 * the header records that fact. Failures never abort the run: every attempted
 * line is recorded in the platform's `COVERAGE.md` with the reason.
 *
 * Usage:
 *   node scripts/fetch-mc-api-index.mjs --all
 *   node scripts/fetch-mc-api-index.mjs --platform paper --line 26.3
 *   node scripts/fetch-mc-api-index.mjs --check        # provenance staleness only
 *
 * @module minecraft-dev/scripts/fetch-mc-api-index
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  download,
  fitIndex,
  extractArchive,
  findJdk,
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

/**
 * One platform's per-line artefacts.
 *
 * `skill` is the skill directory that receives the index; `packages` is the
 * whitelist of API packages worth indexing (everything else is implementation
 * detail and only bloats the file).
 */
const PLATFORMS = {
  paper: {
    skill: 'minecraft-paper-plugin',
    javaVersion: 25,
    packages: ['org.bukkit.', 'io.papermc.paper.'],
    maven: 'https://repo.papermc.io/repository/maven-public',
    group: 'io.papermc.paper/paper-api',
    coordinateName: 'io.papermc.paper:paper-api',
    lines: ['26.3', '26.2'],
    license: 'Paper API — https://docs.papermc.io/ (Bukkit: GPLv3; Paper patches: MIT)',
    resolve: async line => {
      const metadata = await fetchText(`${'https://repo.papermc.io/repository/maven-public'}/io/papermc/paper/paper-api/maven-metadata.xml`)
      if (!metadata) return undefined
      const versions = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1])
      if (Number(line.split('.')[0]) >= 26) {
        const builds = versions.filter(version => version.startsWith(`${line}.build.`) && version.endsWith('-stable'))
        return builds.at(-1)
      }
      return versions.filter(version => version.startsWith(`${line}-R0.1-SNAPSHOT`)).at(-1)
    },
  },
  fabric: {
    skill: 'minecraft-fabric-mod',
    javaVersion: 25,
    packages: ['net.fabricmc.fabric.api.'],
    group: 'net.fabricmc.fabric-api',
    coordinateName: 'net.fabricmc.fabric-api:*',
    lines: ['26.3'],
    license: 'Fabric API — Apache-2.0, https://github.com/FabricMC/fabric',
    // Fabric API splits into ~60 modules whose jars Gradle already caches; the
    // aggregate `fabric-api` artefact is a bundle with no classes of its own.
    resolve: async line => (line === '26.3' ? 'modules' : undefined),
  },
  neoforge: {
    skill: 'minecraft-neoforge-mod',
    javaVersion: 25,
    packages: ['net.neoforged.neoforge.', 'net.neoforged.fml.', 'net.neoforged.bus.'],
    maven: 'https://maven.neoforged.net/releases',
    group: 'net.neoforged/neoforge',
    coordinateName: 'net.neoforged:neoforge',
    lines: ['26.3', '26.2', '1.21.11'],
    license: 'NeoForge — LGPL-2.1, https://github.com/neoforged/NeoForge',
    resolve: async line => ({ '26.3': '26.3.0.12-beta', '26.2': '26.2.0.59', '1.21.11': '21.11.45' })[line],
  },
  forge: {
    skill: 'minecraft-forge-mod',
    javaVersion: 17,
    packages: ['net.minecraftforge.fml.', 'net.minecraftforge.event.', 'net.minecraftforge.registries.', 'net.minecraftforge.common.'],
    maven: 'https://maven.minecraftforge.net',
    group: 'net.minecraftforge/forge',
    coordinateName: 'net.minecraftforge:forge',
    lines: ['1.12.2', '1.20.1', '1.16.5'],
    license: 'MinecraftForge — LGPL-2.1, https://github.com/MinecraftForge/MinecraftForge',
    resolve: async line => ({ '1.12.2': '1.12.2-14.23.5.2860', '1.20.1': '1.20.1-47.3.0', '1.16.5': '1.16.5-36.2.39' })[line],
  },
  spigot: {
    skill: 'minecraft-spigot-legacy',
    javaVersion: 8,
    packages: ['org.bukkit.'],
    lines: ['1.12.2', '1.7.10'],
    license: 'Spigot API — GPLv3, https://hub.spigotmc.org/',
    resolve: async () => undefined,
  },
}

/** Fetch a URL as text with a short timeout; `undefined` on any failure. */
async function fetchText(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    return response.status === 200 ? await response.text() : undefined
  } catch {
    return undefined
  }
}

/**
 * Look for an artefact in Gradle's module cache.
 *
 * Layout is `<files-2.1>/<group as dirs>/<artifact>/<version>/<sha1-of-file>/<file>`,
 * so `groupPath` must name the artifact too (e.g. `io.papermc.paper/paper-api`).
 * @param {string} groupPath - group + artifact, slash separated.
 * @param {string|undefined} version - exact version to pin, or `undefined` for any.
 * @param {'binary'|'sources'} kind - which artefact kind to prefer.
 * @returns {{ path: string, version: string } | undefined} the newest match.
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
/**
 * Same lookup, but accepting any cached version with the same line prefix
 * (`26.3.build.`). Used when the resolved upstream build has not been cached yet.
 * @param {string} groupPath - group + artifact, slash separated.
 * @param {string} prefix - version prefix, e.g. `26.3.build.`.
 * @param {'binary'|'sources'} kind - artefact kind.
 * @returns {{ path: string, version: string } | undefined} newest matching entry.
 */
function fromGradleCacheByPrefix(groupPath, prefix, kind) {
  const root = join(GRADLE_CACHE, ...groupPath.split('/'))
  if (!existsSync(root)) return undefined
  const versions = readdirSync(root).filter(v => v.startsWith(prefix))
  for (const version of versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const hit = fromGradleCache(groupPath, version, kind)
    if (hit) return hit
  }
  return undefined
}

/** Download `name` from a maven layout, trying the plain jar then sources. */
async function fromMaven(platform, version) {
  const base = `${platform.maven}/${platform.group}/${version}`
  const shortName = platform.group.split('/').pop()
  for (const [suffix, kind] of [['.jar', 'binary'], ['-sources.jar', 'sources']]) {
    const file = `${shortName}-${version}${suffix}`
    const dest = join(CACHE, platform.coordinateName.replace(':', '_').replace('*', 'x'), file)
    mkdirSync(dirname(dest), { recursive: true })
    if (!existsSync(dest) && !(await download(`${base}/${file}`, dest))) continue
    return { path: dest, kind }
  }
  return undefined
}

/**
 * Index one artefact: pick an extractor and return the class map plus metadata.
 * @param {object} options - platform, version, artifact path and kind.
 * @returns {{ classes: Map<string, string[]>, backend: string, jdk: number } | undefined} extracted classes.
 */
function extract({ platform, path, kind }) {
  const jdk = findJdk(platform.javaVersion)
  if (!jdk) return undefined
  if (kind === 'binary' || /\.jar$/.test(path) && !/-sources\.jar$/.test(path)) {
    const classes = listClasses(path, platform.packages)
    if (classes.length === 0) return undefined
    return { classes: javapClasses(path, classes, jdk.bin), backend: 'javap', jdk: jdk.version }
  }
  const unpacked = join(CACHE, 'sources', `${platform.coordinateName.replace(/[:*]/g, '_')}-${sha1Of(path).slice(0, 8)}`)
  if (!existsSync(unpacked)) extractArchive(path, unpacked)
  const classes = sourcesClasses(unpacked, platform.packages)
  if (classes.size === 0) return undefined
  return { classes, backend: 'sources', jdk: jdk.version }
}

/** Render and write one line's index; returns a coverage record. */
function writeIndex(platformName, platform, line, extractResult, artifact, origin, sha1Override) {
  const priority = skillMentionedClasses()
  const fitted = fitIndex(
    {
      platform: platformName,
      line,
      artifact,
      sha1: sha1Override ?? sha1Of(origin.path),
      origin: origin.label,
      fetchedAt: today(),
      jdk: String(extractResult.jdk),
      backend: extractResult.backend,
      notes: [platform.license],
    },
    orderClasses(extractResult.classes, priority),
  )
  const body = fitted.body
  const dir = join(REPO, 'assets', 'skills', platform.skill, 'references', 'api-index')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${line}.md`), body, 'utf8')
  writeFileSync(
    join(dir, 'NOTICE.md'),
    [
      `# ${platformName} API 索引来源`,
      '',
      `- 官方文档/许可证：${platform.license}`,
      '- 索引只包含公开成员的**签名**（类名 + 成员声明），不含源码正文、方法体或 javadoc 原文。',
      `- 生成器：\`scripts/fetch-mc-api-index.mjs\`；每个 \`<line>.md\` 头部记录来源坐标、sha1、抓取日期、JDK 与命名映射。`,
      '- 它是**检索辅助**，可能被截断；签名确认以官方文档为准。',
      '',
    ].join('\n'),
    'utf8',
  )
  return {
    status: `ok${fitted.kept < fitted.total ? ` (truncated ${fitted.kept}/${fitted.total})` : ''} ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`,
  }
}

/** Index every configured line of one platform. */
async function runPlatform(platformName) {
  const platform = PLATFORMS[platformName]
  const coverage = []
  for (const line of platform.lines) {
    const version = await platform.resolve(line)
    if (!version) {
      coverage.push({ line, status: 'unavailable: no-public-artifact' })
      continue
    }
    if (version === 'modules') {
      const record = indexFabricModules(platformName, platform, line)
      coverage.push({ line, ...record })
      continue
    }
    const groupPath = platform.group
    const exact = fromGradleCache(groupPath, version, 'binary') ?? fromGradleCache(groupPath, version, 'sources')
    const cached = exact ?? fromGradleCacheByPrefix(groupPath, version.replace(/-\d[\d.]*$/, '').replace(/\.build\..*$/, '') || version, 'binary')
    let origin
    let usedVersion = version
    if (exact) {
      origin = { path: exact.path, kind: /-sources\.jar$/.test(exact.path) ? 'sources' : 'binary', label: `gradle-cache ${exact.path}` }
    } else {
      const downloaded = await fromMaven(platform, version)
      if (downloaded) origin = { path: downloaded.path, kind: downloaded.kind, label: `download ${platform.maven}` }
      if (!origin && cached) {
        usedVersion = cached.version
        origin = { path: cached.path, kind: /-sources\.jar$/.test(cached.path) ? 'sources' : 'binary', label: `gradle-cache ${cached.path} (line fallback, requested ${version})` }
      }
    }
    if (!origin) {
      coverage.push({ line, status: 'unavailable: host-unreachable' })
      continue
    }
    const result = extract({ platform, path: origin.path, kind: origin.kind })
    if (!result || result.classes.size === 0) {
      coverage.push({ line, status: 'unavailable: no-classes-in-whitelist' })
      continue
    }
    const artifact = `${platform.coordinateName}:${usedVersion}`
    coverage.push({ line, artifact, ...writeIndex(platformName, platform, line, result, artifact, origin) })
  }
  writeCoverage(platformName, platform, coverage)
  return coverage
}

/** Fabric: index the module jars Gradle already cached (the aggregate jar has no classes). */
function indexFabricModules(platformName, platform, line) {
  const root = join(GRADLE_CACHE, 'net.fabricmc.fabric-api')
  if (!existsSync(root)) return { status: 'unavailable: no fabric-api modules in gradle cache' }
  const merged = new Map()
  const modules = []
  for (const module of readdirSync(root)) {
    const found = fromGradleCache(`net.fabricmc.fabric-api/${module}`, undefined, 'binary')
    if (!found) continue
    const result = extract({ platform, path: found.path, kind: 'binary' })
    if (!result || result.classes.size === 0) continue
    modules.push(`${module}@${found.version}`)
    for (const [name, members] of result.classes) merged.set(name, members)
  }
  if (merged.size === 0) return { status: 'unavailable: no fabric-api classes found' }
  const result = { classes: merged, backend: 'javap', jdk: findJdk(platform.javaVersion)?.version ?? 0 }
  const artifact = `net.fabricmc.fabric-api (${modules.length} modules)`
  const origin = { path: join(root), label: `gradle-cache ${root}` }
  const digest = createHash('sha1').update(modules.join('\n')).digest('hex')
  const written = writeIndex(platformName, platform, line, result, artifact, origin, digest)
  return { artifact, modules: modules.length, moduleList: modules.join(', '), ...written }
}

/** Write the per-platform coverage table. */
function writeCoverage(platformName, platform, coverage) {
  const dir = join(REPO, 'assets', 'skills', platform.skill, 'references', 'api-index')
  mkdirSync(dir, { recursive: true })
  const lines = [
    `# ${platformName} 索引覆盖表`,
    '',
    `> 由 \`node scripts/fetch-mc-api-index.mjs --platform ${platformName} --all\` 生成，${today()}。`,
    '> `unavailable` 表示该线的工件拿不到（上游不可达或无公开工件），技能里的 web 兜底仍然有效。',
    '',
    '| 线 | 状态 | 工件 / 备注 |',
    '|---|---|---|',
    ...coverage.map(entry => `| ${entry.line} | ${entry.status} | ${entry.artifact ?? ''} |`),
    '',
  ]
  writeFileSync(join(dir, 'COVERAGE.md'), lines.join('\n'), 'utf8')
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
  const allLines = args.includes('--all')
  const platformName = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : undefined
  // --all without --platform means every platform; with --platform it means every line.
  const targets = platformName ? [platformName] : allLines ? Object.keys(PLATFORMS) : []
  if (targets.length === 0) {
    console.error('usage: fetch-mc-api-index.mjs (--all | --platform <paper|fabric|forge|neoforge|spigot>) [--line <line>]')
    process.exit(2)
  }
  const onlyLine = args.includes('--line') ? args[args.indexOf('--line') + 1] : undefined
  for (const target of targets) {
    if (!PLATFORMS[target]) { console.error(`unknown platform: ${target}`); process.exit(2) }
    if (onlyLine) PLATFORMS[target].lines = [onlyLine]
    if (platformName && !allLines && !onlyLine) PLATFORMS[target].lines = PLATFORMS[target].lines.slice(0, 1)
    console.log(`\n=== ${target} ===`)
    const coverage = await runPlatform(target)
    for (const entry of coverage) console.log(`  ${entry.line}: ${entry.status}`)
  }
}

main().catch(error => {
  console.error(`fetch-mc-api-index failed: ${error.message}`)
  process.exit(1)
})
