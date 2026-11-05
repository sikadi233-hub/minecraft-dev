import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The packaging contract: which subpaths resolve, and that every declared target
 * exists. Node ignores `main` once `exports` is present, so a `main` that is not
 * mirrored by `exports["."]` is a dead field — the root import fails even though
 * the field looks meaningful. This file pins the two together.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

const normalize = value => String(value).replace(/^\.\//, '')

test('the exports map exposes exactly the documented subpaths', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './codex', './package.json', './preset', './skills', './tools'].sort())
})

test('every exports target points at a file that ships', () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const file = join(REPO, ...String(target).replace(/^\.\//, '').split('/'))
    assert.ok(existsSync(file), `${subpath} → ${target} does not exist`)
  }
})

test('main and the root export name the same entry', () => {
  assert.ok(pkg.main, 'package.json must still declare main for older tooling')
  assert.equal(normalize(pkg.exports['.']), normalize(pkg.main), 'main and exports["."] must agree, or one of them is dead')
})

test('the published files list keeps the licence, the notice and the engine', () => {
  for (const entry of ['NOTICE', 'README.md', 'cordis.patch.yml', 'lib', 'assets', 'preset', 'skills.js', 'tools.js', 'codex.js', 'preset.js']) {
    assert.ok(pkg.files.includes(entry), `files must include ${entry}`)
  }
})

test('the dsh manifest still declares a server bundle patch', () => {
  assert.equal(pkg.dsh.plugin, true)
  assert.equal(pkg.dsh.kind, 'server')
  assert.ok(existsSync(join(REPO, ...pkg.dsh.bundle.patch.replace(/^\.\//, '').split('/'))), 'bundle patch must exist')
})
