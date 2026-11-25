// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Dynamic version resolution for the three platforms whose coordinates the
 * loaders publish as metadata: Paper, Fabric and NeoForge.
 *
 * The pinned matrix in `lib/versions.js` stays the default because every line
 * there was verified with a real build. This module answers the other question —
 * "what about 1.21.4 / 26.1 / 1.20.4?" — by reading the same metadata the
 * loaders' own generators read, instead of downloading and re-templating their
 * generator output:
 *
 * - Paper: `paper-api` maven metadata, for `<mc>-R0.1-SNAPSHOT` existence.
 * - Fabric: `meta.fabricmc.net` for loader + yarn, Modrinth for the Fabric API
 *   build that targets the version.
 * - NeoForge: `maven.neoforged.net` metadata, filtered to the version series
 *   that belongs to the requested Minecraft version (`21.4.x` for `1.21.4`).
 *
 * A dynamic project is marked `unverified`: it has not been through the build
 * verification the pinned lines have, so the caller must say so.
 *
 * Parsers are pure functions over the raw documents so the tests never need the
 * network; `resolveDynamic` takes a `fetchImpl` for the same reason.
 *
 * @module minecraft-dev/lib/dynamic-versions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))

/** Platforms this module can resolve. */
export const DYNAMIC_PLATFORMS = ['paper', 'fabric', 'neoforge']

/** Where a dynamic result came from, for the card and the README. */
export const SOURCES = {
  paper: 'repo.papermc.io maven-metadata.xml',
  fabricLoader: 'meta.fabricmc.net/v2/versions/loader',
  fabricYarn: 'meta.fabricmc.net/v2/versions/yarn',
  fabricApi: 'api.modrinth.com/v2/project/fabric-api/version',
  neoforge: 'maven.neoforged.net net/neoforged/neoforge/maven-metadata.xml',
}

/**
 * Java language level for an arbitrary Minecraft version.
 *
 * The era boundaries are the ones the pinned matrix already encodes: 1.18-1.20.4
 * build with 17, 1.20.5-1.21.x with 21, 26.x with 25, and anything older is not
 * supported dynamically (the matrix covers 1.7.10/1.12.2/1.16.5 as pinned lines).
 * @param {string} mc - Minecraft version.
 * @returns {number} Java level (17, 21 or 25).
 */
export function javaVersionFor(mc) {
  const [majorRaw, minorRaw, patchRaw] = String(mc).replace(/\.x$/i, '').split('.')
  const major = Number(majorRaw)
  const minor = Number(minorRaw ?? 0)
  const patch = Number(patchRaw ?? 0)
  if (major >= 26) return 25
  if (major === 1 && minor >= 21) return 21
  if (major === 1 && minor === 20 && patch >= 5) return 21
  if (major === 1 && minor >= 18) return 17
  throw new Error(`no dynamic support for Minecraft ${mc}; the pinned lines cover 1.7.10, 1.12.2, 1.16.5, 1.18+, 1.20.x, 1.21.x and 26.x`)
}

/** Template directory for a Paper version (Paper has a single template). */
export function paperTemplate(mc) {
  return 'paper'
}

/** Which Fabric template fits a version: the 26.x generation or the classic one. */
export function fabricTemplate(mc) {
  const major = Number(String(mc).split('.')[0])
  return major >= 26 ? 'fabric-26' : 'fabric'
}

/**
 * Loom version per generation.
 *
 * Deliberately not resolved from the network: loom is a *Gradle plugin*, and the
 * 1.18 line requires the Gradle JVM to be Java 25, which would make every user
 * launch Gradle on 25. The pinned matrix documented that trade-off; dynamic
 * versions inherit it.
 */
export function loomVersionFor(mc) {
  return Number(String(mc).split('.')[0]) >= 26 ? '1.17.21' : '1.17.19'
}

/** Gradle wrapper version per generation (mirrors the pinned entries). */
export function gradleVersionFor(platform, mc) {
  const major = Number(String(mc).split('.')[0])
  if (platform === 'fabric') return '9.5.1'
  if (platform === 'neoforge') return major >= 26 ? '9.2.1' : '9.2.1'
  if (platform === 'paper') return major >= 26 ? '8.14.5' : '8.14.3'
  return '8.14.5'
}

