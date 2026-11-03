/**
 * Stage 5 of the sharded pipeline: **compile errors, routed back to their shard**.
 *
 * The compiler is the only judge that cannot be argued with, and it already
 * knows which file is wrong. The expensive part of a failed build is not the
 * fix — it is the model re-reading the whole project to find out where the error
 * belongs. This module removes that step: it parses `javac`/Gradle output into
 * file/line/message, maps the file to the shard that owns it, and reports what
 * cannot be attributed instead of guessing.
 *
 * A second signal matters as much as the routing: when the same missing symbol
 * appears in most shards, the contract is wrong, not the shards. That is
 * reported as `contractCollapse` so the pipeline escalates instead of patching
 * N shards one by one.
 *
 * @module minecraft-dev/lib/arbitration/route
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths } from './paths.js'
import { MANIFEST_NAME, normalizeManifest, validateManifest } from './manifest.js'
import { readContract } from './contract.js'

/** `path:line: error: message` and the column variant javac also emits. */
const ERROR_LINE = /^(?<file>.+?\.java):(?<line>\d+):(?:(?<column>\d+):)?\s*(?:error|错误)\s*[:：]\s*(?<message>.*)$/i

/** Continuation lines javac prints under a `cannot find symbol` error. */
const SYMBOL_LINE = /^\s*symbol:\s*(?<kind>class|variable|method|interface|enum)\s+(?<symbol>[A-Za-z_$][\w$.]*)/

/**
 * Normalize a compiler path to a project-relative POSIX path.
 * @param {string} file - path from the compiler output.
 * @param {string} projectDir - absolute project root.
 * @returns {string} project-relative path when it can be derived, otherwise the input normalized.
 */
export function normalizePath(file, projectDir) {
  const posix = String(file).trim().replace(/\\/g, '/').replace(/^file:\/\//, '')
  const root = String(projectDir).replace(/\\/g, '/').replace(/\/+$/, '')
  const index = posix.indexOf(`${root}/`)
  if (index >= 0) return posix.slice(index + root.length + 1)
  const marker = posix.indexOf('src/main/')
  if (marker >= 0) return posix.slice(marker)
  return posix.replace(/^\/+/, '')
}

/**
 * Parse compiler output into structured errors.
 * @param {string} log - merged Gradle/javac output.
 * @param {string} [projectDir] - used to relativize paths.
 * @returns {{ errors: object[], unparsed: string[] }} parsed errors plus error-looking lines that were not understood.
 */
export function parseCompileErrors(log, projectDir = '') {
  const errors = []
  const unparsed = []
  const lines = String(log).split(/\r?\n/)
  let pending = null
  for (const line of lines) {
    const match = ERROR_LINE.exec(line.trim())
    if (match) {
      pending = {
        file: normalizePath(match.groups.file, projectDir),
        line: Number(match.groups.line),
        column: match.groups.column ? Number(match.groups.column) : undefined,
        message: match.groups.message.trim(),
        symbol: undefined,
      }
      errors.push(pending)
      continue
    }
    const symbol = SYMBOL_LINE.exec(line)
    if (symbol && pending) {
      pending.symbol = symbol.groups.symbol
      continue
    }
    if (/\berror\b|错误/i.test(line) && !/^\s*(?:\d+\s+errors?|FAILURE:|BUILD FAILED|> Task)/i.test(line)) {
      if (line.trim() !== '') unparsed.push(line.trim())
    }
  }
  return { errors, unparsed }
}

/**
 * Statements a shard asked the merge to inject, keyed by normalized text.
 * A compile error inside one of them belongs to that shard even though the error
 * sits in a shared file (the main class).
 * @param {string} projectDir - absolute project root.
 * @returns {Map<string, string>} normalized statement → shard.
 */
export function loadInjectedStatements(projectDir) {
  const paths = arbitrationPaths(projectDir)
  const map = new Map()
  if (!existsSync(paths.shardsDir)) return map
  const normalize = text => String(text).replace(/\s+/g, ' ').trim().replace(/;$/, '')
  for (const shard of readdirSync(paths.shardsDir).sort()) {
    const manifestPath = join(paths.shardsDir, shard, MANIFEST_NAME)
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const hooks = manifest.lifecycleHooks ?? {}
      for (const statement of [...(hooks.initStatements ?? []), ...(hooks.onDisableStatements ?? [])]) map.set(normalize(statement), shard)
    } catch { /* ignore malformed manifests */ }
  }
  return map
}

/** Load the shard ownership map: owned file → shard, package scope path → shard. */
export function loadOwnership(projectDir) {
  const paths = arbitrationPaths(projectDir)
  const byFile = new Map()
  const byScope = []
  if (!existsSync(paths.shardsDir)) return { byFile, byScope }
  for (const shard of readdirSync(paths.shardsDir).sort()) {
    const manifestPath = join(paths.shardsDir, shard, MANIFEST_NAME)
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      const verdict = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
      if (!verdict.ok) continue
      manifest = normalizeManifest(verdict.value)
    } catch { continue }
    for (const file of manifest.ownedFiles) byFile.set(file.replace(/\\/g, '/'), shard)
    byScope.push({ shard, scope: `src/main/java/${manifest.packageScope.split('.').join('/')}/` })
  }
  return { byFile, byScope }
}

