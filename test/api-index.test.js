import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The shipped platform indexes are generated artefacts, and generated artefacts
 * rot silently: a hand edit can drop the provenance, a version bump can leave a
 * file claiming a sha1 it never had, and truncation can quietly grow past the
 * packaging budget. These checks keep the corpus honest without touching the
 * network — regeneration (`scripts/fetch-mc-api-index.mjs`) stays a manual,
 * optional step, because maven hosts are routinely unreachable.
 *
 * The mod indexes are deliberately NOT checked here: they live in `.cache/`
 * (gitignored) because they are third-party derivative content and are often
 * name-obfuscated; `fetch-mod-api-index.mjs --mod-jars` is the local workflow.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const SKILLS = join(REPO, 'assets', 'skills')

/** Per-file ceiling from `mc-index-lib.mjs` plus room for the header. */
const FILE_CAP = 320 * 1024
/**
 * Whole-corpus ceiling. The corpus covers every line in `lib/versions.js`
 * (18 of 19 lines today) at two depths: the newest line of each platform is
 * `deep` (≤300 KB), the historical lines are `wide` (≤100 KB).
 */
const CORPUS_CAP = 3 * 1024 * 1024

/** Skills that may carry an index, mapped to the platform name in the header. */
const PLATFORMS = {
  'minecraft-paper-plugin': 'paper',
  'minecraft-fabric-mod': 'fabric',
  'minecraft-forge-mod': 'forge',
  'minecraft-neoforge-mod': 'neoforge',
  'minecraft-spigot-legacy': 'spigot',
}

/** Index files (not the metadata companions) of one skill. */
function indexFiles(skill) {
  const dir = join(SKILLS, skill, 'references', 'api-index')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== 'COVERAGE.md' && name !== 'NOTICE.md')
    .map(name => ({ name, path: join(dir, name) }))
}

/** Parse the `<!-- PROVENANCE ... -->` block into a field map. */
function provenance(text) {
  const block = /<!-- PROVENANCE\n([\s\S]*?)-->/.exec(text)
  assert.ok(block, 'missing PROVENANCE block')
  const fields = {}
  for (const line of block[1].split('\n')) {
    const match = /^\s*([a-z0-9]+)=(.*)$/.exec(line)
    if (match) fields[match[1]] = match[2].trim()
  }
  return fields
}

const corpus = Object.keys(PLATFORMS).flatMap(skill => indexFiles(skill).map(file => ({ skill, ...file })))

test('every shipped index carries a complete, self-consistent provenance header', () => {
  assert.ok(corpus.length > 0, 'expected at least one generated index under assets/skills/*/references/api-index/')
  for (const { skill, name, path } of corpus) {
    const text = readFileSync(path, 'utf8')
    const fields = provenance(text)
    const platform = PLATFORMS[skill]
    assert.equal(fields.platform, platform, `${path}: platform should be ${platform}`)
    assert.equal(fields.line, name.replace(/\.md$/, ''), `${path}: line should match the file name`)
    assert.match(fields.artifact ?? '', /\S/, `${path}: artifact coordinate is required`)
    assert.match(fields.sha1 ?? '', /^[0-9a-f]{40}$/, `${path}: sha1 must be 40 hex chars`)
    assert.match(fields.fetched ?? '', /^\d{4}-\d{2}-\d{2}$/, `${path}: fetched must be an ISO date`)
    assert.match(fields.jdk ?? '', /^\d+/, `${path}: jdk level is required`)
    assert.ok(['javap', 'sources'].includes(fields.backend), `${path}: backend must be javap or sources`)
    assert.ok(['official', 'srg', 'intermediary'].includes(fields.mapping), `${path}: mapping must be detected`)
    assert.match(fields.classes ?? '', /^\d+\/\d+/, `${path}: classes=kept/total is required`)
  }
})

test('the body agrees with the header and stays inside the packaging budget', () => {
  let total = 0
  for (const { skill, path } of corpus) {
    const text = readFileSync(path, 'utf8')
    const fields = provenance(text)
    const bytes = statSync(path).size
    total += bytes
    assert.ok(bytes <= FILE_CAP, `${path}: ${Math.round(bytes / 1024)} KB exceeds the ${FILE_CAP / 1024} KB cap`)
    assert.match(text, new RegExp(`^# ${fields.platform} ${fields.line} API 签名索引$`, 'm'), `${path}: missing title heading`)
    assert.equal(text.includes('\uFFFD'), false, `${path}: contains replacement characters (encoding damage)`)
    const truncatedHeader = fields.classes.endsWith('(TRUNCATED)')
    const truncatedBody = /^TRUNCATED: kept \d+\/\d+ classes$/m.test(text)
    assert.equal(truncatedHeader, truncatedBody, `${path}: TRUNCATED marker must appear in both header and body`)
    assert.ok(
      text.includes('禁止凭记忆写签名'),
      `${path}: must keep the "never write signatures from memory" warning`,
    )
  }
  assert.ok(total <= CORPUS_CAP, `index corpus is ${Math.round(total / 1024)} KB, cap is ${CORPUS_CAP / 1024} KB`)
})

test('a platform that ships an index tells its skill where to look', () => {
  for (const skill of Object.keys(PLATFORMS)) {
    if (indexFiles(skill).length === 0) continue
    const text = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8')
    assert.ok(
      text.includes('references/api-index/'),
      `${skill}/SKILL.md must mention references/api-index/ because it ships an index`,
    )
  }
})

test('coverage tables list exactly the lines that exist', () => {
  for (const skill of Object.keys(PLATFORMS)) {
    const files = indexFiles(skill)
    const coveragePath = join(SKILLS, skill, 'references', 'api-index', 'COVERAGE.md')
    if (files.length === 0) continue
    assert.ok(existsSync(coveragePath), `${skill}: index exists but COVERAGE.md is missing`)
    const coverage = readFileSync(coveragePath, 'utf8')
    for (const { name } of files) {
      const line = name.replace(/\.md$/, '')
      assert.match(coverage, new RegExp(`\\| ${line.replace(/\./g, '\\.')} \\|`), `${skill}: COVERAGE.md must list ${line}`)
    }
  }
})

test('the generator scripts remain the documented entry points', () => {
  for (const script of ['scripts/fetch-mc-api-index.mjs', 'scripts/fetch-mod-api-index.mjs', 'scripts/mc-index-lib.mjs']) {
    assert.ok(existsSync(join(REPO, script)), `${script} must exist`)
  }
  const majorMods = readFileSync(join(SKILLS, 'minecraft-major-mods', 'SKILL.md'), 'utf8')
  assert.ok(majorMods.includes('fetch-mod-api-index'), 'the major-mods skill must document the local mod-index workflow')
})
