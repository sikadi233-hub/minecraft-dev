import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { architectFacts, renderArchitectBrief } from '../lib/architect-brief.js'
import { defaultJavaVersion, lineCoords, paperApiVersion, resolveLine } from '../lib/versions.js'

const SKILL_DIR = new URL('../assets/codex-architect/', import.meta.url)
const read = (name) => readFile(fileURLToPath(new URL(name, SKILL_DIR)), 'utf8')

// ---------------------------------------------------------------------------
// Skill assets
// ---------------------------------------------------------------------------

test('the architect skill bundle ships the skill body and both references', async () => {
  const skill = await read('SKILL.md')
  assert.ok(skill.length > 1500, 'SKILL.md looks too thin')
  assert.match(skill, /^# /)

  const brief = await read('references/architect-prompt.md')
  for (const required of [
    '// [TODO: Agent B] 功能描述',
    '{{PROJECT_DIR}}',
    '{{MC_VERSION}}',
    '{{JAVA}}',
    '{{API_COORD}}',
    '{{COORDS}}',
    'FILL-SPEC.md',
    '不超过 10 行',
    '不要编造 API 签名',
  ]) {
    assert.ok(brief.includes(required), `architect prompt should mention: ${required}`)
  }

  const coder = await read('references/coder-rules.md')
  for (const required of [
    '绝对不要修改方法签名',
    '只把 `// [TODO: Agent B] ...` 注释替换成实际代码',
    'mc_gradle',
    'isOnline()',
    'ConfigurationSection',
    '标记计数为 0',
  ]) {
    assert.ok(coder.includes(required), `coder rules should mention: ${required}`)
  }
})

test('the skill body carries the gate, the transparency rules and the delegation cap', async () => {
  const skill = await read('SKILL.md')
  for (const required of [
    'mc_codex',
    'codex resume',
    '.dsh/codex-architect.md',
    '探不到 Codex',
    '架构委派最多 1 次',
    'DSH 侧不会显示这笔消耗',
    'subagent_mc_plan',
  ]) {
    assert.ok(skill.includes(required), `SKILL.md should mention: ${required}`)
  }
})

// ---------------------------------------------------------------------------
// Brief rendering
// ---------------------------------------------------------------------------

const CASES = [
  ['paper', '1.21.8'],
  ['fabric', '1.20.1'],
  ['forge', '1.7.10'],
  ['neoforge', '26.2'],
]

test('architectFacts mirrors the shipped version matrix mc_scaffold uses', () => {
  for (const [platform, version] of CASES) {
    const entry = resolveLine(platform, version)
    const facts = architectFacts({ platform, minecraftVersion: version })
    assert.equal(facts.platform, platform)
    assert.equal(facts.minecraftVersion, entry.defaultMcVersion, `${platform} ${version} pinned version`)
    assert.equal(facts.line, entry.line)
    assert.equal(facts.javaVersion, defaultJavaVersion(platform, version))
    assert.deepEqual(facts.coords, lineCoords(platform, version))
    if (platform === 'paper') {
      assert.equal(facts.apiCoord, `io.papermc.paper:paper-api:${paperApiVersion(entry.defaultMcVersion)}`)
    } else {
      assert.equal(facts.apiCoord, null)
      assert.ok(Object.keys(facts.coords).length > 0, `${platform} should carry pinned coordinates`)
    }
  }
})

test('architectFacts honors an explicit javaVersion and rejects unknown lines', () => {
  const forced = architectFacts({ platform: 'paper', minecraftVersion: '1.21.8', javaVersion: 17 })
  assert.equal(forced.javaVersion, 17)
  assert.throws(() => architectFacts({ platform: 'nope', minecraftVersion: '1.21.8' }), /unsupported platform/)
  assert.throws(() => architectFacts({ platform: 'forge', minecraftVersion: '9.9.9' }), /no template/)
})

test('renderArchitectBrief fills every token and refuses to leave one behind', () => {
  const facts = architectFacts({ platform: 'paper', minecraftVersion: '1.21.8' })
  const template = 'P={{PLATFORM}} L={{PLATFORM_LABEL}} V={{MC_VERSION}} LINE={{MC_LINE}} J={{JAVA}}\n'
    + 'API={{API_COORD}}\nCOORDS={{COORDS}}\nDIR={{PROJECT_DIR}}\nGOAL={{GOAL}}\n'
  const text = renderArchitectBrief({ template, facts, projectDir: 'C:\\work\\demo', goal: '加个 /spawn 命令' })
  assert.match(text, /V=1\.21\.8/)
  assert.match(text, /J=21/)
  assert.match(text, /API=io\.papermc\.paper:paper-api:1\.21\.8-R0\.1-SNAPSHOT/)
  assert.match(text, /COORDS=\(platform has no pinned coordinates\)/)
  assert.match(text, /DIR=C:\\work\\demo/)
  assert.match(text, /GOAL=加个 \/spawn 命令/)
  assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/)

  assert.throws(
    () => renderArchitectBrief({ template: '{{NOPE}}', facts, projectDir: 'C:\\p', goal: 'x' }),
    /unresolved brief placeholders: \{\{NOPE\}\}/,
  )
})

