/**
 * Stage 3 of the sharded pipeline: **the deterministic merge (L1)**.
 *
 * Shards never touch shared files, so somebody has to apply their manifests:
 * dependencies into the build script, commands/permissions into `plugin.yml`,
 * lifecycle statements into the entry class, and mod metadata into
 * `fabric.mod.json` / `mcmod.info`. That is this module, and it only ever
 * inserts at the anchors the templates carry — no rewriting, no guessing.
 *
 * Conflicts are reported, never resolved by force:
 * - two shards owning the same file aborts the whole merge (the protocol's one
 *   hard rule);
 * - two shards declaring the same command keeps the first and reports it;
 * - two shards declaring different defaults for one permission node reports it.
 *
 * @module minecraft-dev/lib/arbitration/merge
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { arbitrationPaths, ensureDir, resolveRelative } from './paths.js'
import { readContract } from './contract.js'
import { MANIFEST_NAME, crossValidate, normalizeManifest, validateManifest } from './manifest.js'
import { dialectOf, hasDependencyAnchor, injectDependencies } from './parse-gradle.js'
import { hasPluginYmlAnchors, mergePluginYml } from './parse-plugin-yml.js'

/** Anchor for lifecycle statements inside the entry class. */
export const INIT_ANCHOR = '// [mc:init]'

/** Anchor for teardown statements inside the entry class. */
export const SHUTDOWN_ANCHOR = '// [mc:shutdown]'

/** Anchor for the main-class fields the shards need. */
export const FIELDS_ANCHOR = '// [mc:fields]'

/** Platforms whose metadata is `plugin.yml`. */
const PLUGIN_YML_PLATFORMS = new Set(['paper', 'spigot'])

/** Entry-class detection per platform family. */
const ENTRY_PATTERNS = {
  paper: /extends\s+JavaPlugin\b/,
  spigot: /extends\s+JavaPlugin\b/,
  fabric: /implements\s+[^{]*\b(?:ModInitializer|DedicatedServerModInitializer)\b/,
  forge: /@Mod\s*\(/,
  neoforge: /@Mod\s*\(/,
}

/**
 * Find the project's entry class (the file the statements are injected into).
 *
 * The merge runs on arbitrary projects, including hand-written ones, so it
 * discovers the entry point by its platform idiom instead of assuming the
 * scaffold's file name.
 * @param {string} projectDir - absolute project root.
 * @param {string} platform - platform key from `lib/versions.js`.
 * @returns {string|undefined} project-relative POSIX path of the entry file.
 */
export function findEntryFile(projectDir, platform) {
  const pattern = ENTRY_PATTERNS[platform]
  if (!pattern) return undefined
  const root = join(projectDir, 'src', 'main', 'java')
  if (!existsSync(root)) return undefined
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.java')) continue
      if (pattern.test(readFileSync(full, 'utf8'))) found.push(full)
    }
  }
  walk(root)
  if (found.length === 0) return undefined
  found.sort()
  return relative(projectDir, found[0]).split('\\').join('/')
}

/**
 * Insert single-line statements after an anchor comment.
 * @param {object} options - content, anchor, statements.
 * @returns {{ content: string, inserted: number, found: boolean }} result.
 */
export function injectStatements({ content, anchor, statements }) {
  const lines = String(content).split(/\r?\n/)
  const index = lines.findIndex(line => line.trim() === anchor)
  if (index < 0) return { content: String(content), inserted: 0, found: false }
  const indent = `${/^(\s*)/.exec(lines[index])[1]}    `
  const normalize = text => String(text).replace(/\s+/g, ' ').trim().replace(/;$/, '')
  const present = new Set(lines.map(line => normalize(line)))
  // Re-running the merge must not duplicate the statements it injected last time.
  const additions = statements
    .filter(statement => !present.has(normalize(statement)))
    .map(statement => `${indent}${statement}`)
  lines.splice(index + 1, 0, ...additions)
  return { content: lines.join('\n'), inserted: additions.length, found: true }
}

/**
 * Merge one JSON metadata document (`fabric.mod.json`, `mcmod.info`).
 *
 * Objects merge recursively, arrays concatenate with duplicates removed, and a
 * scalar from the shard replaces the existing one. That covers the useful cases
 * (entrypoints, depends, authors) without pretending to know mod semantics.
 * @param {object} base - existing parsed JSON.
 * @param {object} patch - shard-provided `modMetadata`.
 * @returns {object} merged document.
 */
export function mergeJsonMetadata(base, patch) {
  const merge = (left, right) => {
    if (Array.isArray(left) && Array.isArray(right)) return [...new Set([...left, ...right])]
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const out = { ...left }
      for (const [key, value] of Object.entries(right)) out[key] = key in out ? merge(out[key], value) : value
      return out
    }
    return right
  }
  return merge(base, patch)
}

