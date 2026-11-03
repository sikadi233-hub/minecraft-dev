// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Pipeline state: what the run looks like right now, and what to hand upstream
 * when the pipeline cannot continue.
 *
 * `status` is the one place that answers "how far did we get": which shards have
 * a manifest, how many findings each still has, whether the circuit breaker
 * opened, which errors are unowned, and — since the engine is orchestrator
 * agnostic — whether a superagent is present to take the run over.
 *
 * `escalate` renders the materials an upstream orchestrator (the host agent today,
 * `dsh-superagent` when installed) needs to fix the contract instead of the
 * shards: the failing shards, the repeated symbol, the contract diff hints and
 * the exact files to re-run.
 *
 * @module minecraft-dev/lib/arbitration/status
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths, ensureDir, MCDEV_DIR } from './paths.js'
import { readContract } from './contract.js'
import { MANIFEST_NAME } from './manifest.js'
import { readAttempts } from './audit.js'

/** Read `.mcdev/memory.json` (the repeated-rule ledger). */
export function readMemory(projectDir) {
  const path = arbitrationPaths(projectDir).memoryFile
  if (!existsSync(path)) return { rules: {}, updatedAt: null }
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return { rules: {}, updatedAt: null } }
}

/**
 * Add audit findings to the ledger. Repeating a rule is the signal the next
 * brief should warn about it.
 * @param {string} projectDir - project root.
 * @param {{ ruleId: string }[]} findings - findings to record.
 * @returns {object} the updated ledger.
 */
export function recordMemory(projectDir, findings) {
  const memory = readMemory(projectDir)
  for (const finding of findings) memory.rules[finding.ruleId] = (memory.rules[finding.ruleId] ?? 0) + 1
  memory.updatedAt = new Date().toISOString()
  const path = arbitrationPaths(projectDir).memoryFile
  ensureDir(join(path, '..'))
  writeFileSync(path, `${JSON.stringify(memory, null, 2)}\n`, 'utf8')
  return memory
}

/**
 * Detect the orchestrator driving this project.
 *
 * `dsh-superagent` publishes an `orchestrator` service; the probe must never
 * throw (the plugin has no peer on it), so anything unexpected reads as `host`.
 * @param {object} [ctx] - plugin context.
 * @returns {'dsh-superagent'|'host'} orchestrator name.
 */
export function detectOrchestrator(ctx) {
  try {
    return ctx?.get?.('orchestrator') ? 'dsh-superagent' : 'host'
  } catch {
    return 'host'
  }
}

/**
 * Collect the run status.
 * @param {object} options - projectDir, orchestrator name.
 * @returns {object} status document.
 */
