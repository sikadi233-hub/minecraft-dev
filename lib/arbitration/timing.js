/**
 * Phase timing for the arbitration pipeline.
 *
 * The engine's honest claim is that sharding removes rework, not that it makes
 * the first pass faster; that claim is only checkable if the phases are measured.
 * Every `mc_arbitrate` call appends one entry here, and `status` sums them, so a
 * run can say "freeze 1.2s, brief 0.3s, audit 0.4s, merge 0.2s, build 6s" instead
 * of leaving the person with a feeling.
 *
 * The file lives under `.mcdev/reports/` like every other artefact: local to the
 * project, append-only, and safe to delete.
 *
 * @module minecraft-dev/lib/arbitration/timing
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths, ensureDir } from './paths.js'

/** Absolute path of the timing ledger. */
export function timingPath(projectDir) {
  return join(arbitrationPaths(projectDir).reportsDir, 'timing.json')
}

/** Read the timing ledger (empty array when missing or malformed). */
export function readTimings(projectDir) {
  const path = timingPath(projectDir)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/**
 * Append one timing record.
 * @param {string} projectDir - absolute project root.
 * @param {{ action: string, durationMs: number, shard?: string }} entry - what ran and how long it took.
 * @returns {{ action: string, durationMs: number, at: string, shard?: string }} the stored record.
 */
export function recordTiming(projectDir, entry) {
  const record = {
    action: entry.action,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
    at: new Date().toISOString(),
    ...(entry.shard ? { shard: entry.shard } : {}),
  }
  const entries = readTimings(projectDir)
  entries.push(record)
  const path = timingPath(projectDir)
  ensureDir(join(path, '..'))
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  return record
}

/**
 * Sum the ledger by action.
 * @param {object[]} entries - timing records.
 * @returns {{ totalMs: number, byAction: Record<string, { calls: number, totalMs: number }> }} summary.
 */
export function summarizeTimings(entries) {
  const byAction = {}
  let totalMs = 0
  for (const entry of entries) {
    const action = String(entry.action ?? 'unknown')
    const duration = Number(entry.durationMs) || 0
    if (!byAction[action]) byAction[action] = { calls: 0, totalMs: 0 }
    byAction[action].calls += 1
    byAction[action].totalMs += duration
    totalMs += duration
  }
  return { totalMs, byAction }
}

/** Human line for the status card. */
export function renderTimings(entries) {
  const { totalMs, byAction } = summarizeTimings(entries)
  const parts = Object.entries(byAction)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .map(([action, value]) => `${action} ${(value.totalMs / 1000).toFixed(1)}s×${value.calls}`)
  return parts.length === 0 ? 'engine time: (no calls recorded yet)' : `engine time ${(totalMs / 1000).toFixed(1)}s: ${parts.join(', ')}`
}
