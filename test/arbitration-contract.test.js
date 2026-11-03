import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildContractModel,
  canonicalJson,
  freezeContract,
  hashOf,
  loadApiAllowlist,
  parseApiIndex,
  readContract,
  renderDtoStub,
} from '../lib/arbitration/contract.js'

const FIXED = '2026-11-03T00:00:00.000Z'

function modelInput(overrides = {}) {
  return {
    platform: 'paper',
    minecraftVersion: '1.21.8',
    packageName: 'com.example.plugin',
    modules: [
      { id: 'storage', methods: ['void init()'], dto: [{ name: 'Home', fields: ['java.util.UUID owner', 'java.lang.String world'] }] },
      { id: 'gui' },
    ],
    allowlist: { source: 'fixture', sha1: 'a'.repeat(40), classes: ['org.bukkit.Bukkit'], count: 1 },
    generatedAt: FIXED,
    ...overrides,
  }
}

test('canonical JSON ignores key order so the contract hash is stable', () => {
  const a = hashOf({ b: 1, a: { d: 2, c: 3 } })
  const b = hashOf({ a: { c: 3, d: 2 }, b: 1 })
  assert.equal(a, b)
  assert.match(canonicalJson({ b: 1, a: 2 }), /"a": 2,[\s\S]*"b": 1/)
})

test('parseApiIndex reads the class headings of a generated index', () => {
  const text = [
    '<!-- PROVENANCE platform=paper -->',
    '# paper 26.3 API 签名索引',
    '## org.bukkit.Bukkit',
    '- public static org.bukkit.Server getServer();',
    '## io.papermc.paper.event.player.PlayerPickItemEvent',
    '- public org.bukkit.inventory.ItemStack getItem();',
  ].join('\n')
  assert.deepEqual(parseApiIndex(text), ['io.papermc.paper.event.player.PlayerPickItemEvent', 'org.bukkit.Bukkit'])
})

test('loadApiAllowlist reads the shipped index and degrades when it is missing', () => {
  const paper = loadApiAllowlist({ platform: 'paper', minecraftVersion: '1.21.8' })
  // The wide tier keeps ~90 classes for 1.21.8; the point is that the list came
  // from the shipped index, and that the classes the skills name are in it.
  assert.ok(paper.count >= 50, `expected a real paper index, got ${paper.count} classes`)
  assert.ok(paper.classes.includes('org.bukkit.Bukkit'), 'the core class must survive the index truncation')
  assert.match(paper.source, /references\/api-index\/1\.21\.8\.md$/)
  assert.match(paper.sha1, /^[0-9a-f]{40}$/)

  const spigot = loadApiAllowlist({ platform: 'spigot', minecraftVersion: '1.7.10' })
  assert.equal(spigot.count, 0)
  assert.equal(spigot.source, null)
  assert.match(spigot.warning, /no API index/)

  const unknown = loadApiAllowlist({ platform: 'unknown-platform', minecraftVersion: '1.0' })
  assert.match(unknown.warning, /unknown platform/)
})

test('buildContractModel is deterministic for identical inputs', () => {
  const first = buildContractModel(modelInput())
  const second = buildContractModel(modelInput())
  assert.equal(hashOf(first.model), hashOf(second.model))
  assert.deepEqual(first.stubs.map(stub => stub.file), second.stubs.map(stub => stub.file))
  assert.equal(first.model.constants.configKeys.length, 0)
})

test('DTOs render as records on modern lines and as classes on Java 8', () => {
  const modern = buildContractModel(modelInput({ javaVersion: 21 }))
  const recordStub = modern.stubs.find(stub => stub.file.endsWith('Home.java'))
  assert.match(recordStub.content, /public record Home\(java\.util\.UUID owner, java\.lang\.String world\)/)

  const legacy = buildContractModel(modelInput({ platform: 'spigot', minecraftVersion: '1.7.10', javaVersion: 8 }))
  const classStub = legacy.stubs.find(stub => stub.file.endsWith('Home.java'))
  assert.match(classStub.content, /public final class Home/)
  assert.doesNotMatch(classStub.content, /\brecord\b/)
  assert.match(classStub.content, /public java\.util\.UUID owner\(\)/)
})

test('renderDtoStub rejects fields that are not "Type name"', () => {
  assert.throws(() => renderDtoStub({ packageName: 'a.b', typeName: 'X', fields: ['nope'], javaVersion: 21 }), /DTO field must look like/)
})

