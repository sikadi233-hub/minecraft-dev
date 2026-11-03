/**
 * Stage 1 of the sharded pipeline: **freeze the contract**.
 *
 * A shard worker may only implement what the contract says. If every worker
 * invents its own interfaces, the merge has nothing to reconcile and the model
 * spends its budget reconciling signatures instead of writing code. So the
 * architect step writes, once and immutably:
 *
 * - `contract/stubs/*.java` — the interfaces and DTOs workers implement;
 * - `contract/contract.json` — the symbol table, thread model, event-priority
 *   table and the allowlist fingerprint;
 * - `contract/api-allowlist.json` — every class the workers may import, taken
 *   from the shipped `references/api-index/<line>.md` for the target line.
 *
 * The allowlist is why this module reads the API index corpus: the index already
 * contains the exact classes of the pinned artefact, so "which imports are legal"
 * becomes a data question instead of a guess. When the index is missing (e.g.
 * Spigot 1.7.10) the contract records a warning and the audit rule degrades to
 * "platform package prefix" instead of an exact class list.
 *
 * Determinism matters: the same inputs must produce the same bytes, because the
 * contract hash is what tells the merge (and the cache) that nothing changed.
 *
 * @module minecraft-dev/lib/arbitration/contract
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_LINES, SUPPORTED_PLATFORMS, defaultJavaVersion } from '../versions.js'
import { arbitrationPaths, ensureArbitrationLayout, ensureDir, resolveInside } from './paths.js'

const REPO = fileURLToPath(new URL('../../', import.meta.url))

/** Contract schema version written into `contract.json`. */
export const CONTRACT_VERSION = 1

/** Which skill directory holds the API index for each platform. */
export const SKILL_OF_PLATFORM = {
  paper: 'minecraft-paper-plugin',
  fabric: 'minecraft-fabric-mod',
  forge: 'minecraft-forge-mod',
  neoforge: 'minecraft-neoforge-mod',
  spigot: 'minecraft-spigot-legacy',
}

/** Error code for a missing contract file. */
export const CONTRACT_MISSING = 'E_CONTRACT_MISSING'

/**
 * Canonical JSON: keys sorted, two-space indent, trailing newline.
 * Used for hashing and for stable briefs, never for the on-disk pretty files
 * where key order is cosmetic anyway.
 * @param {unknown} value - JSON-serializable value.
 * @returns {string} canonical text.
 */
