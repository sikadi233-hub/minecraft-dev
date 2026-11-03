import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { freezeContract } from '../lib/arbitration/contract.js'
import { buildEscalation, collectStatus, detectOrchestrator, readMemory, recordMemory, renderStatus } from '../lib/arbitration/status.js'

function write(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-status-'))
  freezeContract({
    projectDir: root,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    packageName: 'com.example.plugin',
    modules: [{ id: 'storage' }, { id: 'gui' }],
    generatedAt: '2026-11-03T00:00:00.000Z',
  })
  write(root, '.mcdev/shards/storage/RegistrationManifest.json', JSON.stringify({
    version: 1,
    shardId: 'storage',
    packageScope: 'com.example.plugin.shard.storage',
    ownedFiles: ['src/main/java/com/example/plugin/shard/storage/A.java', 'src/main/java/com/example/plugin/shard/storage/B.java'],
    mavenDependencies: [],
    lifecycleHooks: { onEnablePriority: 10, initStatements: [], onDisableStatements: [] },
    bukkitRegistrations: { listeners: [], commands: [], permissions: [] },
    configDefaults: {},
  }, null, 2))
  write(root, '.mcdev/shards/storage/BRIEF.md', '<!-- prefix=x -->\n')
  write(root, '.mcdev/reports/audit-attempts.json', JSON.stringify({ storage: 2 }, null, 2))
  return root
}

test('status reports brief/manifest state, retries and the orchestrator', () => {
  const root = project()
  try {
    const status = collectStatus({ projectDir: root, orchestrator: 'host' })
    assert.equal(status.orchestrator, 'host')
    assert.equal(status.shards.length, 2)
    const storage = status.shards.find(shard => shard.id === 'storage')
    assert.equal(storage.hasBrief, true)
    assert.equal(storage.hasManifest, true)
    assert.equal(storage.ownedFiles, 2)
    assert.equal(storage.attempts, 2)
    const gui = status.shards.find(shard => shard.id === 'gui')
    assert.equal(gui.hasManifest, false)
    assert.equal(gui.ownedFiles, 0)
    assert.ok(existsSync(status.reportPath))
    assert.match(renderStatus(status), /orchestrator: host/)
    assert.match(renderStatus(status), /\| storage \| yes \| yes \| 2 \|/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the memory ledger counts repeated rules', () => {
  const root = project()
  try {
    assert.deepEqual(readMemory(root).rules, {})
    recordMemory(root, [{ ruleId: 'async-io-in-listener' }, { ruleId: 'async-io-in-listener' }, { ruleId: 'write-outside-scope' }])
    const memory = recordMemory(root, [{ ruleId: 'async-io-in-listener' }])
    assert.equal(memory.rules['async-io-in-listener'], 3)
    assert.equal(memory.rules['write-outside-scope'], 1)
    assert.ok(memory.updatedAt)
    assert.equal(readMemory(root).rules['async-io-in-listener'], 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('orchestrator detection is a probe, never a dependency', () => {
  assert.equal(detectOrchestrator(undefined), 'host')
  assert.equal(detectOrchestrator({}), 'host')
  assert.equal(detectOrchestrator({ get: name => (name === 'orchestrator' ? {} : undefined) }), 'dsh-superagent')
  assert.equal(detectOrchestrator({ get: () => { throw new Error('no service') } }), 'host')
})

test('escalation names the collapse, the retries and the re-freeze steps', () => {
  const root = project()
  try {
    const escalation = buildEscalation({
      projectDir: root,
      reason: 'contract missing HomeService',
      findings: [{ shard: 'storage', ruleId: 'import-outside-allowlist', file: 'src/main/java/a/B.java', line: 7 }],
      unowned: [],
      contractCollapse: { symbol: 'HomeService', shards: ['gui', 'storage'], ratio: 1 },
      attempts: { storage: 3 },
    })
    assert.ok(existsSync(escalation.path))
    const markdown = readFileSync(escalation.path, 'utf8')
    assert.match(markdown, /Escalation/)
    assert.match(markdown, /HomeService/)
    assert.match(markdown, /100% of the run/)
    assert.match(markdown, /storage=3/)
    assert.match(markdown, /freeze` with `force: true`/)
    assert.match(markdown, /import-outside-allowlist/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
