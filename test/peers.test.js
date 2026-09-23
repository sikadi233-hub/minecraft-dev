import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The dsh compatibility contract.
 *
 * Two dsh lines are supported at once: 0.1.5-rc.x (the runtime this plugin was
 * first built against, and the launcher's current line) and 0.1.7-rc.x, whose
 * preset model the plugin adapts to at runtime. The peer ranges must say so
 * explicitly, because node-semver's prerelease rule means `^0.1.5-rc.1` alone
 * does NOT match `0.1.7-rc.1` — a prerelease only satisfies a range that names
 * a prerelease on the same major.minor.patch. Widening to a bare `>=0.1.5-rc.1
 * <0.2.0` would not help either; the only portable form is an enumeration.
 *
 * A semantic check (does pnpm accept these peers against a real runtime?) is not
 * expressible here — this repo ships zero dependencies on purpose — so the peer
 * contract is verified by installing the plugin into a profile of each dsh line
 * and checking the mounts. This test pins the shape and the documentation that
 * keeps that decision from being "simplified" away.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const SUPPORTED_LINES = ['^0.1.5-rc.1', '^0.1.7-rc.1']

const pkg = JSON.parse(await readFile(`${REPO}package.json`, 'utf8'))
const readme = await readFile(`${REPO}README.md`, 'utf8')

test('the dsh peers enumerate every supported line', () => {
  for (const dependency of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-skill']) {
    const range = pkg.peerDependencies[dependency]
    assert.equal(typeof range, 'string', `${dependency} must stay a peerDependency`)
    for (const line of SUPPORTED_LINES) {
      assert.ok(range.includes(line), `${dependency} must name ${line}; got ${range}`)
    }
    assert.ok(range.includes('||'), `${dependency} must enumerate lines, not use a single caret range: ${range}`)
  }
})

test('cordis and schemastery keep a caret range that spans both lines', () => {
  // Both lines ship cordis 4.0.2+ and schemastery 3.18.x, so one caret range
  // each is enough and enumerating them would only invite drift.
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '^3.18.1')
})

test('the README states which dsh lines are verified', () => {
  for (const phrase of ['0.1.5-rc.1', '0.1.7-rc.1']) {
    assert.ok(readme.includes(phrase), `README must name the supported dsh line ${phrase}`)
  }
  assert.ok(
    readme.includes('0.1.7') && (readme.includes('agentPresets') || readme.includes('.agent-presets')),
    'README must explain that dsh 0.1.7 changed how presets are declared',
  )
})
