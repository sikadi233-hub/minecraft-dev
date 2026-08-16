import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Structural and functional smoke tests for the two plugin entry points.
 * The real imports require @deepseek-ai/cordis, dsh-tools and dsh-skill, which
 * only exist when the package is installed into a dsh profile (or
 * node_modules is linked to a harness checkout). When they are missing the
 * tests skip instead of failing — the dsh profile installation verification
 * covers the real load path.
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

test('module ../preset.js exports name/inject/apply with no service deps', async () => {
  let mod
  try {
    mod = await import('../preset.js')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return // deps absent outside a profile
    throw error
  }
  assert.equal(typeof mod.name, 'string')
  assert.ok(Array.isArray(mod.inject))
  assert.equal(mod.inject.length, 0)
  assert.equal(typeof mod.apply, 'function')
})

test('skills provider reads every bundled SKILL.md body', async () => {
  let mod
  try {
    mod = await import('../skills.js')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return // deps absent outside a profile
    throw error
  }
  // Capture the provider through a minimal fake ctx, exactly as the Loader would.
  let provider
  mod.apply({ skills: { registerProvider: create => { provider = create() } } })
  const candidates = await provider.list()
  assert.ok(candidates.length >= 7, `expected 7+ skills, got ${candidates.length}`)
  for (const candidate of candidates) {
    const definition = await provider.get(candidate)
    assert.equal(definition.name, candidate.name)
    assert.ok(definition.content.length > 200, `${candidate.name} body unreadable or too short`)
    assert.match(definition.content, /^# /, `${candidate.name} body should start with a heading`)
  }
})
