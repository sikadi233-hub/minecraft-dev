// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Stage 4 of the sharded pipeline: the **micro-auditor**.
 *
 * Every shard is checked before the merge touches shared files. The checks are
 * deliberately deterministic — eight high-confidence rules over the files the
 * shard declared — because a second model call per shard would cost as much as
 * the work it reviews, and because a reviewer that cannot be reproduced is not a
 * reviewer. When a rule fires, the finding names the file, the line and the
 * exact text that triggered it.
 *
 * The rules are narrow on purpose. `missing-event-cancel` is the clearest
 * example: "a cancellable event was not cancelled" is not a defect (most
 * handlers do not cancel), so this rule only fires on the real Bukkit trap —
 * cancelling at `MONITOR`, where the cancellation is ignored by design.
 *
 * @module minecraft-dev/lib/arbitration/audit
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths, ensureDir } from './paths.js'
import { readAllowlist, readContract } from './contract.js'
import { MANIFEST_NAME, validateManifest } from './manifest.js'
import { findEntryFile } from './merge.js'

/** Every rule the auditor can report. */
export const RULES = [
  { id: 'async-io-in-listener', severity: 'error', summary: 'blocking I/O inside an event handler runs on the server thread' },
  { id: 'missing-event-cancel', severity: 'error', summary: 'cancelling at MONITOR is ignored by Bukkit' },
  { id: 'event-priority-mismatch', severity: 'error', summary: 'handler priority differs from the frozen contract' },
  { id: 'import-outside-allowlist', severity: 'error', summary: 'import is not covered by the frozen API allowlist' },
  { id: 'write-outside-scope', severity: 'error', summary: 'shard wrote a file outside its declared ownership' },
  { id: 'main-class-touched', severity: 'error', summary: 'a shard may not own the entry class' },
  { id: 'scheduler-sync-blocking', severity: 'warning', summary: 'Bukkit calls inside an async task' },
  { id: 'missing-registration', severity: 'error', summary: 'a declared listener/command has no class in the shard' },
  { id: 'listener-not-a-listener', severity: 'error', summary: 'a class registered as a listener does not implement Listener' },
  { id: 'public-class-name-mismatch', severity: 'error', summary: 'the public type does not match its file name (javac would fail)' },
  { id: 'inventory-click-not-cancelled', severity: 'warning', summary: 'an inventory click handler never cancels (items can move)' },
  { id: 'command-executor-not-registered', severity: 'warning', summary: 'a declared command is never wired to its executor' },
  { id: 'repeating-task-not-cancelled', severity: 'warning', summary: 'a repeating task is scheduled but never cancelled on disable' },
  { id: 'config-key-undeclared', severity: 'warning', summary: 'a read config key is not in config.yml nor any manifest configDefaults' },
  { id: 'legacy-color-code-not-translated', severity: 'warning', summary: 'an ampersand colour code is used without a translator call' },
  { id: 'unfinished-todo', severity: 'warning', summary: 'the shard left a TODO/FIXME in code it owns' },
  { id: 'listener-declared-twice', severity: 'error', summary: 'two shards register the same listener (it fires twice)' },
  { id: 'duplicate-enable-priority', severity: 'warning', summary: 'two shards share an onEnablePriority, so their order is a tiebreak' },
  { id: 'init-order-violation', severity: 'warning', summary: 'a shard initializes a class owned by a shard that runs later' },
  { id: 'command-permission-unregistered', severity: 'warning', summary: 'a command requires a permission no shard declares' },
  { id: 'field-type-unresolved', severity: 'warning', summary: 'a main-class field type is not resolvable from the contract' },
]

