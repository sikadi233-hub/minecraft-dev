import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Compliance is a claim in a manifest and a file in the package; both are easy
 * to lose in a refactor, and npm will happily publish a package whose `files`
 * list silently drops the NOTICE Apache-2.0 §4(d) depends on. These checks pin
 * the whole statement: SPDX id, the licence text itself, the attribution file,
 * the README disclaimers, and the packaging entries.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const license = readFileSync(join(REPO, 'LICENSE'), 'utf8')
const notice = readFileSync(join(REPO, 'NOTICE'), 'utf8')
const readme = readFileSync(join(REPO, 'README.md'), 'utf8')

test('the package declares Apache-2.0 with an author', () => {
  assert.equal(pkg.license, 'Apache-2.0', 'package.json license must be the SPDX id Apache-2.0')
  assert.notEqual(pkg.license, 'MIT', 'the MIT grant must not survive the transition')
  assert.equal(pkg.author, 'sikadi233', 'package.json must name the author')
})

test('LICENSE is the verbatim Apache License 2.0 text', () => {
  assert.match(license, /Apache License/, 'LICENSE must be the Apache text, not a stub')
  assert.match(license, /Version 2\.0, January 2004/, 'LICENSE must name version 2.0 and its date')
  assert.match(license, /END OF TERMS AND CONDITIONS/, 'LICENSE must contain the full terms')
  assert.match(license, /APPENDIX/, 'LICENSE must include the appendix that defines the boilerplate')
  assert.ok(license.length > 10_000, `LICENSE looks truncated (${license.length} chars)`)
  assert.equal(/MIT License/i.test(license), false, 'LICENSE must no longer be the MIT text')
})

test('the copyright holder is named in LICENSE and README, not only in NOTICE', () => {
  assert.match(license, /Copyright 2026 sikadi233/, 'LICENSE must fill the appendix owner line')
  assert.match(license, /sikadi233-hub\/minecraft-dev/, 'LICENSE must carry the canonical repository url')
  assert.match(readme, /版权归属：Copyright 2026/, 'README must state the holder next to the licence rules')
})

test('NOTICE carries the attribution Apache-2.0 section 4(d) protects', () => {
  assert.match(notice, /minecraft-dev/, 'NOTICE must name the project')
  assert.match(notice, /Copyright 2026 sikadi233/, 'NOTICE must carry the copyright line')
  assert.match(notice, /Section 4\(d\) of the Apache License, Version 2\.0/, 'NOTICE must cite section 4(d)')
  assert.match(notice, /Sharded Execution/, 'NOTICE must claim the arbitration architecture')
  assert.match(notice, /Micro-Auditor/, 'NOTICE must claim the micro-auditor work')
  assert.match(notice, /3-Tier Conflict Arbitration/, 'NOTICE must claim the arbitration tiers')
})

test('the README states licence, ecosystem independence, and the Minecraft disclaimer', () => {
  assert.match(readme, /## 合规与免责声明/, 'README must end with the compliance section')
  assert.match(readme, /Apache License 2\.0/, 'README must name the licence and its start version')
  assert.match(readme, /v0\.11\.0` 及更早版本仍为 MIT/, 'README must say earlier versions stay MIT')
  assert.match(readme, /并非 DeepSeek 官方出品/, 'README must disclaim official DeepSeek status')
  assert.match(readme, /Mojang Synergies AB/, 'README must disclaim Mojang affiliation')
  assert.match(readme, /minecraft\.net\/eula/, 'README must link the Minecraft EULA')
})

test('the published package ships the NOTICE file', () => {
  assert.ok(Array.isArray(pkg.files), 'package.json files must stay an array')
  assert.ok(pkg.files.includes('NOTICE'), 'files must list NOTICE: npm does not include it automatically')
  assert.ok(pkg.files.includes('lib'), 'files must keep the lib directory')
  assert.ok(existsSync(join(REPO, 'NOTICE')), 'NOTICE must exist at the repository root')
})

test('the version reflects the licence transition', () => {
  // 0.12.0 carries the licence transition; patches keep the same major/minor.
  assert.match(pkg.version, /^0\.12\.\d+$/, `expected a 0.12.x release, got ${pkg.version}`)
  assert.notEqual(pkg.version, '0.11.0', 'the MIT release must not come back')
})
