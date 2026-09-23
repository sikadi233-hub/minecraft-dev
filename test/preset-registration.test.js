import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { hasPresetRegistry, registerPresetDefinitions } from '../lib/preset-register.js'
import { minecraftPreset } from '../preset/minecraft/rows.js'
import { minecraftArchitectPreset } from '../preset/minecraft-architect/rows.js'

/**
 * The dual-model switch: dsh 0.1.5/0.1.6 scans preset DIRECTORIES, dsh 0.1.7+
 * takes preset DECLARATIONS through `agentPresets.register()`. The plugin must
 * pick the right form from what the host offers, and must not fall back to the
 * file copy when the registry accepted the declarations.
 *
 * `lib/preset-register.js` holds that decision and imports nothing from dsh, so
 * it is exercised here with fakes; `preset.js` is only the adapter, and its
 * wiring is asserted textually (the real load path is covered by installing the
 * package into a profile of each dsh line).
 */

const DEFINITIONS = [minecraftPreset, minecraftArchitectPreset]

/** A recording logger. */
function logger() {
  const lines = []
  return { lines, info: (m) => lines.push(`info: ${m}`), warn: (m) => lines.push(`warn: ${m}`) }
}

test('only a registry exposing register() counts as the 0.1.7 host', () => {
  assert.equal(hasPresetRegistry(undefined), false)
  assert.equal(hasPresetRegistry(null), false)
  assert.equal(hasPresetRegistry({}), false)
  // 0.1.5 publishes a preset service too — with mount/list/authoring, no register.
  assert.equal(hasPresetRegistry({ list: () => [], mount: () => {}, readDocument: () => {} }), false)
  assert.equal(hasPresetRegistry({ register: () => {} }), true)
})

test('registerPresetDefinitions declares every preset in order and owns each one', () => {
  const registered = []
  const effects = []
  const log = logger()
  const taken = registerPresetDefinitions({
    registry: { register: (definition) => { registered.push(definition); return Promise.resolve(() => {}) } },
    definitions: DEFINITIONS,
    effect: (body) => { effects.push(body()); return () => {} },
    logger: log,
  })
  assert.equal(taken, true)
  assert.deepEqual(registered.map(d => d.id), ['minecraft', 'minecraft-architect'])
  assert.equal(registered[0].plugins.length, 18)
  assert.equal(registered[1].plugins.length, 19)
  assert.equal(effects.length, 2, 'each declaration must be handed to ctx.effect so unload withdraws it')
  assert.equal(log.lines.length, 2)
  assert.match(log.lines[0], /registered agent preset 'minecraft' \(18 rows\)/)
  assert.match(log.lines[1], /registered agent preset 'minecraft-architect' \(19 rows\)/)
})

test('a register() that throws is reported, and the other preset still loads', () => {
  const log = logger()
  const registered = []
  const taken = registerPresetDefinitions({
    registry: {
      register: (definition) => {
        if (definition.id === 'minecraft') throw new Error('duplicate preset id')
        registered.push(definition.id)
        return Promise.resolve(() => {})
      },
    },
    definitions: DEFINITIONS,
    effect: (body) => { body(); return () => {} },
    logger: log,
  })
  assert.equal(taken, true)
  assert.deepEqual(registered, ['minecraft-architect'])
  assert.equal(log.lines.filter(l => l.startsWith('warn:')).length, 1)
  assert.match(log.lines[0], /duplicate preset id/)
})

test('without a registry the caller is told to fall back, and nothing is declared', () => {
  const log = logger()
  let effects = 0
  for (const registry of [undefined, null, {}, { list: () => [] }]) {
    const taken = registerPresetDefinitions({
      registry,
      definitions: DEFINITIONS,
      effect: () => { effects += 1 },
      logger: log,
    })
    assert.equal(taken, false, `registry ${JSON.stringify(registry)} must not count as 0.1.7`)
  }
  assert.equal(effects, 0)
  assert.equal(log.lines.length, 0)
})

test('preset.js wires the registry path before the directory fallback', async () => {
  const source = await readFile(fileURLToPath(new URL('../preset.js', import.meta.url)), 'utf8')
  const declaredAt = source.indexOf('if (declared) return')
  const copyAt = source.indexOf('ensurePresetInstalled({')
  assert.ok(declaredAt > -1, 'preset.js must return before the file copy when the registry took the declarations')
  assert.ok(copyAt > declaredAt, 'the directory install must stay the fallback path')
  assert.ok(source.includes('registerPresetDefinitions('), 'preset.js must delegate the decision to lib/preset-register.js')
  // The registry is a hard dependency on BOTH lines: 0.1.7's registry row
  // initializes after third-party rows, so reading it without waiting saw
  // `undefined` and silently wrote directories 0.1.7 never scans.
  assert.match(source, /export const inject = \['agentPresets'\]/)
  assert.ok(source.includes('registry: ctx.agentPresets'), 'preset.js must read the injected service, not ctx.get')
  assert.equal(/registry:\s*ctx\.get\(/.test(source), false, 'ctx.get raced the registry and must not come back')
})
