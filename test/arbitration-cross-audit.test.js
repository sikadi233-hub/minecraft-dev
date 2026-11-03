import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RULES, auditProject, crossShardFindings } from '../lib/arbitration/audit.js'

function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

/** A paper project with two shards; `shards` maps id → manifest overrides. */
function project({ shards, contractOverrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-cross-'))
  write(root, 'src/main/java/com/example/plugin/MyPlugin.java', 'package com.example.plugin;\n\nimport org.bukkit.plugin.java.JavaPlugin;\n\npublic final class MyPlugin extends JavaPlugin {\n    public void onEnable() {\n    }\n}\n')
  write(root, '.mcdev/contract/contract.json', JSON.stringify({
    version: 1,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    javaVersion: 21,
    packageName: 'com.example.plugin',
    modules: Object.keys(shards).map(id => ({ id })),
    symbols: [{ kind: 'interface', fqn: 'com.example.plugin.StorageService' }],
    apiAllowlist: { partial: true },
    ...contractOverrides,
  }, null, 2))
  write(root, '.mcdev/contract/api-allowlist.json', JSON.stringify({ source: 'fixture', sha1: 'd'.repeat(40), count: 2, classes: ['org.bukkit.Bukkit', 'org.bukkit.event.Listener'] }, null, 2))
  for (const [id, overrides] of Object.entries(shards)) {
    const scope = `com.example.plugin.shard.${id}`
    const file = `src/main/java/com/example/plugin/shard/${id}/Impl.java`
    write(root, file, `package ${scope};\n\npublic final class Impl {\n}\n`)
    write(root, `.mcdev/shards/${id}/RegistrationManifest.json`, JSON.stringify({
      version: 1,
      shardId: id,
      packageScope: scope,
      ownedFiles: [file],
      mavenDependencies: [],
      lifecycleHooks: { onEnablePriority: 10, initStatements: [], onDisableStatements: [] },
      bukkitRegistrations: { listeners: [], commands: [], permissions: [] },
      configDefaults: {},
      ...overrides,
    }, null, 2))
  }
  return root
}

const ids = findings => findings.map(finding => finding.ruleId)

test('the rule table now has 21 rules, all self-describing', () => {
  assert.equal(RULES.length, 21)
  for (const rule of RULES) assert.ok(rule.summary.length > 10, rule.id)
})

test('the same listener declared by two shards is an error', () => {
  const listener = 'com.example.plugin.shard.a.Impl'
  const root = project({
    shards: {
      a: { bukkitRegistrations: { listeners: [listener], commands: [], permissions: [] } },
      b: { bukkitRegistrations: { listeners: [listener], commands: [], permissions: [] } },
    },
  })
  try {
    const findings = crossShardFindings({ projectDir: root, contract: JSON.parse(JSON.stringify({ symbols: [], packageName: 'com.example.plugin' })) })
    const hit = findings.find(finding => finding.ruleId === 'listener-declared-twice')
    assert.ok(hit, JSON.stringify(findings))
    assert.equal(hit.severity, 'error')
    assert.equal(hit.shard, 'b', 'the second declarer is the one to fix')
    assert.match(hit.message, /also declared by a/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('two shards sharing onEnablePriority is a warning', () => {
  const root = project({
    shards: {
      a: { lifecycleHooks: { onEnablePriority: 20, initStatements: [], onDisableStatements: [] } },
      b: { lifecycleHooks: { onEnablePriority: 20, initStatements: [], onDisableStatements: [] } },
    },
  })
  try {
    const findings = crossShardFindings({ projectDir: root, contract: { symbols: [], packageName: 'com.example.plugin' } })
    const hit = findings.find(finding => finding.ruleId === 'duplicate-enable-priority')
    assert.ok(hit, JSON.stringify(findings))
    assert.match(hit.message, /a, b/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('initialising a class owned by a later shard is flagged', () => {
  const root = project({
    shards: {
      early: {
        lifecycleHooks: {
          onEnablePriority: 10,
          initStatements: ['this.late = new com.example.plugin.shard.late.Impl();'],
          onDisableStatements: [],
        },
      },
      late: { lifecycleHooks: { onEnablePriority: 30, initStatements: [], onDisableStatements: [] } },
    },
  })
  try {
    const findings = crossShardFindings({ projectDir: root, contract: { symbols: [], packageName: 'com.example.plugin' } })
    const hit = findings.find(finding => finding.ruleId === 'init-order-violation')
    assert.ok(hit, JSON.stringify(findings))
    assert.equal(hit.shard, 'early')
    assert.match(hit.message, /owned by late \(priority 30\)/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a command gated by an undeclared permission is flagged', () => {
  const root = project({
    shards: {
      a: {
        bukkitRegistrations: {
          listeners: [],
          commands: [{ name: 'store', class: 'com.example.plugin.shard.a.Impl', permission: 'probe.store.use' }],
          permissions: [{ node: 'probe.other', default: 'op' }],
        },
      },
    },
  })
  try {
    const findings = crossShardFindings({ projectDir: root, contract: { symbols: [], packageName: 'com.example.plugin' } })
    assert.ok(findings.some(finding => finding.ruleId === 'command-permission-unregistered' && /probe\.store\.use/.test(finding.message)), JSON.stringify(findings))
    // A declared-but-unused permission is harmless, so it is deliberately not a rule.
    assert.equal(findings.some(finding => finding.ruleId === 'permission-declared-unused'), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a main-class field type the contract cannot resolve is flagged', () => {
  const root = project({
    shards: {
      a: { mainClassFields: [{ type: 'NotInTheContract', name: 'thing' }] },
    },
  })
  try {
    const findings = crossShardFindings({ projectDir: root, contract: { symbols: [], packageName: 'com.example.plugin' } })
    const hit = findings.find(finding => finding.ruleId === 'field-type-unresolved')
    assert.ok(hit, JSON.stringify(findings))
    assert.match(hit.message, /NotInTheContract/)

    // The same field is fine when the contract declares the type.
    const okRoot = project({ shards: { a: { mainClassFields: [{ type: 'StorageService', name: 'storage' }] } } })
    try {
      const ok = crossShardFindings({ projectDir: okRoot, contract: { symbols: [{ fqn: 'com.example.plugin.StorageService' }], packageName: 'com.example.plugin' } })
      assert.equal(ok.some(finding => finding.ruleId === 'field-type-unresolved'), false)
    } finally { rmSync(okRoot, { recursive: true, force: true }) }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('auditProject folds cross findings into the project verdict, but a single-shard audit stays local', () => {
  const root = project({
    shards: {
      a: { bukkitRegistrations: { listeners: ['com.example.plugin.shard.a.Impl'], commands: [], permissions: [] } },
      b: { bukkitRegistrations: { listeners: ['com.example.plugin.shard.a.Impl'], commands: [], permissions: [] } },
    },
  })
  try {
    const whole = auditProject({ projectDir: root })
    assert.ok(ids(whole.findings).includes('listener-declared-twice'), JSON.stringify(whole.findings))
    assert.equal(whole.verdict, 'reject')

    const single = auditProject({ projectDir: root, shard: 'b' })
    assert.equal(ids(single.findings).includes('listener-declared-twice'), false, 'a single-shard audit must not run cross checks')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
