import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldProject } from '../lib/scaffold.js'

/**
 * Integration of the dynamic path with the real template files: the resolved
 * coordinates must land in the project, and a failure must never silently fall
 * back to a project for a different Minecraft version.
 */

const FABRIC_LOADER = JSON.stringify([{ loader: { version: '0.16.10' } }])
const FABRIC_YARN = JSON.stringify([{ version: '1.21.4+build.8' }])
const MODRINTH_API = JSON.stringify([{ version_number: '0.119.4+1.21.4', game_versions: ['1.21.4'] }])

function fakeFetch(routes) {
  return async url => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) return { ok: true, status: 200, text: async () => body }
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-scaffold-dyn-'))
  return { root, target: join(root, 'Demo'), cacheDir: join(root, 'cache') }
}

test('an unpinned Fabric version resolves its coordinates into the project', async () => {
  const { root, target, cacheDir } = workspace()
  try {
    const result = await scaffoldProject({
      platform: 'fabric',
      minecraftVersion: '1.21.4',
      targetDir: target,
      name: 'demo-mod',
      packageName: 'com.example.demo',
      fetchImpl: fakeFetch({ '/versions/loader/': FABRIC_LOADER, '/versions/yarn/': FABRIC_YARN, 'api.modrinth.com': MODRINTH_API }),
      cacheDir,
      cacheTtlMs: 0,
    })
    assert.equal(result.resolution, 'dynamic')
    assert.equal(result.unverified, true)
    assert.ok(result.sources.length >= 2)
    const properties = readFileSync(join(target, 'gradle.properties'), 'utf8')
    assert.match(properties, /minecraft_version=1\.21\.4/)
    assert.match(properties, /loader_version=0\.16\.10/)
    assert.match(properties, /fabric_api_version=0\.119\.4\+1\.21\.4/)
    assert.match(properties, /loom_version=1\.17\.19/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Paper keeps generating with a lenient coordinate when the check cannot run, and says so', async () => {
  const { root, target, cacheDir } = workspace()
  try {
    const result = await scaffoldProject({
      platform: 'paper',
      minecraftVersion: '1.20.4',
      targetDir: target,
      name: 'demo-plugin',
      packageName: 'com.example.demo',
      fetchImpl: fakeFetch({}),
      cacheDir,
      cacheTtlMs: 0,
    })
    assert.equal(result.resolution, 'pinned-lenient')
    assert.equal(result.unverified, true)
    assert.match(result.note, /dynamic check failed/)
    const build = readFileSync(join(target, 'build.gradle.kts'), 'utf8')
    assert.match(build, /paper-api:1\.20\.4-R0\.1-SNAPSHOT/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a Fabric version the metadata cannot confirm fails instead of borrowing a line', async () => {
  const { root, target, cacheDir } = workspace()
  try {
    await assert.rejects(
      () => scaffoldProject({
        platform: 'fabric',
        minecraftVersion: '1.21.4',
        targetDir: target,
        name: 'demo-mod',
        packageName: 'com.example.demo',
        fetchImpl: fakeFetch({}),
        cacheDir,
        cacheTtlMs: 0,
      }),
      /could not fetch|no loader|no release/,
    )
    assert.equal(existsSync(target), false, 'a failed resolution must not leave a project behind')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
