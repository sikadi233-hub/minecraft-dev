import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mergeProject, findEntryFile, injectStatements, mergeJsonMetadata } from '../lib/arbitration/merge.js'
import { dialectOf, injectDependencies, hasDependencyAnchor } from '../lib/arbitration/parse-gradle.js'
import { hasPluginYmlAnchors, mergePluginYml } from '../lib/arbitration/parse-plugin-yml.js'

/** Write a project file, creating parents. */
function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

const PLUGIN_JAVA = `package com.example.plugin;

import org.bukkit.plugin.java.JavaPlugin;

public final class MyPlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("MyPlugin enabled");
        // [mc:init]
    }

    @Override
    public void onDisable() {
        getLogger().info("MyPlugin disabled");
        // [mc:shutdown]
    }
}
`

const PLUGIN_YML = `name: my-plugin
version: \${version}
main: com.example.plugin.MyPlugin
api-version: "1.21"

# [mc:commands]
# [mc:permissions]
`

const BUILD_GRADLE = `plugins {
    id 'java-library'
}

dependencies {
    compileOnly 'io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT'
    // [mc:dependencies]
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}
`

const BUILD_GRADLE_KTS = `plugins {
    \`java-library\`
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT")
    // [mc:dependencies]
}
`

/** A temp paper project plus its frozen contract and shard manifests. */
function paperProject({ buildFile = 'build.gradle', buildScript = BUILD_GRADLE, pluginYml = PLUGIN_YML, modules = ['storage-shard', 'gui-shard'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-merge-'))
  write(root, buildFile, buildScript)
  write(root, 'src/main/resources/plugin.yml', pluginYml)
  write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA)
  write(root, '.mcdev/contract/contract.json', JSON.stringify({
    version: 1,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    javaVersion: 21,
    packageName: 'com.example.plugin',
    modules: modules.map(id => ({ id })),
  }, null, 2))
  return root
}

/** Write one shard manifest (already valid shape). */
function shard(root, id, overrides = {}) {
  const manifest = {
    version: 1,
    shardId: id,
    packageScope: `com.example.plugin.shard.${id.replace(/-shard$/, '')}`,
    ownedFiles: [`src/main/java/com/example/plugin/shard/${id.replace(/-shard$/, '')}/Impl.java`],
    mavenDependencies: [{ group: 'com.zaxxer', name: 'HikariCP', version: '5.1.0', scope: 'compile' }],
    lifecycleHooks: { onEnablePriority: 10, initStatements: [`this.${id.replace(/-/g, '_')} = 1;`], onDisableStatements: [] },
    bukkitRegistrations: {
      listeners: [`com.example.plugin.shard.${id.replace(/-shard$/, '')}.Listener`],
      commands: [{ name: id.replace(/-shard$/, ''), class: `com.example.plugin.shard.${id.replace(/-shard$/, '')}.Cmd` }],
      permissions: [{ node: `example.${id.replace(/-shard$/, '')}`, default: 'op' }],
    },
    configDefaults: {},
    ...overrides,
  }
  write(root, `.mcdev/shards/${id}/RegistrationManifest.json`, JSON.stringify(manifest, null, 2))
}

test('dependency injection understands both Groovy and Kotlin dialects', () => {
  const groovy = injectDependencies({ content: BUILD_GRADLE, dialect: dialectOf('build.gradle'), dependencies: [{ group: 'g', name: 'n', version: '1.0', scope: 'compile' }] })
  assert.equal(groovy.anchor, true)
  assert.match(groovy.content, /    implementation 'g:n:1\.0'/)
  assert.deepEqual(groovy.inserted, ['g:n:1.0'])

  const kotlin = injectDependencies({ content: BUILD_GRADLE_KTS, dialect: dialectOf('build.gradle.kts'), dependencies: [{ group: 'g', name: 'n', version: '1.0', scope: 'compileOnly' }] })
  assert.match(kotlin.content, /    compileOnly\("g:n:1\.0"\)/)
})

test('injected coordinates are deduplicated against the script itself', () => {
  const result = injectDependencies({
    content: BUILD_GRADLE,
    dialect: 'groovy',
    dependencies: [
      { group: 'io.papermc.paper', name: 'paper-api', version: '1.21.8-R0.1-SNAPSHOT', scope: 'compileOnly' },
      { group: 'com.zaxxer', name: 'HikariCP', version: '5.1.0', scope: 'compile' },
    ],
  })
  assert.deepEqual(result.inserted, ['com.zaxxer:HikariCP:5.1.0'])
  assert.deepEqual(result.skipped, ['io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT'])
})

test('a script without the anchor is reported, never rewritten', () => {
  const content = 'dependencies {\n    compileOnly "x:y:1"\n}\n'
  assert.equal(hasDependencyAnchor(content), false)
  const result = injectDependencies({ content, dialect: 'groovy', dependencies: [{ group: 'g', name: 'n', version: '1' }] })
  assert.equal(result.anchor, false)
  assert.equal(result.content, content)
})

test('plugin.yml commands and permissions are generated between their anchors', () => {
  const result = mergePluginYml({
    content: PLUGIN_YML,
    commands: [{ name: 'home', permission: 'example.home.use' }, { name: 'gui' }],
    permissions: [{ node: 'example.home.use', default: 'true' }],
  })
  assert.deepEqual(result.missing, [])
  assert.match(result.content, /commands:\n {2}gui:\n {4}description:.*\n {4}usage: "\/gui"/)
  assert.match(result.content, / {2}home:\n {4}description:.*\n {4}usage: "\/home"\n {4}permission: example\.home\.use/)
  assert.match(result.content, /permissions:\n {2}example\.home\.use:\n {4}description:.*\n {4}default: true/)
  assert.match(result.content, /# \[mc:commands\]/, 'the anchor survives for the next merge')
  assert.equal(hasPluginYmlAnchors(result.content), true)
})

test('plugin.yml without anchors is reported as missing', () => {
  const result = mergePluginYml({ content: 'name: x\nmain: a.b\n', commands: [{ name: 'home' }] })
  assert.deepEqual(result.missing, ['commands', 'permissions'])
  assert.equal(result.content, 'name: x\nmain: a.b\n')
})

test('the entry class is discovered by its platform idiom', () => {
  const root = paperProject()
  try {
    assert.equal(findEntryFile(root, 'paper'), 'src/main/java/com/example/plugin/MyPlugin.java')
    assert.equal(findEntryFile(root, 'fabric'), undefined, 'a JavaPlugin class is not a Fabric entrypoint')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lifecycle statements are ordered by priority and teardown runs in reverse', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard', { lifecycleHooks: { onEnablePriority: 20, initStatements: ['this.storage = 2;'], onDisableStatements: ['this.storage = null;'] } })
    shard(root, 'gui-shard', { lifecycleHooks: { onEnablePriority: 10, initStatements: ['this.gui = 1;'], onDisableStatements: ['this.gui = null;'] } })
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.ok(java.indexOf('this.gui = 1;') < java.indexOf('this.storage = 2;'), 'lower priority initializes first')
    assert.ok(java.indexOf('this.storage = null;') < java.indexOf('this.gui = null;'), 'teardown is reversed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('JSON mod metadata merges structurally', () => {
  const merged = mergeJsonMetadata(
    { entrypoints: { main: ['a.B'] }, depends: { fabricloader: '>=0.19' } },
    { entrypoints: { main: ['c.D'] }, depends: { minecraft: '>=26.3' } },
  )
  assert.deepEqual(merged.entrypoints.main, ['a.B', 'c.D'])
  assert.equal(merged.depends.minecraft, '>=26.3')
  assert.equal(merged.depends.fabricloader, '>=0.19')
})

test('ownership overlap aborts the merge before anything is written', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard')
    shard(root, 'gui-shard', {
      ownedFiles: ['src/main/java/com/example/plugin/shard/storage/Impl.java'],
      packageScope: 'com.example.plugin.shard.storage',
    })
    const before = readFileSync(join(root, 'build.gradle'), 'utf8')
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, false)
    assert.equal(result.aborted, 'ownership-conflict')
    assert.equal(result.written.length, 0)
    assert.equal(readFileSync(join(root, 'build.gradle'), 'utf8'), before, 'the build script must be untouched')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dryRun plans the writes without touching the project', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard')
    shard(root, 'gui-shard')
    const before = readFileSync(join(root, 'build.gradle'), 'utf8')
    const result = mergeProject({ projectDir: root, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.ok(result.planned.includes('build.gradle'))
    assert.ok(result.planned.includes('src/main/resources/plugin.yml'))
    assert.equal(readFileSync(join(root, 'build.gradle'), 'utf8'), before)
    assert.equal(existsSync(join(root, '.mcdev', 'reports', 'merge-report.md')), false, 'dryRun writes no report')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a real merge writes the three shared files and the report', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard')
    shard(root, 'gui-shard')
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, true, JSON.stringify({ errors: result.errors, conflicts: result.conflicts }))
    const build = readFileSync(join(root, 'build.gradle'), 'utf8')
    assert.match(build, /implementation 'com\.zaxxer:HikariCP:5\.1\.0'/)
    const yml = readFileSync(join(root, 'src', 'main', 'resources', 'plugin.yml'), 'utf8')
    // Command names come from the shard id: storage-shard -> storage.
    assert.match(yml, /commands:\n {2}gui:\n {4}description:/)
    assert.match(yml, / {2}storage:\n {4}description:.*\n {4}usage: "\/storage"/)
    assert.match(yml, /permissions:\n {2}example\.gui:/)
    assert.ok(existsSync(join(root, '.mcdev', 'reports', 'merge-report.md')))
    assert.match(readFileSync(join(root, '.mcdev', 'reports', 'merge-report.md'), 'utf8'), /files written: 3/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an invalid manifest is an error, not a silent skip', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard', { packageScope: 'not a package' })
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.error === 'invalid-manifest'), JSON.stringify(result.errors))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('injectStatements reports a missing anchor instead of appending blindly', () => {
  const result = injectStatements({ content: 'class X {\n}\n', anchor: '// [mc:init]', statements: ['a();'] })
  assert.equal(result.found, false)
  assert.equal(result.inserted, 0)
})