/**
 * Route parsed errors to shards.
 * @param {object} options - projectDir, errors, shard count for the collapse heuristic.
 * @returns {object} routes plus unowned errors and the contract-collapse signal.
 */
export function routeErrors({ projectDir, errors }) {
  const { byFile, byScope } = loadOwnership(projectDir)
  const statements = loadInjectedStatements(projectDir)
  const normalize = text => String(text).replace(/\s+/g, ' ').trim().replace(/;$/, '')
  const sourceLine = (file, line) => {
    try {
      const absolute = join(projectDir, ...String(file).split('/'))
      if (!existsSync(absolute)) return undefined
      return readFileSync(absolute, 'utf8').split(/\r?\n/)[Number(line) - 1]
    } catch { return undefined }
  }
  const injectedFor = error => {
    const text = sourceLine(error.file, error.line)
    if (!text) return undefined
    const normalized = normalize(text)
    for (const [statement, shard] of statements) {
      if (normalized === statement || normalized.includes(statement)) return shard
    }
    return undefined
  }
  const routes = new Map()
  const unowned = []
  for (const error of errors) {
    let shard = byFile.get(error.file)
    if (!shard) shard = byScope.find(entry => error.file.startsWith(entry.scope))?.shard
    if (!shard) {
      // A shared file: the error may still be an injected statement's fault.
      const injected = injectedFor(error)
      if (injected) { shard = injected; error.origin = 'injected-statement' }
    }
    if (!shard) { unowned.push(error); continue }
    if (!routes.has(shard)) routes.set(shard, [])
    routes.get(shard).push(error)
  }

  // Contract collapse: one missing symbol that most shards cannot see is a
  // contract problem, not N independent mistakes.
  const symbolShards = new Map()
  for (const error of errors) {
    if (!error.symbol) continue
    if (!symbolShards.has(error.symbol)) symbolShards.set(error.symbol, new Set())
    const shard = byFile.get(error.file) ?? byScope.find(entry => error.file.startsWith(entry.scope))?.shard
    if (shard) symbolShards.get(error.symbol).add(shard)
  }
  const totalShards = new Set([...byFile.values(), ...byScope.map(entry => entry.shard)]).size
  let contractCollapse
  for (const [symbol, shards] of symbolShards) {
    if (shards.size >= 2 && totalShards > 0 && shards.size / totalShards >= 0.5) {
      contractCollapse = { symbol, shards: [...shards].sort(), ratio: Number((shards.size / totalShards).toFixed(2)) }
      break
    }
  }

  return {
    routes: [...routes.entries()].map(([shard, shardErrors]) => ({
      shard,
      count: shardErrors.length,
      errors: shardErrors,
      fixBrief: renderFixBrief(shard, shardErrors),
    })),
    unowned,
    contractCollapse,
    totalErrors: errors.length,
  }
}

/** One shard's repair brief, ready to hand back to that shard only. */
export function renderFixBrief(shard, errors) {
  const lines = [`# Fix brief for ${shard}`, '', `${errors.length} compiler error(s) belong to this shard:`, '']
  for (const error of errors.slice(0, 20)) {
    lines.push(`- ${error.file}:${error.line}${error.symbol ? ` (missing symbol ${error.symbol})` : ''}`)
    lines.push(`  - ${error.message}`)
  }
  if (errors.length > 20) lines.push(`- … ${errors.length - 20} more`)
  lines.push('', 'Fix only these files; do not change the frozen contract or shared files.')
  return `${lines.join('\n')}\n`
}

/**
 * Parse and route in one step, writing each shard's `compile-routes.json`.
 * @param {object} options - projectDir, compileLog, write (default false).
 * @returns {object} the routing result.
 */
export function routeCompileLog({ projectDir, compileLog, write = false }) {
  const contract = readContract(projectDir)
  const parsed = parseCompileErrors(compileLog, projectDir)
  const result = routeErrors({ projectDir, errors: parsed.errors })
  const output = { ...result, unparsed: parsed.unparsed, platform: contract.platform, minecraftVersion: contract.minecraftVersion }
  if (write && existsSync(arbitrationPaths(projectDir).shardsDir)) {
    for (const route of output.routes) {
      const target = join(arbitrationPaths(projectDir).shardsDir, route.shard, 'compile-routes.json')
      if (!existsSync(join(arbitrationPaths(projectDir).shardsDir, route.shard))) continue
      writeFileSync(target, `${JSON.stringify(route, null, 2)}\n`, 'utf8')
    }
  }
  return output
}
