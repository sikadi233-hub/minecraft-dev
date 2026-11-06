import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Preset rows are resolved by the installed dsh, and dsh removed two forms our
 * presets used to rely on:
 *
 * - `@deepseek-ai/dsh-tool-subagent-control/list-agents` — the subpath export is
 *   gone in 0.2.2-rc.1; the package root registers the `list_agents` tool itself.
 *   Keeping the row made the whole preset invalid ("never started"), which fails
 *   every new session, not just the delegation tools.
 * - `@deepseek-ai/dsh-workflow-worker-thread` — renamed to `dsh-workflow-ptc`;
 *   the YAML keeps the old name for the 0.1.5/0.1.6 directory form, and `rows.js`
 *   is the form that must carry the new one.
 *
 * This test pins both facts so a regeneration cannot reintroduce them silently.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const PRESETS = ['minecraft', 'minecraft-architect']
const read = (id, file) => readFileSync(join(REPO, 'preset', id, file), 'utf8')

for (const id of PRESETS) {
  test(`${id}: no preset row references the removed list-agents subpath`, () => {
    for (const file of ['agent.cordis.yml', 'rows.js']) {
      assert.doesNotMatch(read(id, file), /dsh-tool-subagent-control\/list-agents/, `${file} still references the removed subpath`)
    }
  })

  test(`${id}: the 0.1.7 form names the workflow provider dsh actually ships`, () => {
    const rows = read(id, 'rows.js')
    assert.match(rows, /@deepseek-ai\/dsh-workflow-ptc/, 'rows.js must use the renamed provider')
    assert.doesNotMatch(rows, /name: "@deepseek-ai\/dsh-workflow-worker-thread"/, 'rows.js must not name the removed provider')
  })

  test(`${id}: the 0.1.5 directory form keeps the name that dsh 0.1.5 shipped`, () => {
    const yaml = read(id, 'agent.cordis.yml')
    assert.match(yaml, /@deepseek-ai\/dsh-workflow-worker-thread/, 'the legacy form documents the legacy name; rows.js rewrites it')
  })
}