test('main-class fields are injected once at the fields anchor, deduplicated by name', () => {
  const root = paperProject()
  try {
    write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA.replace('public final class MyPlugin extends JavaPlugin {', 'public final class MyPlugin extends JavaPlugin {\n    // [mc:fields]'))
    shard(root, 'storage-shard', { mainClassFields: [{ type: 'StorageService', name: 'storage' }] })
    shard(root, 'gui-shard', { mainClassFields: [{ type: 'StorageService', name: 'storage' }, { type: 'GuiService', name: 'gui' }] })
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.equal((java.match(/private StorageService storage;/g) ?? []).length, 1, 'the duplicate field must appear once')
    assert.match(java, /private GuiService gui;/)
    assert.ok(result.written.some(item => item.action === 'fields' && item.count === 2))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a field the host already declared is not declared twice', () => {
  const root = paperProject()
  try {
    write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA
      .replace('public final class MyPlugin extends JavaPlugin {', 'public final class MyPlugin extends JavaPlugin {\n    // [mc:fields]\n    private StorageService storage;'))
    shard(root, 'storage-shard', { mainClassFields: [{ type: 'StorageService', name: 'storage' }] })
    mergeProject({ projectDir: root })
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.equal((java.match(/private StorageService storage;/g) ?? []).length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('a simple field type is resolved against the contract package and imported', () => {
  const root = paperProject()
  try {
    const contractPath = join(root, '.mcdev/contract/contract.json')
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
    contract.packageName = 'com.example.plugin.contract'
    contract.symbols = [{ kind: 'interface', fqn: 'com.example.plugin.contract.StorageService' }]
    writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf8')
    write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA.replace('public final class MyPlugin extends JavaPlugin {', 'public final class MyPlugin extends JavaPlugin {\n    // [mc:fields]'))
    shard(root, 'storage-shard', { mainClassFields: [{ type: 'StorageService', name: 'storage' }] })
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.match(java, /^import com\.example\.plugin\.contract\.StorageService;$/m, 'the field type must be imported')
    assert.match(java, /private StorageService storage;/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('merging twice does not duplicate lifecycle statements', () => {
  const root = paperProject()
  try {
    shard(root, 'storage-shard')
    const first = mergeProject({ projectDir: root })
    assert.ok(first.written.some(item => item.action === 'lifecycle'))
    const second = mergeProject({ projectDir: root })
    assert.equal(second.written.length, 0, 'the second merge has nothing left to write')
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.equal((java.match(/this\.storage_shard = 1;/g) ?? []).length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a fields injection does not discard the lifecycle injection of the same merge', () => {
  const root = paperProject()
  try {
    write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA.replace('public final class MyPlugin extends JavaPlugin {', 'public final class MyPlugin extends JavaPlugin {\n    // [mc:fields]'))
    shard(root, 'storage-shard', { mainClassFields: [{ type: 'StorageService', name: 'storage' }] })
    const result = mergeProject({ projectDir: root })
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    const java = readFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'plugin', 'MyPlugin.java'), 'utf8')
    assert.match(java, /private StorageService storage;/, 'the field is injected')
    assert.match(java, /this\.storage_shard = 1;/, 'the fields write must not erase the injected lifecycle statement')
    assert.match(java, /private StorageService storage;[\s\S]*this\.storage_shard = 1;/, 'both live in the same merge result')
    const second = mergeProject({ projectDir: root })
    assert.equal(second.written.length, 0, 'the second merge has nothing left to write')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
