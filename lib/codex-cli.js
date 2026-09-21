/**
 * The transparent Codex CLI bridge behind the mc_codex tool.
 *
 * minecraft-dev drives the user's OWN Codex installation as a normal child
 * process (`codex exec`), so every delegation is visible: the exact command is
 * shown and copy-pasteable, the merged stdout+stderr returns to the session,
 * and the run is persisted (no `--ephemeral`) so `codex resume <id>` opens the
 * same Codex thread a human would see.
 *
 * This module owns only Codex-specific concerns: locating the executable (the
 * CLI is routinely NOT on PATH on Windows), building a cmd.exe/POSIX-safe argv
 * whose displayed text is literally what runs, extracting the session id, and
 * collecting the files the run touched. Process mechanics live in
 * `./run-process.js`.
 * @module minecraft-dev/lib/codex-cli
 */

import { existsSync, readdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, relative, sep, win32 } from 'node:path'
import { renderProcessResult, runProcess } from './run-process.js'

/** Allowed `-s/--sandbox` values of `codex exec`. */
export const CODEX_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']

/** Default `-s` value: a skeleton-writing run needs to create files. */
export const DEFAULT_CODEX_SANDBOX = 'workspace-write'

/** Directory names never walked when collecting changed files. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'out', 'run', '.gradle', '.idea', '.dsh'])

/** Executable file names to look for, per platform. */
function executableNames(platform) {
  return platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']
}