/** Pick the build script at the project root. */
export function findBuildScript(projectDir) {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const path = join(projectDir, name)
    if (existsSync(path)) return name
  }
  return undefined
}

/** Pick the metadata file for a platform. */
export function findMetadataFile(projectDir, platform) {
  const resources = join(projectDir, 'src', 'main', 'resources')
  const candidates = platform === 'fabric' ? ['fabric.mod.json'] : platform === 'forge' ? ['mcmod.info', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'] : []
  for (const name of candidates) {
    const path = join(resources, ...name.split('/'))
    if (existsSync(path)) return { path, kind: name.endsWith('.json') ? 'json' : 'toml' }
  }
  return undefined
}

/**
 * Merge every shard manifest into the project.
 * @param {object} options - projectDir, dryRun.
 * @returns {object} merge report: `{ ok, aborted?, written, skipped, conflicts, errors, report }`.
 */
export function mergeProject({ projectDir, dryRun = false }) {
  const contract = readContract(projectDir)
  const paths = arbitrationPaths(projectDir)
  const errors = []
  const shardEntries = []

  if (existsSync(paths.shardsDir)) {
    for (const shardId of readdirSync(paths.shardsDir).sort()) {
      const manifestPath = join(paths.shardsDir, shardId, MANIFEST_NAME)
      if (!existsSync(manifestPath)) { errors.push({ shard: shardId, error: 'missing-manifest' }); continue }
      let raw
      try { raw = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) {
        errors.push({ shard: shardId, error: `invalid-json: ${error.message}` })
        continue
      }
      const verdict = validateManifest(raw, { contract })
      if (!verdict.ok) { errors.push({ shard: shardId, error: 'invalid-manifest', details: verdict.errors }); continue }
      shardEntries.push({ shardId: verdict.value.shardId, manifest: verdict.value, dir: shardId })
    }
  }

  const conflicts = crossValidate(shardEntries.map(entry => ({ shardId: entry.shardId, manifest: entry.manifest })))
  if (conflicts.ownedFiles.length > 0) {
    return { ok: false, aborted: 'ownership-conflict', written: [], skipped: [], conflicts, errors, report: renderReport({ aborted: 'ownership-conflict', conflicts, errors, written: [], skipped: [] }) }
  }

  // Combined registrations: first shard wins, duplicates reported by crossValidate.
  const commandByName = new Map()
  const permissionByNode = new Map()
  const dependencies = []
  const dependencyKeys = new Set()
  const init = []
  const shutdown = []
  const modMetadata = {}

  for (const entry of shardEntries) {
    const { manifest } = entry
    for (const command of manifest.bukkitRegistrations.commands) if (!commandByName.has(command.name)) commandByName.set(command.name, command)
    for (const permission of manifest.bukkitRegistrations.permissions) if (!permissionByNode.has(permission.node)) permissionByNode.set(permission.node, permission)
    for (const dep of manifest.mavenDependencies) {
      const key = `${dep.group}:${dep.name}:${dep.version}:${dep.scope}`
      if (dependencyKeys.has(key)) continue
      dependencyKeys.add(key)
      dependencies.push(dep)
    }
    const priority = manifest.lifecycleHooks.onEnablePriority
    for (const statement of manifest.lifecycleHooks.initStatements) init.push({ shardId: entry.shardId, priority, statement })
    for (const statement of manifest.lifecycleHooks.onDisableStatements) shutdown.push({ shardId: entry.shardId, priority, statement })
    Object.assign(modMetadata, mergeJsonMetadata(modMetadata, manifest.modMetadata ?? {}))
  }

  init.sort((a, b) => a.priority - b.priority || a.shardId.localeCompare(b.shardId))
  // Teardown runs in reverse: what initialized last is disposed first.
  shutdown.sort((a, b) => b.priority - a.priority || b.shardId.localeCompare(a.shardId))

  const written = []
  const skipped = []
  const notes = []
  const pending = []

  const buildScript = findBuildScript(projectDir)
  if (buildScript) {
    const buildPath = join(projectDir, buildScript)
    const content = readFileSync(buildPath, 'utf8')
    if (dependencies.length > 0) {
      const result = injectDependencies({ content, dialect: dialectOf(buildScript), dependencies })
      if (!result.anchor) skipped.push({ file: buildScript, reason: 'missing-anchor', anchor: '// [mc:dependencies]' })
      else {
        pending.push({ path: buildPath, content: result.content })
        if (result.inserted.length > 0) written.push({ file: buildScript, action: 'dependencies', count: result.inserted.length })
      }
    }
  } else {
    notes.push('no build script at the project root; dependency merge skipped')
  }

  if (PLUGIN_YML_PLATFORMS.has(contract.platform)) {
    const ymlPath = join(projectDir, 'src', 'main', 'resources', 'plugin.yml')
    if (existsSync(ymlPath)) {
      const content = readFileSync(ymlPath, 'utf8')
      if (!hasPluginYmlAnchors(content)) skipped.push({ file: 'src/main/resources/plugin.yml', reason: 'missing-anchor', anchor: '# [mc:commands] / # [mc:permissions]' })
      else {
        const result = mergePluginYml({
          content,
          commands: [...commandByName.values()],
          permissions: [...permissionByNode.values()],
        })
        pending.push({ path: ymlPath, content: result.content })
        if (result.commands > 0 || result.permissions > 0) {
          written.push({ file: 'src/main/resources/plugin.yml', action: 'commands/permissions', count: result.commands + result.permissions })
        }
      }
    } else {
      skipped.push({ file: 'src/main/resources/plugin.yml', reason: 'file-missing' })
    }
  }

  const entry = findEntryFile(projectDir, contract.platform)
  if (!entry) {
    errors.push({ shard: '-', error: 'entry-class-not-found', platform: contract.platform })
  } else {
    const entryPath = resolveRelative(projectDir, entry)
    let content = readFileSync(entryPath, 'utf8')
    const initResult = injectStatements({ content, anchor: INIT_ANCHOR, statements: init.map(item => item.statement) })
    if (!initResult.found) skipped.push({ file: entry, reason: 'missing-anchor', anchor: INIT_ANCHOR })
    content = initResult.content
    const shutdownResult = injectStatements({ content, anchor: SHUTDOWN_ANCHOR, statements: shutdown.map(item => item.statement) })
    if (!shutdownResult.found) skipped.push({ file: entry, reason: 'missing-anchor', anchor: SHUTDOWN_ANCHOR })
    content = shutdownResult.content
    pending.push({ path: entryPath, content })
    if (initResult.inserted + shutdownResult.inserted > 0) {
      written.push({ file: entry, action: 'lifecycle', count: initResult.inserted + shutdownResult.inserted })
    }
  }

  // Main-class fields: declared by the shards, injected once, deduplicated by name.
  const fields = []
  for (const entry of shardEntries) for (const field of entry.manifest.mainClassFields ?? []) if (!fields.some(existing => existing.name === field.name)) fields.push(field)
  if (fields.length > 0 && entry) {
    const entryPath = resolveRelative(projectDir, entry)
    // The lifecycle stage above may already have a pending write for the entry
    // class. Build on that copy: reading the pre-merge file instead would make
    // this write silently discard the lifecycle statements injected above.
    const pendingEntry = pending.find(item => item.path === entryPath)
    const content = pendingEntry ? pendingEntry.content : readFileSync(entryPath, 'utf8')
    const existing = new Set([...content.matchAll(/\b(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?[\w$.<>\[\]]+\s+([a-z][A-Za-z0-9_]*)\s*;/g)].map(match => match[1]))
    const missing = fields.filter(field => !existing.has(field.name))
    const lines = content.split(/\r?\n/)
    const index = lines.findIndex(line => line.trim() === FIELDS_ANCHOR)
    if (index < 0) skipped.push({ file: entry, reason: 'missing-anchor', anchor: FIELDS_ANCHOR })
    else if (missing.length > 0) {
      const indent = `${/^(\s*)/.exec(lines[index])[1]}`
      lines.splice(index + 1, 0, ...missing.map(field => `${indent}private ${field.type} ${field.name};`))
      // A dotted type is a fully-qualified name: import it, or the field cannot compile.
      const imports = new Set([...content.matchAll(/^import\s+([\w$.]+)\s*;/gm)].map(match => match[1]))
      // A simple type name may live in the contract package (the frozen stubs);
      // resolve it against that package before assuming same-package or JDK.
      const contractTypes = new Set((contract.symbols ?? []).map(symbol => symbol.fqn))
      const resolveType = rawType => {
        const base = rawType.replace(/<.*$/, '').trim()
        if (base.includes('.')) return base
        const candidate = `${contract.packageName}.${base}`
        return contractTypes.has(candidate) ? candidate : null
      }
      const needed = missing
        .map(field => resolveType(field.type))
        .filter(type => type && !imports.has(type))
        .map(type => `import ${type};`)
      if (needed.length > 0) {
        const packageLine = lines.findIndex(line => /^\s*package\s/.test(line))
        const lastImport = lines.reduce((last, line, at) => (/^\s*import\s/.test(line) ? at : last), packageLine)
        const insertAt = lastImport >= 0 ? lastImport + 1 : packageLine + 1
        lines.splice(insertAt, 0, ...needed)
      }
      const next = { path: entryPath, content: lines.join('\n') }
      if (pendingEntry) pending[pending.indexOf(pendingEntry)] = next
      else pending.push(next)
      written.push({ file: entry, action: 'fields', count: missing.length })
    }
  }

  const metadata = findMetadataFile(projectDir, contract.platform)
  if (metadata && Object.keys(modMetadata).length > 0) {
    if (metadata.kind === 'json') {
      const merged = mergeJsonMetadata(JSON.parse(readFileSync(metadata.path, 'utf8')), modMetadata)
      pending.push({ path: metadata.path, content: `${JSON.stringify(merged, null, 2)}\n` })
      written.push({ file: relative(projectDir, metadata.path).split('\\').join('/'), action: 'metadata', count: Object.keys(modMetadata).length })
    } else {
      skipped.push({ file: relative(projectDir, metadata.path).split('\\').join('/'), reason: 'toml-merge-not-supported' })
    }
  }

  // A second merge must report nothing to write: identical content is not a change.
  const changed = []
  const unchanged = []
  for (const file of pending) {
    const existing = existsSync(file.path) ? readFileSync(file.path, 'utf8') : null
    if (existing === file.content) unchanged.push(relative(projectDir, file.path).split('\\').join('/'))
    else changed.push(file)
  }
  const changedPaths = new Set(changed.map(file => relative(projectDir, file.path).split('\\').join('/')))
  const writtenFinal = written.filter(item => changedPaths.has(item.file))

  let reportPath
  if (!dryRun) {
    for (const file of changed) {
      ensureDir(join(file.path, '..'))
      writeFileSync(file.path, file.content, 'utf8')
    }
    ensureDir(paths.reportsDir)
    reportPath = paths.mergeReport
    writeFileSync(reportPath, renderReport({ contract, written: writtenFinal, skipped, conflicts, errors, notes, unchanged, shards: shardEntries.map(entry => entry.shardId) }), 'utf8')
  }

  return {
    ok: errors.length === 0,
    dryRun,
    written: writtenFinal,
    unchanged,
    skipped,
    conflicts,
    errors,
    notes,
    planned: dryRun ? pending.map(file => relative(projectDir, file.path).split('\\').join('/')) : undefined,
    reportPath,
    report: renderReport({ contract, written: writtenFinal, skipped, conflicts, errors, notes, unchanged, shards: shardEntries.map(entry => entry.shardId) }),
  }
}

/** Render the human-readable merge report. */
export function renderReport({ contract, aborted, written = [], unchanged = [], skipped = [], conflicts = { ownedFiles: [], commands: [], permissions: [] }, errors = [], notes = [], shards = [] }) {
  const lines = ['# Merge report', '']
  if (contract) lines.push(`- contract: ${contract.platform} ${contract.minecraftVersion} (java ${contract.javaVersion})`, '')
  if (aborted) lines.push(`**ABORTED: ${aborted}** — no files were written.`, '')
  lines.push(`- shards merged: ${shards.length > 0 ? shards.join(', ') : '(none)'}`)
  lines.push(`- files written: ${written.length}`)
  lines.push(`- unchanged: ${unchanged.length}`)
  lines.push(`- skipped: ${skipped.length}`)
  lines.push(`- errors: ${errors.length}`, '')

  if (written.length > 0) {
    lines.push('## Written', '', '| file | action | count |', '|---|---|---|')
    for (const item of written) lines.push(`| ${item.file} | ${item.action} | ${item.count} |`)
    lines.push('')
  }
  if (conflicts.ownedFiles?.length > 0) {
    lines.push('## Conflicts: ownership', '', '| file | shards |', '|---|---|')
    for (const item of conflicts.ownedFiles) lines.push(`| ${item.file} | ${item.shards.join(', ')} |`)
    lines.push('')
  }
  if (conflicts.commands?.length > 0) {
    lines.push('## Conflicts: commands (first shard kept)', '', '| command | shards |', '|---|---|')
    for (const item of conflicts.commands) lines.push(`| ${item.name} | ${item.shards.join(', ')} |`)
    lines.push('')
  }
  if (conflicts.permissions?.length > 0) {
    lines.push('## Conflicts: permissions', '', '| node | shards | defaults |', '|---|---|---|')
    for (const item of conflicts.permissions) lines.push(`| ${item.node} | ${item.shards.join(', ')} | ${item.defaults.join(' vs ')} |`)
    lines.push('')
  }
  if (errors.length > 0) {
    lines.push('## Errors', '')
    for (const error of errors) lines.push(`- ${error.shard}: ${error.error}${error.details ? ` — ${JSON.stringify(error.details)}` : ''}`)
    lines.push('')
  }
  if (skipped.length > 0) {
    lines.push('## Skipped', '', '| file | reason | anchor |', '|---|---|---|')
    for (const item of skipped) lines.push(`| ${item.file} | ${item.reason} | ${item.anchor ?? ''} |`)
    lines.push('')
  }
  if (notes.length > 0) {
    lines.push('## Notes', '')
    for (const note of notes) lines.push(`- ${note}`)
    lines.push('')
  }
  return lines.join('\n')
}
