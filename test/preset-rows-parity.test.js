import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { minecraftPreset } from '../preset/minecraft/rows.js'
import { minecraftArchitectPreset } from '../preset/minecraft-architect/rows.js'

/**
 * The zero-drift gate for the two preset FORMS.
 *
 * Since v0.9.0 a preset exists twice: as the YAML directory a dsh 0.1.5/0.1.6
 * roster scans, and as the `rows.js` definition a dsh 0.1.7+ `agentPresets`
 * registry takes. `rows.js` is generated from the YAML, and this test fails
 * when the two disagree, so the duplication cannot rot.
 *
 * The repo has no dependencies, so this compares without a YAML parser:
 *   1. flattened (id, name) pairs in document order,
 *   2. every scalar config leaf (`key: value` present in the YAML text),
 *   3. every YAML block scalar against every multi-line string in the module
 *      (multiset equality — this is what holds the long persona prose together).
 *
 * Two substitutions are allowed in the JS form only, and both are asserted
 * below so an accidental third one cannot slip through:
 *   - `disabled: !!js <expr>` becomes a real boolean,
 *   - `@deepseek-ai/dsh-workflow-worker-thread` becomes `...-ptc` (0.1.7 removed
 *     the worker-thread workflow provider).
 */

const PRESETS = [
  { id: 'minecraft', definition: minecraftPreset },
  { id: 'minecraft-architect', definition: minecraftArchitectPreset },
]

const WORKFLOW_SUBSTITUTION = [
  ['workflow-worker-thread', 'workflow-ptc'],
  ['@deepseek-ai/dsh-workflow-worker-thread', '@deepseek-ai/dsh-workflow-ptc'],
]

const path = (id, file) => fileURLToPath(new URL(`../preset/${id}/${file}`, import.meta.url))

/** Depth-first (id, name) pairs of a definition's row tree, in document order. */
function rowPairs(plugins, out = []) {
  for (const row of plugins) {
    out.push(`${row.id} ${row.name}`)
    if (Array.isArray(row.config)) rowPairs(row.config, out)
  }
  return out
}

/** Depth-first scalar leaves, as `${key}: ${value}` tokens.
 *  `disabled` is skipped: the YAML carries a `!!js` platform expression where the
 *  module carries the boolean it evaluates to, and the substitution rules below
 *  assert that pairing directly. */
function scalarTokens(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) scalarTokens(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'disabled') continue
      if (child !== null && typeof child === 'object') scalarTokens(child, out)
      else if (typeof child === 'boolean' || typeof child === 'number') out.push(`${key}: ${child}`)
      else if (typeof child === 'string' && !child.includes('\n')) out.push(`${key}: ${child}`)
    }
    return out
  }
  return out
}

/** Every multi-line string in a definition, as a sorted list. */
function multilineStrings(value, out = []) {
  if (typeof value === 'string') {
    if (value.includes('\n')) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) multilineStrings(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) multilineStrings(child, out)
  }
  return out
}

/**
 * Extract every block scalar (`key: |` / `key: |-`) from a composition, with
 * the same chomping js-yaml applies: `|` clips (one trailing newline), `|-`
 * strips.
 */
function yamlBlockScalars(text) {
  const lines = text.split('\n')
  const found = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = /^(\s*)[\w-]+: (\|[-+]?)\s*$/.exec(lines[index])
    if (!head) continue
    const headIndent = head[1].length
    const body = []
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (line.trim() === '') {
        body.push('')
        continue
      }
      const indent = line.length - line.trimStart().length
      if (indent <= headIndent) break
      body.push(line)
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop()
    const indents = body.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length)
    const strip = indents.length > 0 ? Math.min(...indents) : 0
    const dedented = body.map(line => (line === '' ? '' : line.slice(strip))).join('\n')
    const clipped = head[2] === '|' ? `${dedented}\n` : dedented
    found.push(clipped)
    index = cursor - 1
  }
  return found.sort()
}

/** The (id, name) pairs a composition declares, in document order. */
function yamlRowPairs(text) {
  const lines = text.split('\n')
  const pairs = []
  let pendingId = null
  for (const line of lines) {
    const idMatch = /^\s*- id: (.+?)\s*$/.exec(line)
    if (idMatch) {
      pendingId = idMatch[1].trim()
      continue
    }
    const nameMatch = /^\s+name: (.+?)\s*$/.exec(line)
    if (nameMatch && pendingId !== null) {
      let name = nameMatch[1].trim()
      if ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"'))) {
        name = name.slice(1, -1)
      }
      pairs.push(`${pendingId} ${name}`)
      pendingId = null
    }
  }
  return pairs
}

/** Apply the two documented JS-side substitutions to a YAML row pair list. */
function expectedFromYaml(pairs) {
  return pairs.map((pair) => {
    let out = pair
    for (const [from, to] of WORKFLOW_SUBSTITUTION) out = out.replace(from, to)
    return out
  })
}

