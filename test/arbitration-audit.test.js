import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { auditProject, auditShard, eventHandlers, eventTypeOf, matchingBrace, priorityOf, readAttempts } from '../lib/arbitration/audit.js'

const PLUGIN_JAVA = `package com.example.plugin;

import org.bukkit.plugin.java.JavaPlugin;

public final class MyPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
        // [mc:init]
    }

    @Override
    public void onDisable() {
        // [mc:shutdown]
    }
}
`

const ALLOWLIST = {
  source: 'fixture',
  sha1: 'b'.repeat(40),
  count: 6,
  classes: [
    'org.bukkit.Bukkit',
    'org.bukkit.event.EventHandler',
    'org.bukkit.event.Listener',
    'org.bukkit.event.player.PlayerJoinEvent',
    'org.bukkit.plugin.java.JavaPlugin',
    'org.bukkit.scheduler.BukkitRunnable',
  ],
}

function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

/** Paper fixture: contract, allowlist, entry class, one shard with a Java source. */
function project({ source, owned = ['src/main/java/com/example/plugin/shard/storage/StorageListener.java'], manifestOverrides = {}, contractOverrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-audit-'))
  write(root, 'src/main/java/com/example/plugin/MyPlugin.java', PLUGIN_JAVA)
  write(root, '.mcdev/contract/contract.json', JSON.stringify({
    version: 1,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    javaVersion: 21,
    packageName: 'com.example.plugin',
    modules: [{ id: 'storage-shard' }],
    eventPriority: { PlayerJoinEvent: 'MONITOR' },
    ...contractOverrides,
  }, null, 2))
  write(root, '.mcdev/contract/api-allowlist.json', JSON.stringify(ALLOWLIST, null, 2))
  write(root, '.mcdev/shards/storage-shard/RegistrationManifest.json', JSON.stringify({
    version: 1,
    shardId: 'storage-shard',
    packageScope: 'com.example.plugin.shard.storage',
    ownedFiles: owned,
    mavenDependencies: [],
    lifecycleHooks: { onEnablePriority: 10, initStatements: [], onDisableStatements: [] },
    bukkitRegistrations: { listeners: ['com.example.plugin.shard.storage.StorageListener'], commands: [], permissions: [] },
    configDefaults: {},
    ...manifestOverrides,
  }, null, 2))
  if (source !== undefined) write(root, owned[0], source)
  return root
}

const CLEAN = `package com.example.plugin.shard.storage;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

public final class StorageListener implements Listener {
    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        event.getPlayer().getName();
    }
}
`

test('a clean shard passes with no findings', () => {
  const root = project({ source: CLEAN })
  try {
    const result = auditProject({ projectDir: root })
    assert.equal(result.verdict, 'pass', JSON.stringify(result.findings))
    assert.equal(result.findings.length, 0)
    assert.equal(result.circuitOpen, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('blocking I/O inside an event handler is rejected', () => {
  const root = project({ source: CLEAN.replace('event.getPlayer().getName();', 'Thread.sleep(10);') })
  try {
    const result = auditShard({ projectDir: root, shard: 'storage-shard', contract: JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8')), allowlist: new Set(ALLOWLIST.classes) })
    assert.equal(result.verdict, 'reject')
    assert.ok(result.findings.some(finding => finding.ruleId === 'async-io-in-listener'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cancelling at MONITOR is reported as missing-event-cancel', () => {
  const source = CLEAN.replace('@EventHandler', '@EventHandler(priority = EventPriority.MONITOR)').replace('event.getPlayer().getName();', 'event.setCancelled(true);')
  const root = project({ source, manifestOverrides: { bukkitRegistrations: { listeners: [], commands: [], permissions: [] } } })
  try {
    const result = auditProject({ projectDir: root })
    assert.ok(result.findings.some(finding => finding.ruleId === 'missing-event-cancel'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a handler priority that contradicts the contract is an error', () => {
  const source = CLEAN.replace('@EventHandler', '@EventHandler(priority = EventPriority.HIGH)')
  const root = project({ source })
  try {
    const result = auditProject({ projectDir: root })
    const finding = result.findings.find(item => item.ruleId === 'event-priority-mismatch')
    assert.ok(finding, JSON.stringify(result.findings))
    assert.match(finding.message, /pins PlayerJoinEvent to MONITOR/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('imports outside the frozen allowlist are reported, allowed ones are not', () => {
  const source = CLEAN.replace('import org.bukkit.event.player.PlayerJoinEvent;', 'import org.bukkit.event.player.PlayerJoinEvent;\nimport com.google.common.collect.Lists;')
  const root = project({ source })
  try {
    const result = auditProject({ projectDir: root })
    const imports = result.findings.filter(finding => finding.ruleId === 'import-outside-allowlist')
    assert.equal(imports.length, 1, JSON.stringify(result.findings))
    assert.match(imports[0].message, /com\.google\.common\.collect\.Lists/)
    assert.equal(imports[0].line, 6, 'the injected import sits on the line after PlayerJoinEvent')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a file inside the shard package but outside ownedFiles is a scope violation', () => {
  const root = project({ source: CLEAN })
  try {
    write(root, 'src/main/java/com/example/plugin/shard/storage/Extra.java', 'package com.example.plugin.shard.storage;\n')
    const result = auditProject({ projectDir: root })
    assert.ok(result.findings.some(finding => finding.ruleId === 'write-outside-scope'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a shard that owns the entry class is rejected', () => {
  const root = project({ source: CLEAN })
  try {
    const manifestPath = join(root, '.mcdev/shards/storage-shard/RegistrationManifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // A shard whose scope is the entry package may legally list the entry class,
    // which is exactly the case this rule must catch.
    manifest.packageScope = 'com.example.plugin'
    manifest.ownedFiles = ['src/main/java/com/example/plugin/MyPlugin.java', 'src/main/java/com/example/plugin/shard/storage/StorageListener.java']
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    const result = auditProject({ projectDir: root })
    assert.ok(result.findings.some(finding => finding.ruleId === 'main-class-touched'), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Bukkit calls in an async task are a warning, and declared classes must exist', () => {
  const source = CLEAN.replace(
    'event.getPlayer().getName();',
    'getServer().getScheduler().runTaskAsynchronously(null, () -> { Bukkit.getOnlinePlayers(); });',
  )
  const root = project({ source, manifestOverrides: { bukkitRegistrations: { listeners: ['com.example.plugin.shard.storage.StorageListener', 'com.example.plugin.shard.storage.Ghost'], commands: [], permissions: [] } } })
  try {
    const result = auditProject({ projectDir: root })
    assert.ok(result.findings.some(finding => finding.ruleId === 'scheduler-sync-blocking'), JSON.stringify(result.findings))
    assert.ok(result.findings.some(finding => finding.ruleId === 'missing-registration' && /Ghost/.test(finding.message)), JSON.stringify(result.findings))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the circuit breaker opens after maxRetries rejected audits', () => {
  const root = project({ source: CLEAN.replace('event.getPlayer().getName();', 'Thread.sleep(10);') })
  try {
    for (let round = 1; round <= 3; round += 1) {
      const result = auditProject({ projectDir: root, maxRetries: 3 })
      assert.equal(result.verdict, 'reject')
      assert.equal(result.circuitOpen, round === 3, `round ${round}`)
    }
    assert.equal(readAttempts(root)['storage-shard'], 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('brace matching and handler parsing survive nested blocks', () => {
  const text = 'void a() {\n  if (true) { x(); }\n}\nclass B {\n  void c() { }\n}\n'
  assert.equal(text[matchingBrace(text, text.indexOf('{'))], '}')
  const handler = '@EventHandler\npublic void onJoin(org.bukkit.event.player.PlayerJoinEvent event) {\n  if (x) { y(); }\n}\n'
  const handlers = eventHandlers(handler)
  assert.equal(handlers.length, 1)
  assert.equal(eventTypeOf(handlers[0].signature), 'PlayerJoinEvent')
  assert.equal(priorityOf('(priority = EventPriority.HIGH)'), 'HIGH')
  assert.equal(priorityOf(''), undefined)
})


test('a truncated index downgrades unknown imports to a warning', () => {
  // Must be outside the project package, otherwise it is skipped as the shard's own code.
  const source = CLEAN.replace('import org.bukkit.event.player.PlayerJoinEvent;', 'import org.bukkit.event.player.PlayerJoinEvent;\nimport com.google.common.collect.Lists;')
  const root = project({ source })
  try {
    const contractPath = join(root, '.mcdev/contract/contract.json')
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
    contract.apiAllowlist = { ...contract.apiAllowlist, partial: true }
    writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf8')
    const result = auditProject({ projectDir: root })
    const importFinding = result.findings.find(finding => finding.ruleId === 'import-outside-allowlist')
    assert.ok(importFinding, JSON.stringify(result.findings))
    assert.equal(importFinding.severity, 'warning')
    assert.match(importFinding.message, /truncated subset/)
    assert.equal(result.verdict, 'warn')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