/** Events whose handlers commonly cancel, used only for the MONITOR check. */
const CANCELLABLE_MARKERS = /setCancelled\s*\(\s*true\s*\)|setCancelled\s*\(\s*event\./i

/** Blocking calls that must not run inside an event handler. */
const BLOCKING_CALL = /\b(executeQuery|executeUpdate|executeBatch|getConnection|DriverManager|FileInputStream|FileOutputStream|Files\.(?:read|write|copy|lines)|Thread\.sleep|new\s+URL\s*\(|HttpClient)\b/

/** JDK and framework prefixes that never need the allowlist. */
const ALWAYS_ALLOWED = /^(?:java\.|javax\.|jdk\.|sun\.)/

/** Platform package prefixes used when the allowlist is missing (degraded mode). */
const PLATFORM_PREFIX = {
  paper: /^(?:org\.bukkit\.|io\.papermc\.|net\.kyori\.|com\.google\.gson\.)/,
  spigot: /^(?:org\.bukkit\.|net\.md_5\.|com\.google\.gson\.)/,
  fabric: /^(?:net\.fabricmc\.|net\.minecraft\.|org\.slf4j\.)/,
  forge: /^(?:net\.minecraftforge\.|net\.minecraft\.|org\.slf4j\.|cpw\.mods\.)/,
  neoforge: /^(?:net\.neoforged\.|net\.minecraft\.|org\.slf4j\.)/,
}

/** Line number (1-based) of a character offset. */
function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length
}

/** Index of the brace that closes the block opened at `openIndex`. */
export function matchingBrace(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Locate every `@EventHandler` method and its body.
 * @param {string} text - Java source.
 * @returns {{ start: number, bodyStart: number, bodyEnd: number, signature: string, annotation: string }[]} handlers.
 */
export function eventHandlers(text) {
  const handlers = []
  const pattern = /@EventHandler\b([^\n]*)\n?[\s\S]{0,200}?\bvoid\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  for (const match of text.matchAll(pattern)) {
    const bodyStart = match.index + match[0].length - 1
    const bodyEnd = matchingBrace(text, bodyStart)
    if (bodyEnd < 0) continue
    handlers.push({
      start: match.index,
      bodyStart,
      bodyEnd,
      annotation: match[1] ?? '',
      signature: match[3] ?? '',
    })
  }
  return handlers
}

/** Simple event type name from a handler parameter list (`PlayerJoinEvent event` → `PlayerJoinEvent`). */
export function eventTypeOf(signature) {
  const match = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+[A-Za-z_$][\w$]*\s*$/.exec(signature.trim())
  return match ? match[1].split('.').pop() : undefined
}

/** Priority declared in an annotation body, if any. */
export function priorityOf(annotation) {
  const match = /priority\s*=\s*(?:EventPriority\.)?([A-Z]+)/.exec(annotation)
  return match ? match[1] : undefined
}

/**
 * Flatten a minimal YAML document into dotted key paths (`a:` / `  b: 1` → `a.b`).
 * The generated config files are simple, and the audit only needs key names.
 * @param {string} text - YAML body.
 * @returns {string[]} dotted keys, parents included.
 */
export function flattenYamlKeys(text) {
  const keys = new Set()
  const stack = []
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    const indent = /^(\s*)/.exec(raw)[1].length
    const match = /^\s*([A-Za-z0-9_.-]+)\s*:/.exec(raw)
    if (!match) continue
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const path = [...stack.map(entry => entry.name), match[1]].join('.')
    keys.add(path)
    for (let i = 1; i < path.split('.').length; i += 1) keys.add(path.split('.').slice(0, i).join('.'))
    stack.push({ indent, name: match[1] })
  }
  return [...keys]
}

/**
 * Config keys the project actually declares: `config.yml` plus every shard's
 * `configDefaults`. A read of a key outside this set is a copy-paste bug.
 * @param {string} projectDir - absolute project root.
 * @returns {Set<string>} declared keys.
 */
export function collectDeclaredConfigKeys(projectDir) {
  const keys = new Set()
  const configPath = join(projectDir, 'src', 'main', 'resources', 'config.yml')
  if (existsSync(configPath)) for (const key of flattenYamlKeys(readFileSync(configPath, 'utf8'))) keys.add(key)
  const shardsDir = join(projectDir, '.mcdev', 'shards')
  if (existsSync(shardsDir)) {
    for (const shard of readdirSync(shardsDir)) {
      const manifestPath = join(shardsDir, shard, MANIFEST_NAME)
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        for (const key of Object.keys(manifest.configDefaults ?? {})) keys.add(key)
      } catch { /* ignore malformed manifests */ }
    }
  }
  return keys
}

/**
 * Run the rules for one shard.
 * @param {object} options - projectDir, shard id, contract, allowlist.
 * @returns {{ findings: object[], verdict: 'pass'|'warn'|'reject', counts: object }} findings.
 */