/**
 * NeoForge version series for a Minecraft version.
 *
 * NeoForge numbers releases `<mc.minor>.<patch>.<build>`: 1.20.4 → 20.4.x,
 * 1.21.1 → 21.1.x, 1.21.4 → 21.4.x, 26.3 → 26.3.x. 1.20.1 is the legacy line and
 * has no NeoForge coordinate at all (it uses Forge under legacyforge).
 * @param {string} mc - Minecraft version.
 * @returns {{ series: string, legacy: boolean }} the series prefix and legacy flag.
 */
export function neoSeriesFor(mc) {
  const clean = String(mc).replace(/\.x$/i, '')
  const [major, minor, patch] = clean.split('.').map(Number)
  if (major === 1 && minor === 20 && (patch ?? 0) <= 1) return { series: '', legacy: true }
  if (major >= 26) return { series: `${major}.${minor ?? 0}.`, legacy: false }
  if (major === 1) return { series: `${minor}.${patch ?? 0}.`, legacy: false }
  throw new Error(`cannot map Minecraft ${mc} to a NeoForge series`)
}

/** NeoForge template for a version. */
export function neoTemplateFor(mc) {
  const { legacy } = neoSeriesFor(mc)
  if (legacy) return 'neoforge-1.20.1'
  const clean = String(mc).replace(/\.x$/i, '')
  const [major, minor] = clean.split('.').map(Number)
  if (major >= 26) return 'neoforge-26'
  // 1.21.1 needs the explicit modLoader form; other 1.21.x use the modern template.
  if (minor === 21 && Number(clean.split('.')[2] ?? 0) === 1) return 'neoforge-1.21.1'
  return 'neoforge'
}

/** Extract every `<version>` from a Maven `maven-metadata.xml`. */
export function parseMavenVersions(xml) {
  return [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1].trim())
}

/** Fabric loader versions from `meta.fabricmc.net/v2/versions/loader/<mc>`. */
export function parseFabricLoader(json) {
  const entries = Array.isArray(json) ? json : []
  return entries
    .filter(entry => entry && entry.loader && typeof entry.loader.version === 'string')
    .map(entry => entry.loader.version)
}

/** Yarn versions from `meta.fabricmc.net/v2/versions/yarn/<mc>`. */
export function parseFabricYarn(json) {
  const entries = Array.isArray(json) ? json : []
  return entries.map(entry => entry && entry.version).filter(version => typeof version === 'string')
}

/** Newest Fabric API build from a Modrinth version list for one game version. */
export function parseModrinthFabricApi(json) {
  const entries = Array.isArray(json) ? json : []
  const candidates = entries
    .filter(entry => entry && Array.isArray(entry.game_versions))
    .map(entry => entry.version_number)
    .filter(version => typeof version === 'string')
  return candidates[0] ?? undefined
}

/**
 * Pick the newest stable NeoForge build in a series, falling back to the newest
 * pre-release when the series has no stable build (26.3 ships `-beta` only).
 * @param {string[]} versions - every NeoForge version from the metadata.
 * @param {string} series - series prefix, e.g. `21.4.` or `26.3.`.
 * @returns {string|undefined} the chosen version.
 */
export function pickNeoForge(versions, series) {
  const inSeries = versions.filter(version => version.startsWith(series))
  if (inSeries.length === 0) return undefined
  const stable = inSeries.filter(version => !/(?:-|\.)(?:beta|alpha|rc)\b/i.test(version) && !/-/.test(version))
  const pool = stable.length > 0 ? stable : inSeries
  const byBuild = pool.map(version => {
    const build = Number(version.slice(series.length).split('-')[0])
    return { version, build: Number.isFinite(build) ? build : 0 }
  })
  byBuild.sort((a, b) => b.build - a.build)
  return byBuild[0].version
}

/** Cached document fetcher: network first, disk second, with a short cache. */
function createFetcher(options) {
  const cacheDir = options.cacheDir ?? join(REPO, '.cache', 'dynamic')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 20_000
  return async (url, cacheKey) => {
    const cacheFile = join(cacheDir, `${cacheKey}.json`)
    const fresh = options.cacheTtlMs === 0
    if (!fresh && existsSync(cacheFile) && Date.now() - Number(JSON.parse(readFileSync(cacheFile, 'utf8')).at) < (options.cacheTtlMs ?? 6 * 3_600_000)) {
      return JSON.parse(readFileSync(cacheFile, 'utf8')).body
    }
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
        const text = await response.text()
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), url, body: text }), 'utf8')
        return text
      } catch (error) {
        lastError = error
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8')).body
    throw new Error(`could not fetch ${url}: ${lastError?.message ?? 'unknown error'}`)
  }
}

