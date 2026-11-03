/**
 * The `mc_arbitrate` command surface.
 *
 * One tool with seven actions instead of seven tools: the actions share one
 * mental model (a project's `.mcdev/` directory), and a single entry point keeps
 * the model's tool budget small. Everything here is a thin dispatch over
 * deterministic modules — no action calls a model, and each returns the same
 * output shape so the card and the follow-up calls are predictable.
 *
 * @module minecraft-dev/lib/arbitration/tool
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths, ensureDir } from './paths.js'
import { freezeContract, readContract } from './contract.js'
import { buildBrief, prefixFingerprints } from './brief.js'
import { mergeProject } from './merge.js'
import { auditProject, readAttempts } from './audit.js'
import { routeCompileLog } from './route.js'
import { buildEscalation, collectStatus, detectOrchestrator, recordMemory, renderStatus } from './status.js'
import { MANIFEST_NAME } from './manifest.js'
import { readTimings, recordTiming, renderTimings, summarizeTimings } from './timing.js'

/** The seven actions the tool exposes. */
export const ACTIONS = ['freeze', 'brief', 'audit', 'merge', 'route', 'escalate', 'status']

/** Actions that need a frozen contract. */
const NEEDS_CONTRACT = new Set(['brief', 'audit', 'merge', 'route', 'escalate', 'status'])

/**
 * Run one arbitration action.
 * @param {object} args - tool arguments (action, projectDir, and the action's own fields).
 * @param {object} [options] - plugin context and config.
 * @returns {Promise<object>} the tool result.
 */
export async function arbitrate(args, options = {}) {
  const startedAt = process.hrtime.bigint()
  const result = await arbitrateInner(args, options)
  try {
    recordTiming(args?.projectDir, {
      action: result?.action ?? String(args?.action),
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      ...(args?.shard ? { shard: String(args.shard) } : {}),
    })
  } catch { /* timing must never break an action */ }
  return result
}

