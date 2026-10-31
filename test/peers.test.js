import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The dsh compatibility contract.
 *
 * Three dsh lines are supported at once: 0.1.5-rc.x (directory presets),
 * 0.1.7-rc.x (agentPresets declarations) and 0.2.0-rc.x. The peer ranges must
 * name every one of them, because node-semver cannot express "any prerelease of
 * these lines" portably: `^0.1.5-rc.1` does NOT match `0.2.0-rc.2` even with
 * `includePrerelease`, and neither does a bare `>=0.1.5-rc.1 <0.2.0`. The only
 * portable form is an enumeration.
 *
 * Why this matters more than it looks: dsh 0.2.0-rc.2 added a hard gate that
 * REFUSES to import a plugin whose `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*`
 * peers do not match the running runtime version (dsh-app-boot's
 * `evaluatePluginCompatibility`). A missing line does not warn — the whole
 * package is skipped and its tools, skills and presets silently vanish. That is
 * exactly what happened when 0.2.0-rc.2 shipped while these peers still stopped
 * at `^0.1.7-rc.1`.
 *
 * `test/peers.test.js` therefore pins DECLARATION COVERAGE, not just the shape:
 * every line in RUNTIME_LINES below must appear as a caret range in both dsh
 * peers. It is deliberately not a semver reimplementation — the authoritative
 * semantic check is the gate itself, verified by booting a profile of the line
 * (`dsh --profile <scratch> --dump-config` shows the rows only when the gate
 * passed).
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))

/** Every dsh line this plugin claims. Add a line here when dsh ships one. */
const RUNTIME_LINES = [
  { line: '0.1.5', declared: '^0.1.5-rc.1', verified: '0.1.5-rc.2' },
  { line: '0.1.7', declared: '^0.1.7-rc.1', verified: '0.1.7-rc.1' },
  { line: '0.2.0', declared: '^0.2.0-rc.2', verified: '0.2.1-rc.5' },
]

const pkg = JSON.parse(await readFile(`${REPO}package.json`, 'utf8'))
const readme = await readFile(`${REPO}README.md`, 'utf8')

test('the dsh peers enumerate exactly the supported lines', () => {
  const expected = RUNTIME_LINES.map(entry => entry.declared).join(' || ')
  for (const dependency of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-skill']) {
    assert.equal(pkg.peerDependencies[dependency], expected, `${dependency} must enumerate every supported line, in order`)
  }
})

test('the dsh peers cover the runtime version each line was verified on', () => {
  // A caret range on `X.Y.Z[-pre]` covers every later patch of that X.Y line, so
  // `^0.2.0-rc.2` covers 0.2.1-rc.2 while `^0.1.5-rc.1` does not — that is the
  // whole reason the lines are enumerated. Comparing major.minor (not the full
  // tuple) lets a line be re-verified on a newer patch without reshuffling peers;
  // test 1 already pins the exact declared strings.
  for (const { declared, verified } of RUNTIME_LINES) {
    const minor = value => value.replace(/^\^/, '').split('-')[0].split('.').slice(0, 2).join('.')
    assert.equal(minor(declared), minor(verified), `${declared} must cover ${verified}`)
  }
})

test('cordis and schemastery are not line-gated by the runtime check', () => {
  // The gate only inspects peers named `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`,
  // so these two keep a single caret range that spans every line.
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '^3.18.1')
})

test('the README states which dsh lines are verified and warns about the gate', () => {
  for (const { verified } of RUNTIME_LINES) {
    assert.ok(readme.includes(verified), `README must name the supported dsh version ${verified}`)
  }
  assert.ok(
    readme.includes('0.1.7') && (readme.includes('agentPresets') || readme.includes('.agent-presets')),
    'README must explain that dsh 0.1.7 changed how presets are declared',
  )
  assert.ok(
    readme.includes('evaluatePluginCompatibility') || readme.includes('兼容性门禁'),
    'README must warn that dsh 0.2.0+ refuses plugins whose peers miss its line',
  )
})
