import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DYNAMIC_PLATFORMS,
  fabricTemplate,
  gradleVersionFor,
  javaVersionFor,
  loomVersionFor,
  neoSeriesFor,
  neoTemplateFor,
  parseFabricLoader,
  parseFabricYarn,
  parseMavenVersions,
  parseModrinthFabricApi,
  pickNeoForge,
  paperTemplate,
  resolveDynamic,
} from '../lib/dynamic-versions.js'

const MAVEN = `<?xml version="1.0"?><metadata><versioning><versions>
  <version>1.21.1-R0.1-SNAPSHOT</version>
  <version>1.21.4-R0.1-SNAPSHOT</version>
  <version>26.2.build.130-stable</version>
</versions></versioning></metadata>`

const NEO_MAVEN = `<?xml version="1.0"?><metadata><versioning><versions>
  <version>21.4.99-beta</version>
  <version>21.4.100</version>
  <version>21.4.101</version>
  <version>21.1.249</version>
  <version>26.3.0.12-beta</version>
</versions></versioning></metadata>`

const FABRIC_LOADER = JSON.stringify([{ loader: { version: '0.19.5' } }])
const FABRIC_YARN = JSON.stringify([{ version: '1.21.4+build.8' }])
const MODRINTH_API = JSON.stringify([{ version_number: '0.119.4+1.21.4', game_versions: ['1.21.4'] }])

/** Fake fetch that answers by URL substring. */
function fakeFetch(routes) {
  return async url => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        return { ok: true, status: 200, text: async () => body }
      }
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }
}

test('the Java level follows the era boundaries the pinned matrix documents', () => {
  assert.equal(javaVersionFor('1.18.2'), 17)
  assert.equal(javaVersionFor('1.20.4'), 17)
  assert.equal(javaVersionFor('1.20.5'), 21)
  assert.equal(javaVersionFor('1.21.8'), 21)
  assert.equal(javaVersionFor('26.2'), 25)
  assert.throws(() => javaVersionFor('1.16.5'), /no dynamic support/)
})

test('the template and builder versions follow the generation', () => {
  assert.equal(paperTemplate('1.21.4'), 'paper')
  assert.equal(fabricTemplate('1.21.4'), 'fabric')
  assert.equal(fabricTemplate('26.3'), 'fabric-26')
  assert.equal(loomVersionFor('1.21.4'), '1.17.19')
  assert.equal(loomVersionFor('26.3'), '1.17.21')
  assert.equal(gradleVersionFor('fabric', '1.21.4'), '9.5.1')
})

test('NeoForge series and template follow the Minecraft version', () => {
  assert.deepEqual(neoSeriesFor('1.21.4'), { series: '21.4.', legacy: false })
  assert.deepEqual(neoSeriesFor('1.21.1'), { series: '21.1.', legacy: false })
  assert.deepEqual(neoSeriesFor('26.3'), { series: '26.3.', legacy: false })
  assert.deepEqual(neoSeriesFor('1.20.1'), { series: '', legacy: true })
  assert.equal(neoTemplateFor('1.20.1'), 'neoforge-1.20.1')
  assert.equal(neoTemplateFor('1.21.1'), 'neoforge-1.21.1')
  assert.equal(neoTemplateFor('1.21.4'), 'neoforge')
  assert.equal(neoTemplateFor('26.3'), 'neoforge-26')
})

test('the metadata parsers read the documents the loaders publish', () => {
  assert.deepEqual(parseMavenVersions(MAVEN).slice(0, 2), ['1.21.1-R0.1-SNAPSHOT', '1.21.4-R0.1-SNAPSHOT'])
  assert.deepEqual(parseFabricLoader(JSON.parse(FABRIC_LOADER)), ['0.19.5'])
  assert.deepEqual(parseFabricYarn(JSON.parse(FABRIC_YARN)), ['1.21.4+build.8'])
  assert.equal(parseModrinthFabricApi(JSON.parse(MODRINTH_API)), '0.119.4+1.21.4')
  assert.equal(parseModrinthFabricApi([]), undefined)
})