export function collectStatus({ projectDir, orchestrator = 'host' }) {
  const contract = readContract(projectDir)
  const paths = arbitrationPaths(projectDir)
  const attempts = readAttempts(projectDir)
  const memory = readMemory(projectDir)
  const shardIds = existsSync(paths.shardsDir) ? readdirSync(paths.shardsDir).sort() : []
  const shards = (contract.modules ?? []).map(module => {
    const dir = join(paths.shardsDir, module.id)
    const options = { id: module.id, dir: existsSync(dir) ? dir : null, hasManifest: false, hasBrief: false, ownedFiles: 0, findings: null, attempts: attempts[module.id] ?? 0, routes: 0 }
    if (options.dir) {
      options.hasManifest = existsSync(join(dir, MANIFEST_NAME))
      options.hasBrief = existsSync(join(dir, 'BRIEF.md'))
      if (options.hasManifest) {
        try {
          const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8'))
          options.ownedFiles = Array.isArray(manifest.ownedFiles) ? manifest.ownedFiles.length : 0
        } catch { options.ownedFiles = -1 }
      }
      const findingsPath = join(dir, 'audit-findings.json')
      if (existsSync(findingsPath)) {
        try {
          const findings = JSON.parse(readFileSync(findingsPath, 'utf8'))
          options.findings = Array.isArray(findings) ? findings.length : null
        } catch { options.findings = null }
      }
      const routesPath = join(dir, 'compile-routes.json')
      if (existsSync(routesPath)) {
        try {
          options.routes = (JSON.parse(readFileSync(routesPath, 'utf8')).errors ?? []).length
        } catch { options.routes = -1 }
      }
    }
    return options
  })
  const unknowns = shardIds.filter(id => !(contract.modules ?? []).some(module => module.id === id))
  const reportPath = paths.statusFile
  const status = {
    project: paths.projectDir,
    mdevDir: join(paths.projectDir, MCDEV_DIR),
    platform: contract.platform,
    minecraftVersion: contract.minecraftVersion,
    javaVersion: contract.javaVersion,
    contractModules: (contract.modules ?? []).length,
    orchestrator,
    shards,
    extraShardDirectories: unknowns,
    memory,
    generatedAt: new Date().toISOString(),
  }
  ensureDir(paths.reportsDir)
  writeFileSync(reportPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
  return { ...status, reportPath }
}

/** Render a short status table for the tool card. */
export function renderStatus(status) {
  const lines = [
    `${status.platform} ${status.minecraftVersion} · java ${status.javaVersion} · orchestrator: ${status.orchestrator}`,
    '',
    '| shard | brief | manifest | files | findings | retries | routes (current) |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const shard of status.shards) {
    lines.push(`| ${shard.id} | ${shard.hasBrief ? 'yes' : '-'} | ${shard.hasManifest ? 'yes' : '-'} | ${shard.ownedFiles} | ${shard.findings ?? '-'} | ${shard.attempts} | ${shard.routes || '-'} |`)
  }
  const rules = Object.entries(status.memory?.rules ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (rules.length > 0) lines.push('', `Repeated rules: ${rules.map(([id, count]) => `${id}×${count}`).join(', ')}`)
  return lines.join('\n')
}

/**
 * Build the escalation document for an orchestrator.
 * @param {object} options - projectDir, reason, findings, unowned, contractCollapse.
 * @returns {{ path: string, markdown: string }} escalation material.
 */
export function buildEscalation({ projectDir, reason, findings = [], unowned = [], contractCollapse, attempts = {} }) {
  const contract = readContract(projectDir)
  const lines = [
    '# Escalation: the contract needs a decision, not another shard retry',
    '',
    `- project: ${projectDir}`,
    `- platform: ${contract.platform} ${contract.minecraftVersion} (java ${contract.javaVersion})`,
    `- reason: ${reason}`,
    `- contract hash: ${JSON.stringify(contract.modules?.map(module => module.id) ?? [])}`,
    '',
    '## What failed',
    '',
  ]
  if (contractCollapse) {
    lines.push(`- repeated missing symbol \`${contractCollapse.symbol}\` in ${contractCollapse.shards.length} shards (${Math.round(contractCollapse.ratio * 100)}% of the run)`)
    lines.push('- interpretation: the frozen contract does not declare this symbol; fix the contract, then re-run only the affected shards')
  }
  if (findings.length > 0) {
    lines.push('', '| shard | rule | file:line |', '|---|---|---|')
    for (const finding of findings.slice(0, 20)) lines.push(`| ${finding.shard} | ${finding.ruleId} | ${finding.file}:${finding.line} |`)
  }
  if (unowned.length > 0) {
    lines.push('', `- ${unowned.length} compile error(s) belong to no shard; they are in shared files and need the host to assign an owner`)
  }
  if (Object.keys(attempts).length > 0) {
    lines.push('', `- retry counters: ${Object.entries(attempts).map(([shard, count]) => `${shard}=${count}`).join(', ')}`)
  }
  lines.push(
    '',
    '## What the upstream should do',
    '',
    '1. Amend the frozen contract (add the missing type / change the thread model).',
    '2. Re-run `freeze` with `force: true` to write contract v1.1.',
    '3. Re-run `brief` + the affected shards only; untouched shards keep their code.',
    '4. Resume `merge` → `mc_gradle build` → `route`.',
  )
  const path = arbitrationPaths(projectDir).diffReport
  ensureDir(join(path, '..'))
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
  return { path, markdown: `${lines.join('\n')}\n` }
}