/**
 * Resolve the coordinates for a version that is not in the pinned matrix.
 * @param {object} options - platform, minecraftVersion, optional fetchImpl/cache.
 * @returns {Promise<object>} `{ templateDir, javaVersion, coords, resolution, unverified, sources }`.
 */
export async function resolveDynamic(options) {
  const { platform, minecraftVersion } = options
  if (!DYNAMIC_PLATFORMS.includes(platform)) {
    throw new Error(`dynamic resolution covers ${DYNAMIC_PLATFORMS.join('/')}; ${platform} versions stay pinned`)
  }
  const mc = String(minecraftVersion).replace(/\.x$/i, '')
  const javaVersion = javaVersionFor(mc)
  const fetchText = createFetcher(options)
  const sources = []

  if (platform === 'paper') {
    const xml = await fetchText('https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml', `paper-api`)
    sources.push(SOURCES.paper)
    const versions = parseMavenVersions(xml)
    const wanted = `${mc}-R0.1-SNAPSHOT`
    const ranged = Number(mc.split('.')[0]) >= 26
    const found = ranged
      ? versions.some(version => version.startsWith(`${mc}.build.`))
      : versions.includes(wanted)
    if (!found) {
      throw new Error(`Paper publishes no paper-api for Minecraft ${mc} (checked ${SOURCES.paper})`)
    }
    return {
      templateDir: paperTemplate(mc),
      javaVersion,
      coords: { paperApiVersion: ranged ? `${mc}.build.+` : wanted, gradleVersion: gradleVersionFor('paper', mc) },
      resolution: 'dynamic',
      unverified: true,
      sources,
    }
  }

  if (platform === 'fabric') {
    const loaderJson = await fetchText(`https://meta.fabricmc.net/v2/versions/loader/${mc}`, `fabric-loader-${mc}`)
    const yarnJson = await fetchText(`https://meta.fabricmc.net/v2/versions/yarn/${mc}`, `fabric-yarn-${mc}`)
    const apiJson = await fetchText(`https://api.modrinth.com/v2/project/fabric-api/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}`, `fabric-api-${mc}`)
    sources.push(SOURCES.fabricLoader, SOURCES.fabricYarn, SOURCES.fabricApi)
    const loader = parseFabricLoader(JSON.parse(loaderJson))[0]
    const yarn = parseFabricYarn(JSON.parse(yarnJson))[0]
    const fabricApiVersion = parseModrinthFabricApi(JSON.parse(apiJson))
    if (!loader) throw new Error(`Fabric publishes no loader for Minecraft ${mc} (${SOURCES.fabricLoader})`)
    if (!fabricApiVersion) throw new Error(`Fabric API has no release for Minecraft ${mc} (${SOURCES.fabricApi})`)
    return {
      templateDir: fabricTemplate(mc),
      javaVersion,
      coords: {
        gradleVersion: gradleVersionFor('fabric', mc),
        loomVersion: loomVersionFor(mc),
        loaderVersion: loader,
        ...(yarn ? { yarnVersion: yarn } : {}),
        fabricApiVersion,
      },
      resolution: 'dynamic',
      unverified: true,
      sources,
    }
  }

  // neoforge
  const { series, legacy } = neoSeriesFor(mc)
  if (legacy) throw new Error('NeoForge 1.20.1 is a pinned legacyforge line; use the pinned entry')
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', 'neoforge')
  sources.push(SOURCES.neoforge)
  const neoVersion = pickNeoForge(parseMavenVersions(xml), series)
  if (!neoVersion) throw new Error(`NeoForge publishes no build in the ${series}x series (${SOURCES.neoforge})`)
  return {
    templateDir: neoTemplateFor(mc),
    javaVersion,
    coords: {
      gradleVersion: gradleVersionFor('neoforge', mc),
      moddevVersion: '2.0.147',
      moddevPlugin: 'net.neoforged.moddev',
      neoVersion,
    },
    resolution: 'dynamic',
    unverified: true,
    sources,
  }
}
