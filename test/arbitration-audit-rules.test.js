import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RULES, auditProject, collectDeclaredConfigKeys, flattenYamlKeys } from '../lib/arbitration/audit.js'

const ALLOWLIST = {
  source: 'fixture',
  sha1: 'c'.repeat(40),
  count: 3,
  classes: ['org.bukkit.Bukkit', 'org.bukkit.event.EventHandler', 'org.bukkit.event.Listener'],
}

function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

/** A paper shard project; the caller supplies the shard source and manifest extras. */
function project({ source, manifestOverrides = {}, configYml } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-rules-'))
  write(root, 'src/main/java/com/example/plugin/MyPlugin.java', 'package com.example.plugin;\n\nimport org.bukkit.plugin.java.JavaPlugin;\n\npublic final class MyPlugin extends JavaPlugin {\n    public void onEnable() {\n    }\n}\n')
  write(root, '.mcdev/contract/contract.json', JSON.stringify({
    version: 1,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    javaVersion: 21,
    packageName: 'com.example.plugin',
    modules: [{ id: 'storage-shard' }],
    eventPriority: {},
    apiAllowlist: { partial: true },
  }, null, 2))
  write(root, '.mcdev/contract/api-allowlist.json', JSON.stringify(ALLOWLIST, null, 2))
  write(root, '.mcdev/shards/storage-shard/RegistrationManifest.json', JSON.stringify({
    version: 1,
    shardId: 'storage-shard',
    packageScope: 'com.example.plugin.shard.storage',
    ownedFiles: ['src/main/java/com/example/plugin/shard/storage/StorageListener.java'],
    mavenDependencies: [],
    lifecycleHooks: { onEnablePriority: 10, initStatements: [], onDisableStatements: [] },
    bukkitRegistrations: { listeners: ['com.example.plugin.shard.storage.StorageListener'], commands: [], permissions: [] },
    configDefaults: {},
    ...manifestOverrides,
  }, null, 2))
  if (source !== undefined) write(root, 'src/main/java/com/example/plugin/shard/storage/StorageListener.java', source)
  if (configYml !== undefined) write(root, 'src/main/resources/config.yml', configYml)
  return root
}

const findRule = (result, ruleId) => result.findings.find(finding => finding.ruleId === ruleId)

test('the rule table is complete and self-describing', () => {
  assert.equal(RULES.length, 21)
  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z][a-z0-9-]+$/)
    assert.ok(['error', 'warning'].includes(rule.severity), rule.id)
    assert.ok(rule.summary.length > 10, rule.id)
  }
})

test('a registered listener that does not implement Listener is an error', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\npublic final class StorageListener {\n    @EventHandler\n    public void onJoin(org.bukkit.event.player.PlayerJoinEvent event) {\n    }\n}\n',
  })
  try {
    const result = auditProject({ projectDir: root })
    assert.ok(findRule(result, 'listener-not-a-listener'), JSON.stringify(result.findings))
    assert.equal(findRule(result, 'listener-not-a-listener').severity, 'error')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a public type in the wrong file is an error before javac sees it', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\nimport org.bukkit.event.Listener;\n\npublic final class WrongName implements Listener {\n}\n',
  })
  try {
    const result = auditProject({ projectDir: root })
    const finding = findRule(result, 'public-class-name-mismatch')
    assert.ok(finding, JSON.stringify(result.findings))
    assert.match(finding.message, /WrongName/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an inventory click handler that never cancels is flagged', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\nimport org.bukkit.event.Listener;\nimport org.bukkit.event.inventory.InventoryClickEvent;\nimport org.bukkit.event.EventHandler;\n\npublic final class StorageListener implements Listener {\n    @EventHandler\n    public void onClick(InventoryClickEvent event) {\n        event.getRawSlot();\n    }\n}\n',
  })
  try {
    const result = auditProject({ projectDir: root })
    const finding = findRule(result, 'inventory-click-not-cancelled')
    assert.ok(finding, JSON.stringify(result.findings))
    assert.equal(finding.severity, 'warning')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a declared command without a setExecutor wiring is flagged', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\nimport org.bukkit.event.Listener;\n\npublic final class StorageListener implements Listener {\n}\n',
    manifestOverrides: {
      ownedFiles: ['src/main/java/com/example/plugin/shard/storage/StorageListener.java', 'src/main/java/com/example/plugin/shard/storage/StoreCommand.java'],
      bukkitRegistrations: {
        listeners: [],
        commands: [{ name: 'store', class: 'com.example.plugin.shard.storage.StoreCommand' }],
        permissions: [],
      },
    },
  })
  try {
    write(root, 'src/main/java/com/example/plugin/shard/storage/StoreCommand.java', 'package com.example.plugin.shard.storage;\n\npublic final class StoreCommand {\n}\n')
    const result = auditProject({ projectDir: root })
    assert.ok(findRule(result, 'command-executor-not-registered'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a repeating task without a cancel is flagged', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\nimport org.bukkit.event.Listener;\n\npublic final class StorageListener implements Listener {\n    public void start() {\n        org.bukkit.Bukkit.getScheduler().runTaskTimer(null, () -> { }, 20L, 20L);\n    }\n}\n',
  })
  try {
    const result = auditProject({ projectDir: root })
    assert.ok(findRule(result, 'repeating-task-not-cancelled'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a config key that nobody declares is flagged, and a declared one is not', () => {
  const root = project({
    source: 'package com.example.plugin.shard.storage;\n\nimport org.bukkit.event.Listener;\n\npublic final class StorageListener implements Listener {\n    public void read() {\n        int limit = 5;\n        limit = org.bukkit.Bukkit.getPluginManager() == null ? 1 : limit;\n    }\n}\n',
    configYml: 'probe:\n  storage:\n    max-entries: 5\n',
  })
  try {
    // The declared key is accepted by the collector, including its parents.
    const keys = collectDeclaredConfigKeys(root)
    assert.ok(keys.has('probe.storage.max-entries'))
    assert.ok(keys.has('probe.storage'))
    assert.deepEqual(flattenYamlKeys('a:\n  b: 1\n'), ['a', 'a.b'])

    write(root, 'src/main/java/com/example/plugin/shard/storage/StorageListener.java', [
      'package com.example.plugin.shard.storage;',
      '',
      'import org.bukkit.event.Listener;',
      '',
      'public final class StorageListener implements Listener {',
      '    public void read() {',
      '        getConfig().getString("probe.storage.max-entries");',
      '        getConfig().getString("probe.storage.missing-key");',
      '    }',
      '}',
      '',
    ].join('\n'))
    const result = auditProject({ projectDir: root })
    const missing = result.findings.filter(finding => finding.ruleId === 'config-key-undeclared')
    assert.equal(missing.length, 1, JSON.stringify(result.findings))
    assert.match(missing[0].message, /missing-key/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an ampersand colour code without a translator and a leftover TODO are flagged', () => {
  const root = project({
    source: [
      'package com.example.plugin.shard.storage;',
      '',
      'import org.bukkit.event.Listener;',
      '',
      'public final class StorageListener implements Listener {',
      '    public void greet(org.bukkit.entity.Player player) {',
      '        player.sendMessage("&aStored");',
      '    }',
      '    // TODO: wire the executor',
      '}',
      '',
    ].join('\n'),
  })
  try {
    const result = auditProject({ projectDir: root })
    assert.ok(findRule(result, 'legacy-color-code-not-translated'), JSON.stringify(result.findings))
    assert.ok(findRule(result, 'unfinished-todo'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