export function canonicalJson(value) {
  const sort = input => {
    if (Array.isArray(input)) return input.map(sort)
    if (input && typeof input === 'object') {
      const out = {}
      for (const key of Object.keys(input).sort()) out[key] = sort(input[key])
      return out
    }
    return input
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`
}

/** sha256 of the canonical JSON form of a value. */
export function hashOf(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** `storage-shard` / `storage` → `Storage`. */
export function pascalCase(text) {
  return String(text)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Extract class names from a generated API index.
 *
 * The indexes use `## fully.qualified.Name` headings; everything else is member
 * lines, so this is a one-pass parse with no ambiguity.
 * @param {string} text - index file body.
 * @returns {string[]} sorted fully-qualified class names.
 */
export function parseApiIndex(text) {
  const classes = []
  for (const match of String(text).matchAll(/^## ([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/gm)) classes.push(match[1])
  return [...new Set(classes)].sort()
}

/**
 * Load the allowlist for one platform line.
 *
 * Falls back to an empty list with a warning when the line has no index (today
 * only Spigot 1.7.10): the audit rule then checks package prefixes instead of
 * exact classes, so a missing index never blocks the pipeline.
 * @param {object} options - platform, version, optional repo root and index path override.
 * @returns {{ source: string|null, sha1: string|null, classes: string[], count: number, warning?: string }} allowlist.
 */
export function loadApiAllowlist({ platform, minecraftVersion, repoRoot = REPO, indexPath, extraAllowlist = [] }) {
  const extra = Array.isArray(extraAllowlist) ? extraAllowlist.map(String) : []
  if (!SKILL_OF_PLATFORM[platform]) return { source: null, sha1: null, classes: [...new Set(extra)].sort(), count: extra.length, partial: true, warning: `unknown platform ${platform}` }
  const relative = indexPath ?? posix.join('assets', 'skills', SKILL_OF_PLATFORM[platform], 'references', 'api-index', `${minecraftVersion}.md`)
  const absolute = indexPath ?? join(repoRoot, ...relative.split('/'))
  if (!existsSync(absolute)) {
    return {
      source: null,
      sha1: null,
      classes: [...new Set(extra)].sort(),
      count: extra.length,
      partial: true,
      warning: `no API index for ${platform} ${minecraftVersion}; the allowlist audit degrades to package prefixes`,
    }
  }
  const text = readFileSync(absolute, 'utf8')
  const classes = parseApiIndex(text)
  // Generated indexes are truncated by design; a class missing from a partial
  // index is not proof that the class does not exist.
  const ratio = /classes=(\d+)\/(\d+)/.exec(text)
  const partial = Boolean(ratio && Number(ratio[1]) < Number(ratio[2])) || /TRUNCATED/.test(text)
  const merged = [...new Set([...classes, ...extra])].sort()
  return {
    source: indexPath ? absolute : relative,
    sha1: createHash('sha1').update(text).digest('hex'),
    classes: merged,
    count: merged.length,
    partial,
  }
}

/**
 * Normalize one module declaration.
 *
 * Accepts the short form (`"storage"`) or the explicit form
 * (`{ id, methods, dto, configKeys, permissions }`) and validates the id, so the
 * rest of the pipeline can assume a well-formed module.
 * @param {string|object} input - module declaration.
 * @returns {{ id: string, methods: string[], dto: object[], configKeys: string[], permissions: string[] }} normalized module.
 */
export function normalizeModule(input) {
  const module = typeof input === 'string' ? { id: input } : { ...input }
  if (typeof module.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(module.id)) {
    throw new Error(`module id must be kebab-case (got ${JSON.stringify(module.id)})`)
  }
  const list = value => (Array.isArray(value) ? value.map(String) : [])
  const threadModel = module.threadModel === 'async' ? 'async' : 'sync'
  return {
    id: module.id,
    interfaceName: typeof module.interfaceName === 'string' && /^[A-Z][A-Za-z0-9_]*$/.test(module.interfaceName) ? module.interfaceName : undefined,
    threadModel,
    doc: typeof module.doc === 'string' ? module.doc : undefined,
    methods: list(module.methods),
    dto: Array.isArray(module.dto)
      ? module.dto.map(entry => (typeof entry === 'string' ? { name: entry, fields: [] } : { name: String(entry.name), fields: list(entry.fields) }))
      : [],
    configKeys: list(module.configKeys),
    permissions: list(module.permissions),
  }
}

/** Java file name for a type: `StorageService` → `StorageService.java`. */
function javaFileName(typeName) {
  return `${typeName}.java`
}

/**
 * Render one interface stub.
 * @param {object} options - package, type name, module id, methods.
 * @returns {string} Java source.
 */
export function renderInterfaceStub({ packageName, typeName, moduleId, methods, threadModel = 'sync', doc }) {
  const body = methods.length === 0
    ? ['    // No methods frozen for this module yet.']
    : methods.map(method => `    ${method.endsWith(';') ? method : `${method};`}`)
  const docLines = typeof doc === 'string' && doc.trim() !== ''
    ? doc.trim().split(/\r?\n/).map(line => ` * ${line}`)
    : [` * Frozen contract for the {@code ${moduleId}} shard (minecraft-dev v0.12.0).`]
  return [
    `package ${packageName};`,
    '',
    '/**',
    ...docLines,
    ' * Shards implement this interface; they must not change it.',
    ` * Thread model: ${threadModel} (frozen by the contract).`,
    ' */',
    `public interface ${typeName} {`,
    ...body,
    '}',
    '',
  ].join('\n')
}

/**
 * Render one DTO stub: a record on Java 16+, a final class with accessors on
 * older lines (1.7.10 / 1.12.2 / 1.16.5 are Java 8 targets).
 * @param {object} options - package, type name, fields (each `Type name`), javaVersion.
 * @returns {string} Java source.
 */
export function renderDtoStub({ packageName, typeName, fields, javaVersion }) {
  const parsed = fields.map(field => {
    const match = /^(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(field.trim())
    if (!match) throw new Error(`DTO field must look like "Type name" (got ${JSON.stringify(field)})`)
    return { type: match[1].trim(), name: match[2] }
  })
  const header = [
    `package ${packageName};`,
    '',
    '/**',
    ` * Frozen data transfer object for the contract (minecraft-dev v0.12.0).`,
    ' */',
  ]
  if (javaVersion >= 16) {
    return [...header, `public record ${typeName}(${parsed.map(f => `${f.type} ${f.name}`).join(', ')}) {}`, ''].join('\n')
  }
  const fieldsBlock = parsed.map(f => `    private final ${f.type} ${f.name};`)
  const ctorArgs = parsed.map(f => `${f.type} ${f.name}`).join(', ')
  const assignments = parsed.map(f => `        this.${f.name} = ${f.name};`)
  const accessors = parsed.flatMap(f => [`    public ${f.type} ${f.name}() {`, `        return this.${f.name};`, '    }', ''])
  return [
    ...header,
    `public final class ${typeName} {`,
    ...fieldsBlock,
    '',
    `    public ${typeName}(${ctorArgs}) {`,
    ...assignments,
    '    }',
    '',
    ...accessors,
    '}',
    '',
  ].join('\n')
}

/**
 * Build the contract model and its stub sources without touching the filesystem.
 *
 * Kept pure so the tests can pin determinism (same input → same hash) and the
 * Java-8 rendering rule without creating a project on disk.
 * @param {object} input - platform, version, package, modules, allowlist, javaVersion, timestamp.
 * @returns {{ model: object, stubs: { file: string, content: string, fqn: string }[], warnings: string[] }} model and stubs.
 */
export function buildContractModel(input) {
  const {
    platform,
    minecraftVersion,
    packageName = 'mcdev.contract',
    modules,
    allowlist = { source: null, sha1: null, classes: [], count: 0 },
    javaVersion,
    eventPriority = {},
    generatedAt = new Date().toISOString(),
  } = input

  if (!SUPPORTED_PLATFORMS.includes(platform)) throw new Error(`unknown platform: ${platform}`)
  const lines = (PLATFORM_LINES[platform] ?? []).map(line => line.defaultMcVersion)
  if (!lines.includes(minecraftVersion)) {
    throw new Error(`unsupported ${platform} line ${minecraftVersion}; supported: ${lines.join(', ')}`)
  }
  const level = javaVersion ?? defaultJavaVersion(platform, minecraftVersion)
  const normalized = (Array.isArray(modules) ? modules : []).map(normalizeModule)
  if (normalized.length === 0) throw new Error('at least one module is required')
  const ids = new Set()
  for (const module of normalized) {
    if (ids.has(module.id)) throw new Error(`duplicate module id: ${module.id}`)
    ids.add(module.id)
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
    throw new Error(`invalid contract package: ${packageName}`)
  }

  const warnings = []
  if (allowlist.warning) warnings.push(allowlist.warning)
  const symbols = []
  const stubs = []
  const packagePath = packageName.split('.').join('/')

  for (const module of normalized) {
    const typeName = module.interfaceName ?? `${pascalCase(module.id)}Service`
    const content = renderInterfaceStub({ packageName, typeName, moduleId: module.id, methods: module.methods, threadModel: module.threadModel, doc: module.doc })
    const fqn = `${packageName}.${typeName}`
    stubs.push({ file: `${packagePath}/${javaFileName(typeName)}`, content, fqn })
    symbols.push({ kind: 'interface', fqn, module: module.id, threadModel: module.threadModel, methods: module.methods })
    for (const dto of module.dto) {
      const dtoName = pascalCase(dto.name)
      const dtoContent = renderDtoStub({ packageName, typeName: dtoName, fields: dto.fields, javaVersion: level })
      const dtoFqn = `${packageName}.${dtoName}`
      stubs.push({ file: `${packagePath}/${javaFileName(dtoName)}`, content: dtoContent, fqn: dtoFqn })
      symbols.push({ kind: 'record', fqn: dtoFqn, module: module.id, fields: dto.fields })
    }
  }

  const configKeys = [...new Set(normalized.flatMap(module => module.configKeys))].sort()
  const permissionNodes = [...new Set(normalized.flatMap(module => module.permissions))].sort()

  const model = {
    version: CONTRACT_VERSION,
    platform,
    minecraftVersion,
    javaVersion: level,
    packageName,
    generatedAt,
    modules: normalized.map(module => ({
      id: module.id,
      interface: `${packageName}.${module.interfaceName ?? `${pascalCase(module.id)}Service`}`,
      methods: module.methods,
      dto: module.dto.map(dto => `${packageName}.${pascalCase(dto.name)}`),
    })),
    symbols,
    constants: { configKeys, permissionNodes },
    eventPriority,
    apiAllowlist: { source: allowlist.source, sha1: allowlist.sha1, count: allowlist.count },
  }
  return { model, stubs, warnings }
}

/**
 * Remove the stubs a previous freeze generated, so a re-freeze with different
 * modules cannot leave an orphan interface (e.g. `ServiceService.java`) behind.
 * @param {string} projectDir - absolute project root.
 * @param {object} previous - the previous contract model.
 */
export function cleanupStubs(projectDir, previous) {
  const packageName = previous?.packageName
  if (!packageName) return
  const packagePath = packageName.split('.').join('/')
  const removed = []
  for (const symbol of previous.symbols ?? []) {
    const simple = String(symbol.fqn).split('.').pop()
    for (const target of [
      join(projectDir, '.mcdev', 'contract', packagePath, `${simple}.java`),
      join(projectDir, 'src', 'main', 'java', packagePath, `${simple}.java`),
    ]) {
      if (existsSync(target)) {
        unlinkSync(target)
        removed.push(target)
      }
    }
  }
  return removed
}

/**
 * Freeze the contract into `<project>/.mcdev/contract/`.
 * @param {object} options - projectDir plus everything {@link buildContractModel} takes, and `force`.
 * @returns {{ contractFile: string, stubCount: number, allowlistCount: number, contractHash: string, warnings: string[] }} summary.
 */
export function freezeContract(options) {
  const { projectDir, force = false } = options
  if (!projectDir) throw new Error('projectDir is required')
  const paths = arbitrationPaths(projectDir)
  if (existsSync(paths.contractFile) && !force) {
    const error = new Error(`contract already frozen at ${paths.contractFile}; pass force=true to replace it`)
    error.code = 'E_CONTRACT_EXISTS'
    throw error
  }
  const allowlist = options.allowlist ?? loadApiAllowlist({
    platform: options.platform,
    minecraftVersion: options.minecraftVersion,
    repoRoot: options.repoRoot ?? REPO,
    indexPath: options.indexPath,
    extraAllowlist: options.extraAllowlist,
  })
  const previous = existsSync(paths.contractFile) ? JSON.parse(readFileSync(paths.contractFile, 'utf8')) : null
  if (previous && force) cleanupStubs(projectDir, previous)
  const { model, stubs, warnings } = buildContractModel({ ...options, allowlist })
  model.apiAllowlist.partial = allowlist.partial === true
  if (options.allowlistNote) model.apiAllowlist.note = String(options.allowlistNote)
  ensureArbitrationLayout(projectDir)
  ensureDir(join(paths.contractDir, ...model.packageName.split('.')))
  // The canonical copy lives under .mcdev (diffable, one owner), and a mirror
  // goes into the compile source set: a shard cannot implement an interface that
  // javac never sees, and a superagent worktree needs the same files present.
  const mirrored = []
  for (const stub of stubs) {
    const target = resolveInside(projectDir, '.mcdev', 'contract', stub.file)
    ensureDir(join(target, '..'))
    writeFileSync(target, stub.content, 'utf8')
    const mirror = resolveInside(projectDir, 'src', 'main', 'java', stub.file)
    ensureDir(join(mirror, '..'))
    if (!existsSync(mirror) || readFileSync(mirror, 'utf8') !== stub.content) writeFileSync(mirror, stub.content, 'utf8')
    mirrored.push(relative(projectDir, mirror).split('\\').join('/'))
  }
  writeFileSync(paths.contractFile, `${JSON.stringify(model, null, 2)}\n`, 'utf8')
  writeFileSync(
    paths.allowlistFile,
    `${JSON.stringify({ source: model.apiAllowlist.source, sha1: model.apiAllowlist.sha1, count: model.apiAllowlist.count, partial: model.apiAllowlist.partial, note: model.apiAllowlist.note, classes: allowlist.classes }, null, 2)}\n`,
    'utf8',
  )
  return {
    contractFile: paths.contractFile,
    stubCount: stubs.length,
    mirrored,
    allowlistCount: allowlist.count,
    contractHash: hashOf(model),
    warnings,
  }
}

/**
 * Read the frozen contract.
 * @param {string} projectDir - absolute project root.
 * @returns {object} parsed contract.
 */
export function readContract(projectDir) {
  const paths = arbitrationPaths(projectDir)
  if (!existsSync(paths.contractFile)) {
    const error = new Error(`no frozen contract under ${paths.root}; run action=freeze first`)
    error.code = CONTRACT_MISSING
    throw error
  }
  return JSON.parse(readFileSync(paths.contractFile, 'utf8'))
}

/**
 * Read the allowlist as a Set (audit hot path).
 * @param {string} projectDir - absolute project root.
 * @returns {Set<string>} allowed class names (empty when the index was missing).
 */
export function readAllowlist(projectDir) {
  const paths = arbitrationPaths(projectDir)
  if (!existsSync(paths.allowlistFile)) return new Set()
  const parsed = JSON.parse(readFileSync(paths.allowlistFile, 'utf8'))
  return new Set(Array.isArray(parsed.classes) ? parsed.classes : [])
}