test('the NeoForge pick prefers a stable build and falls back to a pre-release series', () => {
  const versions = parseMavenVersions(NEO_MAVEN)
  assert.equal(pickNeoForge(versions, '21.4.'), '21.4.101')
  assert.equal(pickNeoForge(versions, '21.1.'), '21.1.249')
  assert.equal(pickNeoForge(versions, '26.3.'), '26.3.0.12-beta', '26.3 ships -beta only')
  assert.equal(pickNeoForge(versions, '9.9.'), undefined)
})

test('Paper resolves any published paper-api version and refuses an unpublished one', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'mcdev-dyn-'))
  try {
    const fetchImpl = fakeFetch({ 'paper-api/maven-metadata.xml': MAVEN })
    const paper = await resolveDynamic({ platform: 'paper', minecraftVersion: '1.21.4', fetchImpl, cacheDir, cacheTtlMs: 0 })
    assert.equal(paper.resolution, 'dynamic')
    assert.equal(paper.unverified, true)
    assert.equal(paper.javaVersion, 21)
    assert.equal(paper.coords.paperApiVersion, '1.21.4-R0.1-SNAPSHOT')
    assert.ok(paper.sources.length > 0)

    await assert.rejects(
      () => resolveDynamic({ platform: 'paper', minecraftVersion: '1.19.4', fetchImpl, cacheDir, cacheTtlMs: 0 }),
      /no paper-api for Minecraft 1\.19\.4/,
    )
  } finally { rmSync(cacheDir, { recursive: true, force: true }) }
})

test('Fabric resolves loader, yarn and the API build for the version', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'mcdev-dyn-'))
  try {
    const fetchImpl = fakeFetch({
      '/versions/loader/': FABRIC_LOADER,
      '/versions/yarn/': FABRIC_YARN,
      'api.modrinth.com': MODRINTH_API,
    })
    const fabric = await resolveDynamic({ platform: 'fabric', minecraftVersion: '1.21.4', fetchImpl, cacheDir, cacheTtlMs: 0 })
    assert.equal(fabric.templateDir, 'fabric')
    assert.equal(fabric.coords.loaderVersion, '0.19.5')
    assert.equal(fabric.coords.yarnVersion, '1.21.4+build.8')
    assert.equal(fabric.coords.fabricApiVersion, '0.119.4+1.21.4')
    assert.equal(fabric.coords.loomVersion, '1.17.19')
  } finally { rmSync(cacheDir, { recursive: true, force: true }) }
})

test('NeoForge resolves the newest build in the requested series', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'mcdev-dyn-'))
  try {
    const fetchImpl = fakeFetch({ 'neoforge/maven-metadata.xml': NEO_MAVEN })
    const neo = await resolveDynamic({ platform: 'neoforge', minecraftVersion: '1.21.4', fetchImpl, cacheDir, cacheTtlMs: 0 })
    assert.equal(neo.templateDir, 'neoforge')
    assert.equal(neo.coords.neoVersion, '21.4.101')
    assert.equal(neo.coords.moddevPlugin, 'net.neoforged.moddev')
    await assert.rejects(
      () => resolveDynamic({ platform: 'neoforge', minecraftVersion: '1.20.1', fetchImpl, cacheDir, cacheTtlMs: 0 }),
      /pinned legacyforge line/,
    )
  } finally { rmSync(cacheDir, { recursive: true, force: true }) }
})

test('dynamic resolution covers exactly Paper, Fabric and NeoForge', () => {
  assert.deepEqual([...DYNAMIC_PLATFORMS].sort(), ['fabric', 'neoforge', 'paper'])
  return assert.rejects(
    () => resolveDynamic({ platform: 'spigot', minecraftVersion: '1.21.4', fetchImpl: fakeFetch({}) }),
    /stay pinned/,
  )
})
