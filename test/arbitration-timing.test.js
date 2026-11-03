import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freezeContract } from '../lib/arbitration/contract.js'
import { arbitrate } from '../lib/arbitration/tool.js'
import { readTimings, recordTiming, renderTimings, summarizeTimings, timingPath } from '../lib/arbitration/timing.js'

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-timing-'))
  freezeContract({
    projectDir: root,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    packageName: 'com.example.plugin',
    modules: [{ id: 'storage' }],
    generatedAt: '2026-11-03T00:00:00.000Z',
  })
  return root
}

test('timing records append and summarize per action', () => {
  const root = project()
  try {
    assert.deepEqual(readTimings(root), [])
    recordTiming(root, { action: 'brief', durationMs: 120 })
    recordTiming(root, { action: 'audit', durationMs: 40, shard: 'storage' })
    recordTiming(root, { action: 'brief', durationMs: 30 })
    const entries = readTimings(root)
    assert.equal(entries.length, 3)
    assert.equal(entries[1].shard, 'storage')
    const summary = summarizeTimings(entries)
    assert.equal(summary.totalMs, 190)
    assert.equal(summary.byAction.brief.calls, 2)
    assert.equal(summary.byAction.brief.totalMs, 150)
    const line = renderTimings(entries)
    assert.match(line, /^engine time 0\.2s: brief /)
    assert.match(line, /brief [\d.]+s×2/)
    assert.ok(line.indexOf('brief') < line.indexOf('audit'), 'slowest action first')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the status action reports the engine time so far', async () => {
  const root = project()
  try {
    const ctx = { get: () => undefined }
    const config = { shardedArbitration: 'auto', maxAuditRetries: 3, maxCompileRounds: 3 }
    await arbitrate({ action: 'brief', projectDir: root }, { ctx, config })
    const status = await arbitrate({ action: 'status', projectDir: root }, { ctx, config })
    assert.match(status.summary, /engine time/)
    assert.match(status.summary, /brief /, 'the brief call must be counted')
    assert.ok(existsSync(timingPath(root)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an empty ledger renders a clear placeholder instead of NaN', () => {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-timing-'))
  try {
    assert.match(renderTimings(readTimings(root)), /no calls recorded yet/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
