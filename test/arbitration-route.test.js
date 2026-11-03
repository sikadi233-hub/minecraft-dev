import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadOwnership, normalizePath, parseCompileErrors, renderFixBrief, routeCompileLog, routeErrors } from '../lib/arbitration/route.js'

function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

/** A project with a contract and two shards that own one file each. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-route-'))
  write(root, '.mcdev/contract/contract.json', JSON.stringify({
    version: 1,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    javaVersion: 21,
    packageName: 'com.example.plugin',
    modules: [{ id: 'storage-shard' }, { id: 'gui-shard' }],
  }, null, 2))
  const manifest = (id, scope, file) => JSON.stringify({
    version: 1,
    shardId: id,
    packageScope: scope,
    ownedFiles: [file],
    mavenDependencies: [],
    lifecycleHooks: { onEnablePriority: 10, initStatements: [], onDisableStatements: [] },
    bukkitRegistrations: { listeners: [], commands: [], permissions: [] },
    configDefaults: {},
  }, null, 2)
  write(root, '.mcdev/shards/storage-shard/RegistrationManifest.json', manifest('storage-shard', 'com.example.plugin.shard.storage', 'src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java'))
  write(root, '.mcdev/shards/gui-shard/RegistrationManifest.json', manifest('gui-shard', 'com.example.plugin.shard.gui', 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java'))
  return root
}

test('javac lines parse with and without a column, and Windows paths normalize', () => {
  const log = [
    '> Task :compileJava FAILED',
    'C:\\proj\\src\\main\\java\\com\\example\\plugin\\shard\\gui\\GuiPanel.java:57: error: cannot find symbol',
    '        panel.open();',
    '        ^',
    '  symbol:   method open()',
    'src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java:12:5: error: incompatible types',
    '2 errors',
  ].join('\n')
  const { errors, unparsed } = parseCompileErrors(log, 'C:\\proj')
  assert.equal(errors.length, 2, JSON.stringify(errors))
  assert.equal(errors[0].file, 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java')
  assert.equal(errors[0].line, 57)
  assert.match(errors[0].message, /cannot find symbol/)
  assert.equal(errors[1].column, 5)
  assert.ok(unparsed.some(line => /BUILD FAILED|\berror\b/.test(line)) === false, 'success lines are not unparsed noise')
})

test('paths outside the project still reduce to src/main when possible', () => {
  assert.equal(normalizePath('/home/ci/build/src/main/java/a/B.java', '/other'), 'src/main/java/a/B.java')
  assert.equal(normalizePath('C:\\proj\\src\\main\\java\\a\\B.java', 'C:\\proj'), 'src/main/java/a/B.java')
})

test('errors route to the shard that owns the file', () => {
  const root = project()
  try {
    const { byFile } = loadOwnership(root)
    assert.equal(byFile.get('src/main/java/com/example/plugin/shard/gui/GuiPanel.java'), 'gui-shard')
    const result = routeErrors({
      projectDir: root,
      errors: [
        { file: 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java', line: 57, message: 'cannot find symbol', symbol: 'open' },
        { file: 'src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java', line: 12, message: 'incompatible types' },
      ],
    })
    assert.equal(result.routes.length, 2)
    assert.deepEqual(result.routes.map(route => route.shard).sort(), ['gui-shard', 'storage-shard'])
    assert.equal(result.unowned.length, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a file inside a shard package but not listed still routes by scope', () => {
  const root = project()
  try {
    const result = routeErrors({
      projectDir: root,
      errors: [{ file: 'src/main/java/com/example/plugin/shard/gui/extra/Unlisted.java', line: 3, message: 'error: x' }],
    })
    assert.equal(result.routes.length, 1)
    assert.equal(result.routes[0].shard, 'gui-shard')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('errors outside every shard are reported as unowned', () => {
  const root = project()
  try {
    const result = routeErrors({
      projectDir: root,
      errors: [
        { file: 'src/main/java/com/example/plugin/MyPlugin.java', line: 5, message: 'cannot find symbol' },
        { file: 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java', line: 9, message: 'incompatible types' },
      ],
    })
    assert.equal(result.unowned.length, 1)
    assert.equal(result.unowned[0].file, 'src/main/java/com/example/plugin/MyPlugin.java')
    assert.equal(result.routes[0].shard, 'gui-shard')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('one missing symbol across most shards is a contract collapse, not N fixes', () => {
  const root = project()
  try {
    const result = routeErrors({
      projectDir: root,
      errors: [
        { file: 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java', line: 9, message: 'cannot find symbol', symbol: 'HomeService' },
        { file: 'src/main/java/com/example/plugin/shard/storage/SqlHomeStore.java', line: 14, message: 'cannot find symbol', symbol: 'HomeService' },
      ],
    })
    assert.ok(result.contractCollapse, JSON.stringify(result))
    assert.equal(result.contractCollapse.symbol, 'HomeService')
    assert.equal(result.contractCollapse.ratio, 1)
    assert.deepEqual(result.contractCollapse.shards, ['gui-shard', 'storage-shard'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the fix brief names the files and forbids touching the contract', () => {
  const brief = renderFixBrief('gui-shard', [{ file: 'src/main/java/a/B.java', line: 7, message: 'cannot find symbol', symbol: 'open' }])
  assert.match(brief, /# Fix brief for gui-shard/)
  assert.match(brief, /B\.java:7 \(missing symbol open\)/)
  assert.match(brief, /do not change the frozen contract/)
})

test('routeCompileLog writes a compile-routes.json into the affected shard', () => {
  const root = project()
  try {
    const log = 'src/main/java/com/example/plugin/shard/gui/GuiPanel.java:57: error: cannot find symbol'
    const result = routeCompileLog({ projectDir: root, compileLog: log, write: true })
    assert.equal(result.routes.length, 1)
    const target = join(root, '.mcdev', 'shards', 'gui-shard', 'compile-routes.json')
    assert.ok(existsSync(target))
    const parsed = JSON.parse(readFileSync(target, 'utf8'))
    assert.equal(parsed.shard, 'gui-shard')
    assert.equal(parsed.errors[0].line, 57)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('an error inside an injected statement is attributed to its shard', () => {
  const root = project()
  try {
    const entry = 'src/main/java/com/example/plugin/MyPlugin.java'
    mkdirSync(dirname(join(root, ...entry.split('/'))), { recursive: true })
    writeFileSync(join(root, ...entry.split('/')), [
      'package com.example.plugin;',
      'public final class MyPlugin extends JavaPlugin {',
      '    public void onEnable() {',
      '        this.storage.init(getDataFolder());',
      '    }',
      '}',
    ].join('\n'), 'utf8')
    const manifestPath = join(root, '.mcdev/shards/storage-shard/RegistrationManifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.lifecycleHooks.initStatements = ['this.storage.init(getDataFolder());']
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const result = routeErrors({
      projectDir: root,
      errors: [{ file: entry, line: 4, message: 'unreported exception Exception; must be caught or declared' }],
    })
    assert.equal(result.unowned.length, 0, JSON.stringify(result.unowned))
    assert.equal(result.routes.length, 1)
    assert.equal(result.routes[0].shard, 'storage-shard')
    assert.equal(result.routes[0].errors[0].origin, 'injected-statement')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