for (const { id, definition } of PRESETS) {
  test(`${id}: rows.js declares the same row tree as agent.cordis.yml`, async () => {
    const yaml = await readFile(path(id, 'agent.cordis.yml'), 'utf8')
    const fromYaml = expectedFromYaml(yamlRowPairs(yaml))
    const fromModule = rowPairs(definition.plugins)
    assert.deepEqual(fromModule, fromYaml)
    assert.ok(fromModule.length >= 18, `expected the full row set, got ${fromModule.length}`)
  })

  test(`${id}: every scalar config leaf in rows.js appears in agent.cordis.yml`, async () => {
    const yaml = await readFile(path(id, 'agent.cordis.yml'), 'utf8')
    for (const raw of scalarTokens(definition.plugins)) {
      // Undo the documented substitutions so the token is looked up in its
      // 0.1.5-era spelling, which is what the YAML carries.
      let token = raw
      for (const [from, to] of WORKFLOW_SUBSTITUTION) token = token.replace(to, from)
      const [key, value] = token.split(': ')
      const present = yaml.includes(`${key}: ${value}`) || yaml.includes(`${key}: "${value}"`) || yaml.includes(`${key}: '${value}'`)
      assert.ok(present, `agent.cordis.yml is missing \`${key}: ${value}\``)
    }
  })

  test(`${id}: the multi-line strings are byte-identical across both forms`, async () => {
    const yaml = await readFile(path(id, 'agent.cordis.yml'), 'utf8')
    const fromYaml = yamlBlockScalars(yaml)
    const fromModule = multilineStrings(definition.plugins).sort()
    assert.equal(fromModule.length, fromYaml.length, 'block-scalar count differs between the two forms')
    for (let index = 0; index < fromYaml.length; index += 1) {
      assert.equal(fromModule[index], fromYaml[index], `block scalar #${index} differs`)
    }
  })

  test(`${id}: preset.yml metadata matches the definition`, async () => {
    const meta = await readFile(path(id, 'preset.yml'), 'utf8')
    const unquote = (value) => value.trim().replace(/^"|"$/g, '')
    const name = /^name: (.+)$/m.exec(meta)
    assert.notEqual(name, null, 'preset.yml has no name')
    assert.equal(unquote(name[1]), definition.name)
    assert.match(meta, new RegExp(`^order: ${definition.order}$`, 'm'))
    const description = /^description: (.+)$/m.exec(meta)
    assert.notEqual(description, null, 'preset.yml has no description')
    assert.equal(unquote(description[1]), definition.description)
  })
}

test('the architect definition stays the expert plus exactly two insertions', () => {
  const expert = minecraftPreset.plugins
  const architect = minecraftArchitectPreset.plugins
  assert.equal(architect.length, expert.length + 1)
  assert.equal(architect[architect.length - 1].id, 'codex-architect')
  assert.equal(architect[architect.length - 1].name, 'minecraft-dev/codex')
  assert.deepEqual(architect.slice(1, -1), expert.slice(1))
  const expertPersona = expert[0]
  const architectPersona = architect[0]
  assert.equal(architectPersona.id, 'persona')
  assert.equal(architectPersona.name, expertPersona.name)
  assert.deepEqual(Object.keys(architectPersona.config), Object.keys(expertPersona.config))
  assert.ok(architectPersona.config.prefix.startsWith(expertPersona.config.prefix), 'the Astra section must be appended to the expert persona')
  const astra = architectPersona.config.prefix.slice(expertPersona.config.prefix.length)
  assert.match(astra, /^\n\n## Codex（Astra）架构分工\n/)
  assert.ok(astra.includes('// [TODO: Agent B]'))
  assert.ok(astra.includes('mode: "app-server"'), 'the persona must state which transport makes a run app-visible')
  assert.ok(astra.includes('codex resume <threadId>'))
  assert.equal(architectPersona.config.suffix, expertPersona.config.suffix)
})

test('the expert definition carries no Codex/Astra trace', () => {
  const text = JSON.stringify(minecraftPreset)
  for (const token of ['mc_codex', 'codex-architect', 'minecraft-dev/codex', 'Astra', 'FILL-SPEC']) {
    assert.equal(text.includes(token), false, `expert preset must not mention ${token}`)
  }
})

test('the JS form names only 0.1.7-era packages', () => {
  const text = JSON.stringify(minecraftPreset)
  assert.equal(text.includes('dsh-workflow-worker-thread'), false, 'the worker-thread provider was removed in dsh 0.1.7')
  assert.ok(text.includes('@deepseek-ai/dsh-workflow-ptc'))
  assert.match(text, /"disabled":(true|false)/)
})