test('module validation rejects duplicates, bad ids, and an unknown line', () => {
  assert.throws(() => buildContractModel(modelInput({ modules: ['storage', 'storage'] })), /duplicate module id/)
  assert.throws(() => buildContractModel(modelInput({ modules: ['Storage'] })), /kebab-case/)
  assert.throws(() => buildContractModel(modelInput({ platform: 'paper', minecraftVersion: '9.9' })), /unsupported paper line/)
  assert.throws(() => buildContractModel(modelInput({ modules: [] })), /at least one module/)
})

test('freezeContract writes stubs, contract.json and the allowlist, and refuses to overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-contract-'))
  try {
    const summary = freezeContract({
      projectDir: dir,
      ...modelInput(),
      allowlist: undefined,
    })
    assert.equal(summary.stubCount, 3, 'two interfaces plus one DTO')
    assert.ok(summary.allowlistCount >= 50, 'the paper 1.21.8 index should be picked up automatically')
    assert.match(summary.contractHash, /^[0-9a-f]{64}$/)

    const contractPath = join(dir, '.mcdev', 'contract', 'contract.json')
    assert.ok(existsSync(contractPath))
    const contract = readContract(dir)
    assert.equal(contract.platform, 'paper')
    assert.deepEqual(contract.modules.map(module => module.id), ['storage', 'gui'])
    const stub = join(dir, '.mcdev', 'contract', 'com', 'example', 'plugin', 'StorageService.java')
    assert.ok(existsSync(stub), 'the interface stub lands under the contract package path')
    assert.match(readFileSync(stub, 'utf8'), /void init\(\);/)

    assert.throws(() => freezeContract({ projectDir: dir, ...modelInput() }), /already frozen/)
    const forced = freezeContract({ projectDir: dir, ...modelInput(), force: true })
    assert.equal(forced.stubCount, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readContract reports a missing contract with a stable code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-contract-'))
  try {
    assert.throws(() => readContract(dir), error => error.code === 'E_CONTRACT_MISSING')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('a module may name its interface and freeze its thread model and doc', () => {
  const { model, stubs } = buildContractModel(modelInput({
    modules: [{ id: 'storage', interfaceName: 'HomesStorage', threadModel: 'async', doc: 'All JDBC work runs on a single daemon worker;\nfutures complete on the main thread.', methods: ['void init(java.io.File dir)'] }],
    javaVersion: 21,
  }))
  const stub = stubs.find(entry => entry.file.endsWith('HomesStorage.java'))
  assert.ok(stub, 'the explicit interface name must be used instead of StorageService')
  assert.match(stub.content, /public interface HomesStorage/)
  assert.match(stub.content, /Thread model: async/)
  assert.match(stub.content, /All JDBC work runs on a single daemon worker;/)
  assert.equal(model.symbols[0].threadModel, 'async')
  assert.equal(model.modules[0].interface, 'com.example.plugin.HomesStorage')
})

test('re-freezing removes the stubs the previous contract generated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-cleanup-'))
  try {
    const first = freezeContract({ projectDir: dir, ...modelInput(), allowlist: undefined })
    assert.equal(first.stubCount, 3)
    const orphan = join(dir, '.mcdev', 'contract', 'com', 'example', 'plugin', 'StorageService.java')
    assert.ok(existsSync(orphan))
    freezeContract({ projectDir: dir, force: true, ...modelInput({ modules: [{ id: 'gui' }] }), allowlist: undefined })
    assert.equal(existsSync(orphan), false, 'the stale stub must be deleted')
    assert.equal(existsSync(join(dir, '.mcdev', 'contract', 'com', 'example', 'plugin', 'GuiService.java')), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the allowlist records truncated indexes and accepts host-verified extras', () => {
  const paper = loadApiAllowlist({ platform: 'paper', minecraftVersion: '1.21.8' })
  assert.equal(paper.partial, true, 'the shipped index is truncated by design')
  const extra = loadApiAllowlist({ platform: 'paper', minecraftVersion: '1.21.8', extraAllowlist: ['org.bukkit.event.EventHandler'] })
  assert.equal(extra.classes.includes('org.bukkit.event.EventHandler'), true)
  assert.equal(extra.partial, true)
  const missing = loadApiAllowlist({ platform: 'spigot', minecraftVersion: '1.7.10', extraAllowlist: ['org.bukkit.Bukkit'] })
  assert.deepEqual(missing.classes, ['org.bukkit.Bukkit'], 'a missing index still carries the host extras')
})
