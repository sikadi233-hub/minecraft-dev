import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The zero-drift guarantee for the shipped presets.
 *
 * `preset/minecraft-architect/` is DEFINED as the expert composition plus
 * exactly two insertions: the "## Codex（Astra）架构分工" persona section and
 * the trailing `codex-architect` row. This test removes those two regions and
 * asserts the remainder is byte-identical to `preset/minecraft/agent.cordis.yml`,
 * so the Minecraft expert preset cannot drift while the architect preset is
 * edited — and the delta itself stays free to change.
 */

const BASE = fileURLToPath(new URL('../preset/minecraft/agent.cordis.yml', import.meta.url))
const ARCHITECT = fileURLToPath(new URL('../preset/minecraft-architect/agent.cordis.yml', import.meta.url))
const BASE_PRESET = fileURLToPath(new URL('../preset/minecraft/preset.yml', import.meta.url))
const ARCHITECT_PRESET = fileURLToPath(new URL('../preset/minecraft-architect/preset.yml', import.meta.url))

const PERSONA_HEADING = '\n\n      ## Codex（Astra）架构分工\n'
const SUFFIX_ANCHOR = '\n\n    suffix: '
const ROW_ANCHOR = '\n\n# ── Codex(Astra) architecture handoff'

/** Remove the two documented insertions from the architect composition. */
function stripArchitectDelta(text) {
  const headingAt = text.indexOf(PERSONA_HEADING)
  assert.notEqual(headingAt, -1, 'the architect persona section heading is missing')
  const suffixAt = text.indexOf(SUFFIX_ANCHOR, headingAt)
  assert.notEqual(suffixAt, -1, 'the persona suffix anchor is missing')
  const withoutPersona = text.slice(0, headingAt) + text.slice(suffixAt)
  const rowAt = withoutPersona.indexOf(ROW_ANCHOR)
  assert.notEqual(rowAt, -1, 'the appended codex row block is missing')
  return `${withoutPersona.slice(0, rowAt)}\n`
}

test('the architect composition is the expert composition plus exactly two insertions', async () => {
  const base = await readFile(BASE, 'utf8')
  const architect = await readFile(ARCHITECT, 'utf8')
  assert.notEqual(base, architect, 'the architect composition must differ from the expert one')
  assert.equal(stripArchitectDelta(architect), base)
})

test('the Minecraft expert preset carries no Codex/Astra trace at all', async () => {
  const base = await readFile(BASE, 'utf8')
  for (const token of ['mc_codex', 'codex-architect', 'minecraft-dev/codex', 'Astra', 'codex exec', 'FILL-SPEC', 'Codex']) {
    assert.equal(base.includes(token), false, `expert preset must not mention ${token}`)
  }
})

test('the architect preset mounts the codex module exactly once, as the last row', async () => {
  const architect = await readFile(ARCHITECT, 'utf8')
  assert.equal(architect.split('name: minecraft-dev/codex').length - 1, 1)
  assert.match(architect, /- id: codex-architect\n  name: minecraft-dev\/codex\n$/)
  // The row must stay a loose consumer row: no isolate realm, no config block.
  assert.doesNotMatch(architect, /- id: codex-architect\n(?:.*\n)*?\s+isolate:/)
})

test('each preset carries its own roster identity', async () => {
  const expert = await readFile(BASE_PRESET, 'utf8')
  const architect = await readFile(ARCHITECT_PRESET, 'utf8')
  assert.match(expert, /^name: Minecraft 专家$/m)
  assert.match(expert, /^order: 5$/m)
  assert.match(architect, /^name: "Minecraft 架构师（Astra神的瞥视）"$/m)
  assert.match(architect, /^order: 6$/m)
  assert.match(architect, /codex resume/)
})

test('architect preset.yml quotes its metadata and stays ASCII-colon free', async () => {
  // The roster parses preset.yml with a strict YAML reader: an unquoted value
  // containing `[`, `]` or `: ` throws, the whole metadata block is dropped,
  // and the preset shows up nameless with no roster order (learned the hard
  // way: js-yaml rejects an unquoted `[TODO: Agent B]`).
  const architect = await readFile(ARCHITECT_PRESET, 'utf8')
  assert.match(architect, /^name: "/m)
  assert.match(architect, /^description: "/m)
  for (const line of architect.split('\n')) {
    if (line.startsWith('name:') || line.startsWith('description:')) {
      assert.ok(line.trimEnd().endsWith('"'), `quoted value must be closed: ${line.slice(0, 40)}…`)
    }
  }
})

test('the persona delta states the gate and the transparency rules', async () => {
  const architect = await readFile(ARCHITECT, 'utf8')
  for (const phrase of [
    'mc_codex',
    'minecraft-codex-architect',
    '// [TODO: Agent B]',
    'FILL-SPEC.md',
    'codex exec resume',
    'Never retry silently',
    'do the work\n      yourself instead',
  ]) {
    assert.ok(architect.includes(phrase), `persona delta should mention: ${phrase}`)
  }
})