test('the shipped template renders with real facts for every supported platform line', async () => {
  const template = await read('references/architect-prompt.md')
  for (const [platform, version] of CASES) {
    const facts = architectFacts({ platform, minecraftVersion: version })
    const text = renderArchitectBrief({ template, facts, projectDir: 'C:\\work\\demo', goal: 'demo goal' })
    assert.ok(text.includes(version === '1.7.10' ? '1.7.10' : facts.minecraftVersion))
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/)
  }
})

// ---------------------------------------------------------------------------
// codex.js module
// ---------------------------------------------------------------------------

test('codex.js contributes exactly one tool and one skill', async () => {
  const source = await readFile(fileURLToPath(new URL('../codex.js', import.meta.url)), 'utf8')
  assert.match(source, /export const name = 'minecraft-codex'/)
  assert.match(source, /export const inject = \['tools', 'skills'\]/)
  assert.match(source, /name: 'mc_codex'/)
  assert.equal(source.split("name: 'mc_codex'").length - 1, 1)
  assert.equal(source.split('registerProvider').length - 1, 1)
  assert.equal(source.split("const SKILL_NAME = 'minecraft-codex-architect'").length - 1, 1)
  for (const param of ['projectDir', 'goal', 'platform', 'minecraftVersion', 'sandbox', 'model', 'timeoutMs']) {
    assert.ok(source.includes(`${param}: {`), `mc_codex should declare the ${param} parameter`)
  }
  // The tool must never default to a full-access sandbox or to --ephemeral.
  assert.ok(!source.includes('danger-full-access'), 'danger-full-access must stay an explicit user choice')
})

test('the codex module registers its tool and skill against a live context', async () => {
  let mod
  try {
    mod = await import('../codex.js')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return // harness deps absent outside a profile
    throw error
  }
  let tool
  let provider
  mod.apply({
    tools: { register: registered => { tool = registered } },
    skills: { registerProvider: create => { provider = create() } },
  })
  assert.equal(tool.name, 'mc_codex')
  // defineTool normalizes the parameter map into an object-rooted JSON schema.
  const params = tool.parameters.properties ?? tool.parameters
  assert.ok(params.projectDir, 'mc_codex must declare projectDir')
  assert.ok(params.goal, 'mc_codex must declare goal')
  assert.deepEqual(params.sandbox.enum, ['read-only', 'workspace-write', 'danger-full-access'])
  assert.deepEqual(tool.parameters.required, ['projectDir', 'goal', 'platform', 'minecraftVersion'])
  assert.equal(typeof tool.execute, 'function')
  assert.equal(typeof tool.presentCall, 'function')
  assert.equal(typeof tool.presentResult, 'function')

  const candidates = await provider.list()
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'minecraft-codex-architect')
  const definition = await provider.get(candidates[0])
  assert.ok(definition.content.length > 1500)
  assert.match(definition.content, /^# /)
  assert.equal(typeof definition.resourceBase.path, 'string')
})
