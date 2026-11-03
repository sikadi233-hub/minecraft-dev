import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossValidate, emptyManifest, isDeniedFile, normalizeManifest, validateManifest } from '../lib/arbitration/manifest.js'

function validManifest(overrides = {}) {
  return {
    ...emptyManifest('storage-shard'),
    packageScope: 'com.example.plugin.shard.storage',
    ownedFiles: ['src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java'],
    mavenDependencies: [{ group: 'com.zaxxer', name: 'HikariCP', version: '5.1.0', scope: 'compile' }],
    lifecycleHooks: { onEnablePriority: 10, initStatements: ['this.homes = new SqlHomeStore(this);'], onDisableStatements: [] },
    bukkitRegistrations: {
      listeners: ['com.example.plugin.shard.storage.StorageListener'],
      commands: [{ name: 'home', class: 'com.example.plugin.shard.storage.HomeCommand', permission: 'example.home.use' }],
      permissions: [{ node: 'example.home.use', default: 'true' }],
    },
    configDefaults: { 'database.pool-size': 10 },
    ...overrides,
  }
}

test('a well-formed manifest validates and picks up defaults', () => {
  const verdict = validateManifest(validManifest())
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors))
  const value = verdict.value
  assert.equal(value.version, 1)
  assert.equal(value.mavenDependencies[0].scope, 'compile')
  assert.equal(value.lifecycleHooks.onEnablePriority, 10)
  assert.deepEqual(value.ownedFiles, ['src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java'])
})

test('owned files must stay inside packageScope', () => {
  const verdict = validateManifest(validManifest({ ownedFiles: ['src/main/java/com/example/plugin/shard/gui/Panel.java'] }))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.errors.some(error => /outside packageScope/.test(error.message)), JSON.stringify(verdict.errors))
})

test('shards may not own the shared files', () => {
  for (const file of [
    'src/main/resources/plugin.yml',
    'build.gradle',
    'build.gradle.kts',
    'src/main/resources/fabric.mod.json',
  ]) {
    assert.equal(isDeniedFile(file), true, `${file} must be denied`)
    const verdict = validateManifest(validManifest({ ownedFiles: [file] }))
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some(error => /shared file/.test(error.message)), `${file}: ${JSON.stringify(verdict.errors)}`)
  }
})

test('the schema rejects typos, bad scopes, multiline statements, and contract mismatches', () => {
  const unknown = validateManifest(validManifest({ extraKey: true }))
  assert.ok(unknown.errors.some(error => /unknown manifest key/.test(error.message)))

  const badScope = validateManifest(validManifest({ mavenDependencies: [{ group: 'g', name: 'n', version: '1', scope: 'provided' }] }))
  assert.ok(badScope.errors.some(error => /scope must be one of/.test(error.message)))

  const multiline = validateManifest(validManifest({ lifecycleHooks: { onEnablePriority: 50, initStatements: ['a();\nb();'] } }))
  assert.ok(multiline.errors.some(error => /one line/.test(error.message)))

  const badId = validateManifest(validManifest({ shardId: 'Storage' }))
  assert.ok(badId.errors.some(error => /kebab-case/.test(error.message)))

  const contract = { modules: [{ id: 'gui' }] }
  const mismatch = validateManifest(validManifest(), { contract })
  assert.ok(mismatch.errors.some(error => /not part of the frozen contract/.test(error.message)))
})

test('cross-shard ownership overlap is reported, never silently merged', () => {
  const a = normalizeManifest(validManifest({ shardId: 'storage-shard' }))
  const b = normalizeManifest(validManifest({ shardId: 'other-shard' }))
  const conflicts = crossValidate([{ shardId: 'storage-shard', manifest: a }, { shardId: 'other-shard', manifest: b }])
  assert.equal(conflicts.ownedFiles.length, 1)
  assert.deepEqual(conflicts.ownedFiles[0].shards, ['storage-shard', 'other-shard'])
  assert.equal(conflicts.commands.length, 1)
  assert.equal(conflicts.commands[0].name, 'home')
})

test('conflicting permission defaults are a conflict; identical ones are not', () => {
  const first = normalizeManifest(validManifest({ shardId: 'storage-shard' }))
  const sameDefault = normalizeManifest(validManifest({ shardId: 'gui-shard', ownedFiles: ['src/main/java/com/example/plugin/shard/storage/Gui.java'], bukkitRegistrations: { listeners: [], commands: [], permissions: [{ node: 'example.home.use', default: 'true' }] } }))
  assert.equal(crossValidate([{ shardId: 'storage-shard', manifest: first }, { shardId: 'gui-shard', manifest: sameDefault }]).permissions.length, 0)

  const differing = normalizeManifest(validManifest({ shardId: 'gui-shard', ownedFiles: ['src/main/java/com/example/plugin/shard/storage/Gui.java'], bukkitRegistrations: { listeners: [], commands: [], permissions: [{ node: 'example.home.use', default: 'op' }] } }))
  const conflicts = crossValidate([{ shardId: 'storage-shard', manifest: first }, { shardId: 'gui-shard', manifest: differing }])
  assert.equal(conflicts.permissions.length, 1)
  assert.deepEqual(conflicts.permissions[0].defaults, ['true', 'op'])
})
