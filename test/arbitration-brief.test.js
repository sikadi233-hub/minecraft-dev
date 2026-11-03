import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freezeContract } from '../lib/arbitration/contract.js'
import { GLOBAL_RULES, buildBrief, contractBlock, prefixFingerprints } from '../lib/arbitration/brief.js'

function frozenProject(modules = ['storage', 'gui', 'command']) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-brief-'))
  freezeContract({
    projectDir: root,
    platform: 'paper',
    minecraftVersion: '1.21.8',
    packageName: 'com.example.plugin',
    modules: modules.map(id => ({ id, methods: ['void init()'], dto: [{ name: `${id}Info`, fields: ['java.lang.String name'] }] })),
    generatedAt: '2026-11-03T00:00:00.000Z',
  })
  return root
}

test('a brief is three blocks: global rules, frozen contract, shard task', () => {
  const root = frozenProject()
  try {
    const brief = buildBrief({ projectDir: root, shard: 'storage', contract: JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8')), write: false })
    assert.ok(brief.prompt.startsWith(GLOBAL_RULES), 'block 1 is the global rules')
    assert.ok(brief.prompt.includes(contractBlock(JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8')))), 'block 2 is the canonical contract')
    assert.match(brief.prompt, /## Your shard: storage/)
    assert.match(brief.prompt, /com\.example\.plugin\.shard\.storage/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('every shard shares the same prefix and differs only in its task block', () => {
  const root = frozenProject()
  try {
    const contract = JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8'))
    const briefs = ['storage', 'gui', 'command'].map(shard => buildBrief({ projectDir: root, shard, contract, write: false }))
    assert.equal(new Set(briefs.map(brief => brief.block1Hash)).size, 1)
    assert.equal(new Set(briefs.map(brief => brief.block2Hash)).size, 1)
    assert.equal(new Set(briefs.map(brief => brief.prefixHash)).size, 1, 'the cache-friendly prefix must be byte-identical')
    assert.equal(new Set(briefs.map(brief => brief.block3Hash)).size, 3, 'each shard gets its own task')
    const fingerprints = prefixFingerprints({ projectDir: root, contract })
    assert.equal(fingerprints.sharedPrefix, true)
    assert.equal(fingerprints.shards.length, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the task block names the frozen interface, methods, DTOs and the acceptance', () => {
  const root = frozenProject()
  try {
    const contract = JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8'))
    const brief = buildBrief({ projectDir: root, shard: 'storage', contract, write: false })
    assert.match(brief.prompt, /StorageService/)
    assert.match(brief.prompt, /void init\(\)/)
    assert.match(brief.prompt, /StorageInfo/)
    assert.match(brief.prompt, /Acceptance:/)
    assert.match(brief.prompt, /RegistrationManifest\.json/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('writing a brief lands in the shard directory with its fingerprints', () => {
  const root = frozenProject()
  try {
    const contract = JSON.parse(readFileSync(join(root, '.mcdev/contract/contract.json'), 'utf8'))
    const brief = buildBrief({ projectDir: root, shard: 'gui', contract })
    assert.ok(existsSync(brief.path))
    const written = readFileSync(brief.path, 'utf8')
    assert.match(written, /^<!-- block1=[0-9a-f]{64} block2=[0-9a-f]{64} prefix=[0-9a-f]{64} -->/)
    assert.throws(() => buildBrief({ projectDir: root, shard: 'nope', contract }), /not part of the frozen contract/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