/** The action dispatch; `arbitrate` adds the timing record around it. */
async function arbitrateInner(args, options = {}) {
  const { ctx, config = {} } = options
  const action = args.action
  const projectDir = args.projectDir
  if (!ACTIONS.includes(action)) throw new Error(`unknown action ${action}; expected one of ${ACTIONS.join(', ')}`)
  if (!projectDir) throw new Error('projectDir is required')
  if (!existsSync(projectDir)) throw new Error(`projectDir does not exist: ${projectDir}`)

  const shardedArbitration = String(config.shardedArbitration ?? 'auto')
  const maxAuditRetries = Number(config.maxAuditRetries ?? 3)
  const maxCompileRounds = Number(config.maxCompileRounds ?? 3)

  if (action === 'freeze') {
    if (shardedArbitration === 'off' && !args.force) {
      throw new Error('shardedArbitration is "off" in the plugin config; set it to auto/on or pass force=true')
    }
    for (const field of ['platform', 'minecraftVersion']) if (!args[field]) throw new Error(`freeze requires ${field}`)
    if (!Array.isArray(args.modules) || args.modules.length === 0) throw new Error('freeze requires modules[] (kebab-case shard ids)')
    const summary = freezeContract({
      projectDir,
      platform: args.platform,
      minecraftVersion: args.minecraftVersion,
      packageName: args.packageName,
      modules: args.modules,
      extraAllowlist: args.extraAllowlist,
      allowlistNote: args.allowlistNote,
      force: Boolean(args.force),
    })
    return result({
      action,
      ok: true,
      summary: `Froze the ${args.platform} ${args.minecraftVersion} contract: ${summary.stubCount} stub(s), ${summary.allowlistCount} allowlisted classes`
        + `${args.extraAllowlist?.length ? ` (${args.extraAllowlist.length} host-verified extra)` : ''}.`,
      paths: [summary.contractFile],
      counts: { stubs: summary.stubCount, allowlist: summary.allowlistCount, modules: args.modules.length },
      extra: summary.warnings.length > 0 ? summary.warnings.join('\n') : `contract hash ${summary.contractHash.slice(0, 16)}…`,
    })
  }

  if (NEEDS_CONTRACT.has(action) && !existsSync(arbitrationPaths(projectDir).contractFile)) {
    throw new Error(`no frozen contract under ${projectDir}; run action=freeze first`)
  }

  if (action === 'brief') {
    const contract = readContract(projectDir)
    const shards = args.shard ? [args.shard] : (contract.modules ?? []).map(module => module.id)
    const briefs = shards.map(shard => buildBrief({ projectDir, shard, contract }))
    const fingerprints = prefixFingerprints({ projectDir, contract })
    const same = new Set(briefs.map(brief => brief.prefixHash)).size === 1
    return result({
      action,
      ok: true,
      summary: `Wrote ${briefs.length} brief(s); shared prefix ${same ? 'identical' : 'DIFFERS'} (${briefs[0].prefixHash.slice(0, 16)}…).`,
      paths: briefs.map(brief => brief.path).filter(Boolean),
      counts: { shards: briefs.length },
      extra: `prefix-shared-across-all-shards=${fingerprints.sharedPrefix}`,
    })
  }

  if (action === 'audit') {
    const audit = auditProject({ projectDir, shard: args.shard, maxRetries: maxAuditRetries })
    const paths = []
    for (const shardResult of audit.shards) {
      const dir = arbitrationPaths(projectDir).shardFile(shardResult.shard, '')
      if (!existsSync(dir)) continue
      const target = join(dir, 'audit-findings.json')
      writeFileSync(target, `${JSON.stringify(shardResult.findings, null, 2)}\n`, 'utf8')
      paths.push(target)
    }
    if (audit.findings.length > 0) recordMemory(projectDir, audit.findings)
    const retries = audit.shards.map(shard => `${shard.shard}=${audit.attempts[shard.shard] ?? 0}/${maxAuditRetries}`).join(', ')
    return result({
      action,
      ok: audit.verdict !== 'reject',
      summary: `Audit verdict: ${audit.verdict} (${audit.findings.filter(f => f.severity === 'error').length} error(s), ${audit.findings.filter(f => f.severity === 'warning').length} warning(s))`
        + `${audit.circuitOpen ? ' — CIRCUIT OPEN' : ''}${retries ? `; retries ${retries}` : ''}.`,
      findings: audit.findings.map(finding => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        shard: finding.shard,
        file: finding.file,
        line: finding.line,
        message: finding.message,
      })),
      paths,
      counts: {
        shards: audit.shards.length,
        errors: audit.findings.filter(finding => finding.severity === 'error').length,
        warnings: audit.findings.filter(finding => finding.severity === 'warning').length,
      },
      extra: audit.circuitOpen
        ? `Circuit breaker open after ${maxAuditRetries} rejected rounds: escalate (action=escalate) or relax the non-fatal warnings instead of retrying the shard.`
        : '',
    })
  }

  if (action === 'merge') {
    const merge = mergeProject({ projectDir, dryRun: Boolean(args.dryRun) })
    const lines = []
    if (merge.aborted) lines.push(`aborted: ${merge.aborted} (nothing written)`)
    for (const item of merge.written) lines.push(`wrote ${item.file} (${item.action}, ${item.count})`)
    for (const item of merge.skipped) lines.push(`skipped ${item.file}: ${item.reason}`)
    for (const error of merge.errors) lines.push(`error ${error.shard}: ${error.error}`)
    return result({
      action,
      ok: merge.ok,
      summary: merge.aborted
        ? `Merge aborted: ${merge.aborted}. No shared file was written.`
        : `${args.dryRun ? 'Dry run: ' : ''}merged ${merge.written.length} file(s) (${(merge.unchanged ?? []).length} already up to date, only real writes are counted), skipped ${merge.skipped.length}, ${merge.errors.length} error(s).`,
      paths: [merge.reportPath].filter(Boolean),
      counts: {
        filesWritten: merge.written.length,
        skipped: merge.skipped.length,
        errors: merge.errors.length,
        commands: merge.conflicts.commands?.length ?? 0,
        unowned: merge.conflicts.ownedFiles?.length ?? 0,
      },
      extra: lines.slice(0, 24).join('\n'),
    })
  }

  if (action === 'route') {
    if (typeof args.compileLog !== 'string' || args.compileLog.trim() === '') throw new Error('route requires compileLog (the mc_gradle output)')
    const routing = routeCompileLog({ projectDir, compileLog: args.compileLog, write: true })
    const lines = []
    for (const route of routing.routes) lines.push(`${route.shard}: ${route.count} error(s) — ${route.errors.slice(0, 3).map(error => `${error.file}:${error.line}`).join(', ')}`)
    for (const error of routing.unowned.slice(0, 5)) lines.push(`unowned: ${error.file}:${error.line} ${error.message}`)
    return result({
      action,
      ok: routing.routes.length > 0 || routing.totalErrors === 0,
      summary: `${routing.totalErrors} compiler error(s) → ${routing.routes.length} shard(s), ${routing.unowned.length} unowned (this replaces the previous routing, it is not a tally)`
        + `${routing.contractCollapse ? `; CONTRACT COLLAPSE on ${routing.contractCollapse.symbol} (${Math.round(routing.contractCollapse.ratio * 100)}% of shards)` : ''}.`,
      paths: routing.routes.map(route => join(arbitrationPaths(projectDir).shardsDir, route.shard, 'compile-routes.json')),
      counts: { errors: routing.totalErrors, shards: routing.routes.length, unowned: routing.unowned.length },
      extra: lines.join('\n'),
    })
  }

  if (action === 'escalate') {
    const findings = []
    const paths = arbitrationPaths(projectDir)
    if (existsSync(paths.shardsDir)) {
      for (const shard of readdirNames(paths.shardsDir)) {
        const file = join(paths.shardsDir, shard, 'audit-findings.json')
        if (!existsSync(file)) continue
        try {
          for (const finding of JSON.parse(readFileSync(file, 'utf8'))) findings.push({ ...finding, shard })
        } catch { /* ignore malformed ledger */ }
      }
    }
    const unowned = []
    let contractCollapse
    for (const shard of existsSync(paths.shardsDir) ? readdirNames(paths.shardsDir) : []) {
      const file = join(paths.shardsDir, shard, 'compile-routes.json')
      if (!existsSync(file)) continue
      try {
        const routes = JSON.parse(readFileSync(file, 'utf8'))
        for (const error of routes.errors ?? []) if (!routes.shard) unowned.push(error)
      } catch { /* ignore */ }
    }
    const escalation = buildEscalation({
      projectDir,
      reason: args.reason ?? 'pipeline cannot continue',
      findings,
      unowned,
      contractCollapse,
      attempts: readAttempts(projectDir),
    })
    return result({
      action,
      ok: true,
      summary: `Wrote escalation material for the upstream orchestrator (${findings.length} finding(s)).`,
      paths: [escalation.path],
      counts: { findings: findings.length, unowned: unowned.length },
      extra: 'Hand this file to the host agent or dsh-superagent: amend the contract, re-freeze, then re-run only the affected shards.',
    })
  }

  // status
  const orchestrator = detectOrchestrator(ctx)
  const status = collectStatus({ projectDir, orchestrator })
  status.timings = summarizeTimings(readTimings(projectDir))
  status.timingLine = renderTimings(readTimings(projectDir))
  return result({
    action,
    ok: true,
    summary: `${renderStatus(status)}\n\n${status.timingLine}`,
    paths: [status.reportPath],
    counts: {
      shards: status.shards.length,
      manifests: status.shards.filter(shard => shard.hasManifest).length,
      filesWritten: status.shards.reduce((sum, shard) => sum + (shard.ownedFiles > 0 ? shard.ownedFiles : 0), 0),
      errors: status.shards.reduce((sum, shard) => sum + (shard.findings ?? 0), 0),
      retries: status.shards.reduce((sum, shard) => sum + shard.attempts, 0),
    },
    extra: `orchestrator=${orchestrator}; compile rounds allowed=${maxCompileRounds}`,
  })
}

/** readdir that tolerates a missing directory. */
function readdirNames(dir) {
  try { return readdirSync(dir).sort() } catch { return [] }
}

/** Uniform tool result shape. */
function result({ action, ok, summary, findings = [], paths = [], counts = {}, extra = '' }) {
  return { action, ok, summary, findings, paths, counts, extra }
}

/** Re-export for the tool card. */
export { MANIFEST_NAME }
