import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Structural smoke test for the two plugin entry points. The real imports
 * require @deepseek-ai/cordis, dsh-tools and dsh-skill, which only exist when
 * the package is installed into a dsh profile (or node_modules is linked to a
 * harness checkout). When they are missing the test skips instead of failing —
 * the dsh profile installation verification covers the real load path.
 */
for (const spec of ['../skills.js', '../tools.js']) {
  test(`module ${spec} exports name/inject/apply`, async () => {
    let mod
    try {
      mod = await import(spec)
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return // deps absent outside a profile
      throw error
    }
    assert.equal(typeof mod.name, 'string')
    assert.ok(Array.isArray(mod.inject))
    assert.equal(typeof mod.apply, 'function')
    assert.equal(mod.inject.length, 1)
  })
}