/** Path flavour of the TARGET platform, so candidates are built the way that OS spells them. */
function pathFlavour(platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * Locate the Codex CLI without assuming it is on PATH.
 *
 * Order: every PATH entry, then the Codex app-server copy the desktop app
 * provisions (`~/.codex/plugins/.plugin-appserver/`), then the desktop app's
 * per-hash install root (`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\`).
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env] - environment to read PATH/LOCALAPPDATA from.
 * @param {string} [options.platform] - host platform.
 * @param {string} [options.home] - home directory used for the ~/.codex candidates.
 * @param {(path: string) => boolean} [options.exists] - file-existence probe (injected by tests).
 * @param {(path: string, options?: object) => Array} [options.listDir] - directory listing probe (injected by tests).
 * @returns {{ path: string|null, source: string|null, checked: string[] }}
 */
export function findCodexExecutable(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    home = homedir(),
    exists = existsSync,
    listDir = (path) => readdirSync(path, { withFileTypes: true }),
  } = options
  const names = executableNames(platform)
  const p = pathFlavour(platform)
  const checked = []

  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const dir of String(pathValue).split(p.delimiter)) {
    if (dir.trim().length === 0) continue
    for (const name of names) {
      const candidate = p.join(dir, name)
      checked.push(candidate)
      if (exists(candidate)) return { path: candidate, source: 'PATH', checked }
    }
  }

  const appServerRoot = p.join(home, '.codex', 'plugins', '.plugin-appserver')
  for (const name of names) {
    const candidate = p.join(appServerRoot, name)
    checked.push(candidate)
    if (exists(candidate)) return { path: candidate, source: 'codex-app-server', checked }
  }

  const binRoot = platform === 'win32'
    ? p.join(env.LOCALAPPDATA ?? env.LocalAppData ?? p.join(home, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin')
    : p.join(home, '.local', 'share', 'OpenAI', 'Codex', 'bin')
  let entries = []
  try {
    entries = listDir(binRoot)
  } catch {
    entries = []
  }
  const hashDirs = entries
    .filter(entry => typeof entry?.isDirectory === 'function' ? entry.isDirectory() : true)
    .map(entry => typeof entry === 'string' ? entry : entry.name)
    .filter(name => typeof name === 'string')
    .sort()
    .reverse()
  for (const dir of hashDirs) {
    for (const name of names) {
      const candidate = p.join(binRoot, dir, name)
      checked.push(candidate)
      if (exists(candidate)) return { path: candidate, source: 'codex-desktop', checked }
    }
  }

  return { path: null, source: null, checked }
}

/** Quote one argument for a cmd.exe command line, escaping embedded quotes. */
function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

/** Quote one argument for a POSIX shell (single quotes, embedded quotes escaped). */
function quotePosixArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/**
 * Build the argv for one `codex exec` run, plus the exact human-readable
 * command line it corresponds to.
 *
 * The prompt travels on stdin (`codex exec -`), redirected from the prompt file
 * the caller wrote, so the displayed command is short, reviewable, and exactly
 * what a person would type. `--ephemeral` is deliberately NOT passed: the run
 * must stay resumable in the user's Codex.
 * @param {object} options
 * @param {string} options.executable - absolute Codex CLI path.
 * @param {string} options.projectDir - project root (`-C`).
 * @param {string} options.promptFile - file whose bytes become the prompt.
 * @param {string} [options.sandbox] - `-s` value; defaults to {@link DEFAULT_CODEX_SANDBOX}.
 * @param {string} [options.model] - `-m` value; omitted leaves the user's native Codex model.
 * @param {string} [options.lastMessageFile] - `-o` target for the final answer.
 * @param {string[]} [options.extraArgs] - extra flags appended verbatim.
 * @param {string} [options.platform] - host platform; defaults to process.platform.
 * @returns {{ argv: string[], command: string }}
 */
export function codexArgv(options) {
  const {
    executable,
    projectDir,
    promptFile,
    sandbox = DEFAULT_CODEX_SANDBOX,
    model,
    lastMessageFile,
    extraArgs = [],
    platform = process.platform,
  } = options
  if (!CODEX_SANDBOXES.includes(sandbox)) {
    throw new Error(`invalid sandbox ${JSON.stringify(sandbox)}; supported: ${CODEX_SANDBOXES.join(', ')}`)
  }
  const quote = platform === 'win32' ? quoteCmdArg : quotePosixArg
  const parts = [
    quote(executable), 'exec', '-',
    '-C', quote(projectDir),
    '-s', sandbox,
    '--skip-git-repo-check',
  ]
  if (model !== undefined && model !== null && String(model).length > 0) parts.push('-m', quote(model))
  if (lastMessageFile !== undefined && lastMessageFile !== null) parts.push('-o', quote(lastMessageFile))
  for (const arg of extraArgs) parts.push(quote(arg))
  const command = `${parts.join(' ')} < ${quote(promptFile)}`
  if (platform === 'win32') {
    // cmd.exe strips only the outer quote pair under /s, so the whole command
    // is wrapped once — the same shape gradleArgv uses for gradlew.bat.
    return { argv: ['cmd.exe', '/d', '/s', '/c', `"${command}"`], command }
  }
  return { argv: ['/bin/sh', '-c', command], command }
}

/** Pull the Codex session id out of `codex exec` output (header line or JSON event). */
export function extractSessionId(text) {
  const header = /session id:\s*([0-9a-fA-F][0-9a-fA-F-]{7,})/.exec(text)
  if (header?.[1] !== undefined) return header[1]
  const json = /"session_id"\s*:\s*"([0-9a-fA-F-]{8,})"/.exec(text)
  return json?.[1] ?? null
}

/**
 * Best-effort list of files under `root` modified at or after `sinceMs`.
 * Bounded (depth, visited entries, result size) and never throws: a failure
 * means "no evidence", not a failed run.
 * @param {string} root - project root.
 * @param {number} sinceMs - epoch milliseconds baseline taken before the run.
 * @param {{ maxDepth?: number, maxVisited?: number, maxResults?: number }} [limits]
 * @returns {Promise<string[]>} root-relative POSIX-style paths, sorted.
 */
export async function scanChangedFiles(root, sinceMs, limits = {}) {
  const { maxDepth = 8, maxVisited = 4000, maxResults = 60 } = limits
  const found = []
  let visited = 0

  async function walk(dir, depth) {
    if (depth > maxDepth || visited > maxVisited || found.length >= maxResults) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited > maxVisited || found.length >= maxResults) return
      visited += 1
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(full)
        if (info.mtimeMs >= sinceMs) found.push(relative(root, full).split(sep).join('/'))
      } catch {
        // Unreadable entry: skip it, keep scanning.
      }
    }
  }

  try {
    await walk(root, 0)
  } catch {
    return []
  }
  return found.sort()
}

/**
 * Render the canonical mc_codex result into model-facing text: the command that
 * ran, the process output, what changed, and how to resume the Codex thread.
 * The marker block stays last so terminal cards keep their exit pill.
 * @param {object} result - the value returned by {@link runCodex}.
 * @param {{ projectDir?: string, sandbox?: string, model?: string|null }} [options]
 * @returns {string}
 */
export function renderCodexResult(result, options = {}) {
  const header = [`$ ${result.command}`]
  const meta = []
  if (options.projectDir !== undefined) meta.push(`cwd: ${options.projectDir}`)
  if (options.sandbox !== undefined) meta.push(`sandbox: ${options.sandbox}`)
  meta.push(`model: ${options.model ? options.model : 'native Codex setting'}`)
  header.push(meta.join('   '))

  const footer = []
  if (Array.isArray(result.filesChanged) && result.filesChanged.length > 0) {
    footer.push(`files changed (${result.filesChanged.length}): ${result.filesChanged.join(', ')}`)
  } else {
    footer.push('files changed: none detected')
  }
  if (result.sessionId) {
    footer.push(`session: ${result.sessionId} — resume with: codex resume ${result.sessionId}`)
  }
  footer.push(`duration: ${(result.durationMs / 1000).toFixed(1)}s`)

  return renderProcessResult(result, { header, footer, emptyText: '(codex produced no output)' })
}

/**
 * Run one visible `codex exec` session.
 * @param {object} options
 * @param {string} options.projectDir - project root (`-C`) and the child cwd.
 * @param {string} options.promptFile - prompt file written by the caller.
 * @param {string} [options.sandbox] - `-s` value.
 * @param {string} [options.model] - `-m` value.
 * @param {string} [options.lastMessageFile] - `-o` target for the final answer.
 * @param {string[]} [options.extraArgs] - extra flags.
 * @param {number} options.timeoutMs - timeout in milliseconds; kills the tree on expiry.
 * @param {number} options.tailChars - characters kept from merged output.
 * @param {AbortSignal} [options.signal] - exec.signal.
 * @param {string} [options.executable] - pre-resolved CLI path (skips discovery).
 * @param {{ spawnImpl?: Function, killTreeImpl?: Function, platform?: string, discovery?: object }} [internals]
 * @returns {Promise<object>} the canonical result plus command/executable/sessionId/filesChanged/durationMs.
 */
export async function runCodex(options) {
  const {
    projectDir,
    promptFile,
    sandbox = DEFAULT_CODEX_SANDBOX,
    model,
    lastMessageFile,
    extraArgs = [],
    timeoutMs,
    tailChars,
    signal,
    executable,
    internals = {},
  } = options
  const platform = internals.platform ?? process.platform

  const found = executable !== undefined && executable !== null && executable.length > 0
    ? { path: executable, source: 'explicit', checked: [] }
    : findCodexExecutable({ platform, ...(internals.discovery ?? {}) })
  if (!found.path) {
    throw new Error(
      'could not find the Codex CLI on this machine. Install the Codex desktop app (which also '
      + 'provisions a CLI) or the CLI itself, then retry. Paths checked:\n'
      + found.checked.map(candidate => `  - ${candidate}`).join('\n'),
    )
  }

  const built = codexArgv({ executable: found.path, projectDir, promptFile, sandbox, model, lastMessageFile, extraArgs, platform })
  const startedAt = Date.now()
  const result = await runProcess({
    argv: built.argv,
    cwd: projectDir,
    timeoutMs,
    tailChars,
    signal,
    labels: { program: 'codex', abort: 'mc_codex' },
    internals,
  })
  const durationMs = Date.now() - startedAt

  const filesChanged = typeof internals.scanFiles === 'function'
    ? internals.scanFiles(projectDir, startedAt)
    : await scanChangedFiles(projectDir, startedAt)

  return {
    ...result,
    durationMs,
    command: built.command,
    executable: found.path,
    executableSource: found.source,
    sessionId: extractSessionId(result.output.text),
    filesChanged,
  }
}