export function auditShard({ projectDir, shard, contract, allowlist }) {
  const paths = arbitrationPaths(projectDir)
  const manifestPath = join(paths.shardsDir, shard, MANIFEST_NAME)
  const findings = []
  const add = (ruleId, file, line, message, evidence) => {
    const rule = RULES.find(item => item.id === ruleId)
    findings.push({ ruleId, severity: rule?.severity ?? 'error', shard, file, line, message, evidence })
  }

  if (!existsSync(manifestPath)) {
    add('missing-registration', `${shard}/${MANIFEST_NAME}`, 0, 'shard has no RegistrationManifest.json')
    return { findings, verdict: 'reject', counts: { errors: 1, warnings: 0 } }
  }
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const verdict = validateManifest(raw, { contract })
  if (!verdict.ok) {
    for (const error of verdict.errors) add('missing-registration', `${shard}/${MANIFEST_NAME}`, 0, `invalid manifest: ${error.path} ${error.message}`)
    return { findings, verdict: 'reject', counts: { errors: findings.length, warnings: 0 } }
  }
  const manifest = verdict.value
  const scopePath = manifest.packageScope.split('.').join('/')
  const javaRoot = join(projectDir, 'src', 'main', 'java')

  // Disk truth for this shard's package scope.
  const scopeDir = join(javaRoot, ...scopePath.split('/'))
  const actualFiles = []
  if (existsSync(scopeDir)) {
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        actualFiles.push(full.split('\\').join('/'))
      }
    }
    walk(scopeDir)
  }
  const declared = new Set(manifest.ownedFiles.map(file => file.split('\\').join('/')))

  // write-outside-scope: files in the package that nobody declared, and declared files that do not exist.
  for (const file of actualFiles) {
    const relativePath = file.slice(projectDir.split('\\').join('/').length + 1)
    if (!relativePath.startsWith('src/main/java/')) continue
    if (!declared.has(relativePath)) add('write-outside-scope', relativePath, 1, 'file is inside the shard package but not listed in ownedFiles')
  }
  for (const file of declared) {
    const absolute = join(projectDir, ...file.split('/'))
    if (!existsSync(absolute)) add('missing-registration', file, 1, 'owned file listed in the manifest does not exist')
  }

  // main-class-touched
  const entry = findEntryFile(projectDir, contract.platform)
  if (entry && declared.has(entry)) add('main-class-touched', entry, 1, 'the entry class is a shared file; declare registrations in the manifest instead')

  // Source-level rules over the files the shard owns.
  const allowedImports = allowlist ?? new Set()
  const platformPrefix = PLATFORM_PREFIX[contract.platform]
  const sources = new Map()
  for (const file of declared) {
    const absolute = join(projectDir, ...file.split('/'))
    if (!existsSync(absolute) || !file.endsWith('.java')) continue
    const text = readFileSync(absolute, 'utf8')
    sources.set(file, text)

    // import-outside-allowlist
    for (const match of text.matchAll(/^import\s+(static\s+)?([A-Za-z_$][\w$.]*)\s*;/gm)) {
      const fqn = match[2]
      const line = lineOf(text, match.index)
      if (ALWAYS_ALLOWED.test(fqn)) continue
      if (fqn.startsWith(`${manifest.packageScope}.`) || fqn.startsWith(`${contract.packageName}.`)) continue
      if (allowedImports.size > 0) {
        if (!allowedImports.has(fqn)) {
          if (contract.apiAllowlist?.partial) {
            add('import-outside-allowlist', file, line, `import ${fqn} is not in the frozen allowlist (index is a truncated subset; verify with javap or the official docs)`, match[0])
            const finding = findings[findings.length - 1]
            finding.severity = 'warning'
          } else {
            add('import-outside-allowlist', file, line, `import ${fqn} is not in the frozen API allowlist`, match[0])
          }
        }
      } else if (platformPrefix && !platformPrefix.test(fqn)) {
        add('import-outside-allowlist', file, line, `import ${fqn} is outside the ${contract.platform} package allowlist (no API index)`, match[0])
      }
    }

    // Event handler rules.
    for (const handler of eventHandlers(text)) {
      const body = text.slice(handler.bodyStart, handler.bodyEnd + 1)
      const line = lineOf(text, handler.start)
      const type = eventTypeOf(handler.signature)
      const priority = priorityOf(handler.annotation)

      if (BLOCKING_CALL.test(body)) {
        add('async-io-in-listener', file, line, 'blocking I/O inside an @EventHandler runs on the main server thread', BLOCKING_CALL.exec(body)?.[0])
      }
      if (priority === 'MONITOR' && CANCELLABLE_MARKERS.test(body)) {
        add('missing-event-cancel', file, line, 'setCancelled at MONITOR is ignored: run the cancellation at an earlier priority', 'priority = MONITOR')
      }
      if (type && contract.eventPriority && Object.prototype.hasOwnProperty.call(contract.eventPriority, type)) {
        const expected = String(contract.eventPriority[type]).toUpperCase()
        if (priority && priority !== expected) {
          add('event-priority-mismatch', file, line, `contract pins ${type} to ${expected}, handler uses ${priority}`, `priority = ${priority}`)
        }
      }
      if (/runTaskAsynchronously/.test(body) && /\bBukkit\.|\bgetServer\s*\(|\bsendMessage\s*\(/.test(body)) {
        add('scheduler-sync-blocking', file, line, 'Bukkit API called inside an async task body', 'runTaskAsynchronously')
      }
    }

    if (/runTaskAsynchronously/.test(text) && /\bBukkit\.(?:get|broadcast)/.test(text)) {
      const index = text.indexOf('runTaskAsynchronously')
      add('scheduler-sync-blocking', file, lineOf(text, index), 'Bukkit API used in a class that schedules async tasks', 'runTaskAsynchronously')
    }
  }

  // Extended rules (0.12.9): each one is a fact about the shard's own files.
  const declaredKeys = collectDeclaredConfigKeys(projectDir)
  for (const [file, text] of sources) {
    // public-class-name-mismatch
    const publicType = /\bpublic\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(text)
    if (publicType && publicType[1] !== file.split('/').pop().replace(/\.java$/, '')) {
      add('public-class-name-mismatch', file, lineOf(text, publicType.index), `public type ${publicType[1]} must live in ${publicType[1]}.java`)
    }

    // inventory-click-not-cancelled
    for (const handler of eventHandlers(text)) {
      const type = eventTypeOf(handler.signature) ?? ''
      if (!/^(?:InventoryClickEvent|InventoryDragEvent)$/.test(type)) continue
      const body = text.slice(handler.bodyStart, handler.bodyEnd + 1)
      if (!/setCancelled\s*\(/.test(body)) {
        add('inventory-click-not-cancelled', file, lineOf(text, handler.start), `${type} handler never calls setCancelled: use the identity of the open panel and cancel unconditionally`)
      }
    }

    // repeating-task-not-cancelled
    if (/runTaskTimer\s*\(|scheduleSyncRepeatingTask\s*\(/.test(text) && !/\.cancel\s*\(|BukkitTask/.test(text)) {
      const at = text.search(/runTaskTimer\s*\(|scheduleSyncRepeatingTask\s*\(/)
      add('repeating-task-not-cancelled', file, lineOf(text, at), 'a repeating task is scheduled but the shard never cancels it')
    }

    // config-key-undeclared
    for (const match of text.matchAll(/getConfig\(\)\.get(?:String|Int|Boolean|Double|Long|List|StringList|ConfigurationSection)\s*\(\s*"([^"]+)"\s*\)/g)) {
      if (!declaredKeys.has(match[1])) {
        add('config-key-undeclared', file, lineOf(text, match.index), `config key "${match[1]}" is not declared in config.yml nor in any manifest configDefaults`)
      }
    }

    // legacy-color-code-not-translated
    if (/["']&[0-9a-fk-orA-FK-OR]/.test(text) && !/translateAlternateColorCodes|legacyAmpersand|LegacyComponentSerializer/.test(text)) {
      const at = text.search(/["']&[0-9a-fk-orA-FK-OR]/)
      add('legacy-color-code-not-translated', file, lineOf(text, at), 'an ampersand colour code will not render without a translator call')
    }

    // unfinished-todo
    const todo = /\/\/\s*(TODO|FIXME)/.exec(text)
    if (todo) add('unfinished-todo', file, lineOf(text, todo.index), `the shard left ${todo[1]} in code it owns`)
  }

  // listener-not-a-listener: a declared listener must implement Listener.
  for (const listener of manifest.bukkitRegistrations.listeners) {
    const simple = listener.split('.').pop()
    const entrySource = sources.get(manifest.ownedFiles.find(file => file.endsWith(`/${simple}.java`)))
    if (!entrySource) continue
    if (!/\bclass\s+[A-Za-z_$][\w$]*[^{]*\bimplements\b[^{]*\bListener\b/.test(entrySource)) {
      add('listener-not-a-listener', manifest.ownedFiles.find(file => file.endsWith(`/${simple}.java`)), 1, `${simple} is registered as a listener but does not implement Listener`)
    }
  }

  // command-executor-not-registered: a declared command needs a setExecutor wiring.
  for (const command of manifest.bukkitRegistrations.commands) {
    const statements = [...manifest.lifecycleHooks.initStatements, ...manifest.lifecycleHooks.onDisableStatements].join('\n')
    const wiredInStatements = /setExecutor\s*\(/.test(statements)
    const wiredInSource = [...sources.values()].some(text => /setExecutor\s*\(/.test(text))
    if (!wiredInStatements && !wiredInSource) {
      add('command-executor-not-registered', `${shard}/${MANIFEST_NAME}`, 0, `command "${command.name}" is declared but no setExecutor call exists in the shard or its init statements`)
    }
  }

  // missing-registration: declared classes must exist on disk.
  const ownedBases = new Set(manifest.ownedFiles.map(file => file.split('/').pop().replace(/\.java$/, '')))
  const declaredClasses = [
    ...manifest.bukkitRegistrations.listeners.map(fqn => ({ kind: 'listener', fqn })),
    ...manifest.bukkitRegistrations.commands.map(command => ({ kind: 'command', fqn: command.class })),
  ]
  for (const { kind, fqn } of declaredClasses) {
    const simple = fqn.split('.').pop()
    if (!ownedBases.has(simple)) add('missing-registration', `${shard}/${MANIFEST_NAME}`, 0, `declared ${kind} ${fqn} has no owned source file`)
  }

  const errors = findings.filter(finding => finding.severity === 'error').length
  const warnings = findings.length - errors
  return { findings, verdict: errors > 0 ? 'reject' : warnings > 0 ? 'warn' : 'pass', counts: { errors, warnings } }
}

/**
 * Cross-shard checks: facts that only exist once every manifest is on the table.
 *
 * A single shard can look perfect while the run is wrong — two shards handling
 * the same event, a shard initialising a class owned by a shard that has not run
 * yet, a command gated by a permission nobody declares. The merge cannot see
 * these (it is per-file) and the compiler cannot see them (they are all valid
 * Java), so they belong to the auditor.
 *
 * @param {object} options - projectDir and the frozen contract.
 * @returns {object[]} findings, attributed to the shard that should act.
 */
export function crossShardFindings({ projectDir, contract }) {
  const paths = arbitrationPaths(projectDir)
  const findings = []
  const add = (ruleId, shard, file, line, message, evidence) => {
    const rule = RULES.find(item => item.id === ruleId)
    findings.push({ ruleId, severity: rule?.severity ?? 'warning', shard, file, line, message, evidence })
  }
  if (!existsSync(paths.shardsDir)) return findings

  const entries = []
  for (const shard of readdirSync(paths.shardsDir).sort()) {
    const manifestPath = join(paths.shardsDir, shard, MANIFEST_NAME)
    if (!existsSync(manifestPath)) continue
    try {
      const verdict = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
      if (verdict.ok) entries.push({ shard, manifest: verdict.value })
    } catch { /* ignore malformed manifests; validateManifest reports them in the shard pass */ }
  }
  if (entries.length < 1) return findings
  const manifestFile = shard => `${shard}/${MANIFEST_NAME}`
  const priorityOf = shard => entries.find(entry => entry.shard === shard)?.manifest.lifecycleHooks.onEnablePriority ?? 50
  const packageOwner = new Map(entries.map(entry => [entry.manifest.packageScope, entry.shard]))
  const contractTypes = new Set((contract.symbols ?? []).map(symbol => symbol.fqn))

  // listener-declared-twice
  const listenerOwner = new Map()
  for (const { shard, manifest } of entries) {
    for (const listener of manifest.bukkitRegistrations.listeners) {
      if (listenerOwner.has(listener)) {
        add('listener-declared-twice', shard, manifestFile(shard), 0, `listener ${listener} is also declared by ${listenerOwner.get(listener)}; it will fire twice`, listener)
      } else listenerOwner.set(listener, shard)
    }
  }

  // duplicate-enable-priority
  const byPriority = new Map()
  for (const { shard, manifest } of entries) {
    const priority = manifest.lifecycleHooks.onEnablePriority
    if (!byPriority.has(priority)) byPriority.set(priority, [])
    byPriority.get(priority).push(shard)
  }
  for (const [priority, shards] of byPriority) {
    if (shards.length > 1) add('duplicate-enable-priority', shards[shards.length - 1], manifestFile(shards[shards.length - 1]), 0, `onEnablePriority ${priority} is shared by ${shards.join(', ')}; their order falls back to the shard id`, `priority = ${priority}`)
  }

  const permissions = new Set(entries.flatMap(entry => entry.manifest.bukkitRegistrations.permissions.map(permission => permission.node)))

  for (const { shard, manifest } of entries) {
    // init-order-violation: an init statement constructing a class from a later shard
    for (const statement of manifest.lifecycleHooks.initStatements) {
      const constructed = /new\s+([A-Za-z_$][\w$.]*)\s*\(/.exec(statement)
      if (!constructed) continue
      const owner = packageOwner.get(constructed[1].split('.').slice(0, -1).join('.'))
      if (owner && owner !== shard && priorityOf(owner) > manifest.lifecycleHooks.onEnablePriority) {
        add('init-order-violation', shard, manifestFile(shard), 0, `initializes ${constructed[1]} owned by ${owner} (priority ${priorityOf(owner)}) before it runs (${manifest.lifecycleHooks.onEnablePriority})`, statement)
      }
    }

    // command-permission-unregistered
    for (const command of manifest.bukkitRegistrations.commands) {
      if (command.permission && !permissions.has(command.permission)) {
        add('command-permission-unregistered', shard, manifestFile(shard), 0, `command "${command.name}" requires ${command.permission}, which no shard declares`, command.name)
      }
    }

    // field-type-unresolved
    for (const field of manifest.mainClassFields ?? []) {
      const base = field.type.replace(/<.*$/, '').trim()
      if (base.includes('.')) continue
      if (!contractTypes.has(`${contract.packageName}.${base}`)) {
        add('field-type-unresolved', shard, manifestFile(shard), 0, `field ${field.name} uses "${base}", which is not a contract type and not fully-qualified`, field.type)
      }
    }
  }
  return findings
}

/** Audit every shard, with the circuit breaker's attempt counter. */
export function auditProject({ projectDir, shard, maxRetries = 3 }) {
  const contract = readContract(projectDir)
  const allowlist = readAllowlist(projectDir)
  const paths = arbitrationPaths(projectDir)
  const shards = shard
    ? [shard]
    : existsSync(paths.shardsDir) ? readdirSync(paths.shardsDir).sort() : []
  if (shards.length === 0) return { shards: [], findings: [], verdict: 'pass', circuitOpen: false, attempts: {} }

  const results = []
  for (const name of shards) results.push({ shard: name, ...auditShard({ projectDir, shard: name, contract, allowlist }) })

  // Cross-shard facts only appear when every manifest is visible; attach each
  // finding to the shard that has to act, then recompute that shard's verdict.
  if (!shard) {
    for (const finding of crossShardFindings({ projectDir, contract })) {
      const target = results.find(result => result.shard === finding.shard)
      if (target) target.findings.push(finding)
    }
    for (const result of results) {
      const errors = result.findings.filter(finding => finding.severity === 'error').length
      const warnings = result.findings.length - errors
      result.counts = { errors, warnings }
      result.verdict = errors > 0 ? 'reject' : warnings > 0 ? 'warn' : 'pass'
    }
  }

  const attempts = readAttempts(projectDir)
  const allFindings = results.flatMap(result => result.findings)
  for (const result of results) attempts[result.shard] = result.verdict === 'pass' ? 0 : (attempts[result.shard] ?? 0) + 1
  writeAttempts(projectDir, attempts)

  const circuitOpen = results.some(result => result.verdict !== 'pass' && attempts[result.shard] >= maxRetries)
  const verdict = results.some(result => result.verdict === 'reject')
    ? 'reject'
    : results.some(result => result.verdict === 'warn') ? 'warn' : 'pass'
  return { shards: results, findings: allFindings, verdict, circuitOpen, attempts, maxRetries }
}

/** Path of the per-project audit attempt counter. */
export function attemptsPath(projectDir) {
  return join(arbitrationPaths(projectDir).reportsDir, 'audit-attempts.json')
}

/** Read the retry counters (empty when never audited). */
export function readAttempts(projectDir) {
  const path = attemptsPath(projectDir)
  if (!existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
}

/** Persist the retry counters. */
export function writeAttempts(projectDir, attempts) {
  const path = attemptsPath(projectDir)
  ensureDir(join(path, '..'))
  writeFileSync(path, `${JSON.stringify(attempts, null, 2)}\n`, 'utf8')
  return path
}
