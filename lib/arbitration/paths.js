/**
 * Filesystem contract for the arbitration engine.
 *
 * Every artefact the engine produces lives under `<project>/.mcdev/`, and every
 * path the engine writes is resolved through {@link resolveInside}: a shard
 * manifest may only touch files inside the project, and a generated stub path
 * may not escape either. A path that resolves outside the project is a hard
 * error (`E_PATH_ESCAPE`) rather than a silent write elsewhere — the whole point
 * of the shard protocol is that the blast radius stays inside one project.
 *
 * @module minecraft-dev/lib/arbitration/paths
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Root directory (relative to the project) holding every arbitration artefact. */
export const MCDEV_DIR = '.mcdev'

/** Fixed file names inside `.mcdev/`. */
export const FILES = {
  contract: 'contract/contract.json',
  allowlist: 'contract/api-allowlist.json',
  memory: 'memory.json',
  status: 'reports/run-status.json',
  mergeReport: 'reports/merge-report.md',
  diffReport: 'reports/diff-report.md',
  /** Per-shard file names (joined with the shard id). */
  brief: 'BRIEF.md',
  manifest: 'RegistrationManifest.json',
  findings: 'audit-findings.json',
  routes: 'compile-routes.json',
}

/** Error code raised when a resolved path leaves the project directory. */
export const PATH_ESCAPE = 'E_PATH_ESCAPE'

/**
 * Throw when `candidate` is not inside `projectDir`.
 * @param {string} projectDir - absolute project root.
 * @param {string} candidate - absolute candidate path.
 * @returns {string} the candidate, unchanged.
 */
export function assertInside(projectDir, candidate) {
  const root = resolve(projectDir)
  const full = resolve(candidate)
  const rel = relative(root, full)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return full
  const error = new Error(`path escapes the project directory: ${full} is outside ${root}`)
  error.code = PATH_ESCAPE
  throw error
}

/**
 * Resolve a path relative to the project, refusing to escape it.
 * @param {string} projectDir - absolute project root.
 * @param {...string} parts - relative path parts.
 * @returns {string} absolute, verified path.
 */
export function resolveInside(projectDir, ...parts) {
  return assertInside(projectDir, join(projectDir, ...parts))
}

/**
 * Resolve a project-relative POSIX-ish path (the form shard manifests use).
 * @param {string} projectDir - absolute project root.
 * @param {string} relativePath - e.g. `com/example/plugin/shard/gui/Panel.java`.
 * @returns {string} absolute, verified path.
 */
export function resolveRelative(projectDir, relativePath) {
  return assertInside(projectDir, join(projectDir, relativePath.split('/').join(sep)))
}

/** Create a directory (recursively) when missing. */
export function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

/**
 * The `.mcdev` layout for one project.
 * @param {string} projectDir - absolute project root.
 * @returns {object} absolute paths plus helpers.
 */
export function arbitrationPaths(projectDir) {
  const root = resolveInside(projectDir, MCDEV_DIR)
  return {
    root,
    projectDir: resolve(projectDir),
    contractDir: join(root, 'contract'),
    stubsDir: join(root, 'contract', 'stubs'),
    contractFile: join(root, ...FILES.contract.split('/')),
    allowlistFile: join(root, ...FILES.allowlist.split('/')),
    shardsDir: join(root, 'shards'),
    reportsDir: join(root, 'reports'),
    memoryFile: join(root, ...FILES.memory.split('/')),
    statusFile: join(root, ...FILES.status.split('/')),
    mergeReport: join(root, ...FILES.mergeReport.split('/')),
    diffReport: join(root, ...FILES.diffReport.split('/')),
    /** Directory for one shard. */
    shardDir(shardId) {
      return resolveInside(join(root, 'shards'), shardId)
    },
    /** One shard's artefact path. */
    shardFile(shardId, name) {
      return join(resolveInside(join(root, 'shards'), shardId), name)
    },
  }
}

/** Make sure the `.mcdev` skeleton exists. */
export function ensureArbitrationLayout(projectDir) {
  const paths = arbitrationPaths(projectDir)
  for (const dir of [paths.root, paths.contractDir, paths.stubsDir, paths.shardsDir, paths.reportsDir]) ensureDir(dir)
  return paths
}

/** Parent directory of a path (small convenience for callers). */
export function parentOf(path) {
  return dirname(path)
}
