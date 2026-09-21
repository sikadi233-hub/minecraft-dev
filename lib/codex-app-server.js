/**
 * App-server mode for mc_codex: run one persistent Codex thread through the
 * official `codex app-server --stdio` protocol instead of `codex exec`.
 *
 * Why this exists: a thread created with `codex exec` is stamped
 * `source = exec` / `originator = codex_exec`, and the Codex desktop app's
 * default `thread/list` filters those out — so exec sessions are invisible in
 * the app. A thread created through the app-server protocol is stamped
 * `source = vscode` (measured), which the app's default query DOES return, so
 * the session shows up in the desktop sidebar and can be continued there.
 *
 * Everything else stays the same: the prompt still lands in a readable file on
 * disk, the run is bounded by a timeout and a killable process tree, and the
 * caller still gets a plain-text transcript back.
 *
 * Protocol notes (measured against Codex 0.155.0-alpha.9.2):
 * - newline-delimited JSON-RPC 2.0 over stdin/stdout;
 * - `initialize` → `initialized`, then `thread/start`, then `turn/start`;
 * - the answer arrives as `item/completed` notifications whose item is an
 *   `agentMessage`; `phase: "final_answer"` wins, a null phase is the fallback;
 * - the turn ends at the `turn/completed` notification (`turn.status`);
 * - server→client requests (approvals, user input) are answered so a run can
 *   never hang waiting for a human.
 * @module minecraft-dev/lib/codex-app-server
 */

import { spawn } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { findCodexExecutable, findRolloutPath, scanChangedFiles } from './codex-cli.js'
import { capOutput, killTree } from './run-process.js'

/** Fixed app-server arguments (`codex app-server --stdio`). */
export const APP_SERVER_ARGS = ['app-server', '--stdio']

/** Grace period after `turn/interrupt` before the process tree is killed. */
export const INTERRUPT_GRACE_MS = 3000

/** Default transcript cap, matching the exec path's default tail. */
const DEFAULT_TAIL_CHARS = 20_000

/** Approval/sandbox shape per permission mode, mirroring the official client. */
const PERMISSION_PARAMS = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' },
  'dangerously-bypass-approvals-and-sandbox': { approvalPolicy: 'never', sandbox: 'danger-full-access' },
}

/** The spawn argv for one app-server child (no shell: this is a protocol child). */
export function appServerArgv(executable) {
  return [executable, ...APP_SERVER_ARGS]
}

/** Render `<exe> app-server --stdio` the way a user would type it. */
export function appServerCommand(executable, { platform = process.platform } = {}) {
  const quoted = platform === 'win32' ? `"${executable}"` : `'${executable}'`
  return `${quoted} ${APP_SERVER_ARGS.join(' ')}`
}

/** A minimal deferred, so this module does not depend on Promise.withResolvers. */
function deferred() {
  const box = { promise: null, resolve: null, reject: null }
  box.promise = new Promise((resolve, reject) => {
    box.resolve = resolve
    box.reject = reject
  })
  return box
}

/** Turn one JSON-RPC error payload into a readable message. */
function describeRpcError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  const code = error.code === undefined ? '' : ` ${String(error.code)}`
  return `app-server error${code}: ${String(error.message ?? 'unknown')}`
}

/** Read token usage off the terminal turn, when the product reports it. */
function readTokensUsed(terminal) {
  const usage = terminal?.usage ?? terminal?.tokenUsage ?? null
  if (usage === null || typeof usage !== 'object') return null
  for (const key of ['total_tokens', 'totalTokens', 'total']) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/**
 * Read the authoritative token total from the run's own rollout file.
 *
 * Measured against Codex 0.155.0: `turn/completed` carries no usage block, so
 * the only reliable source is the `token_count` event the CLI appends to
 * `rollout-*.jsonl` (`payload.info.total_token_usage.total_tokens`). Bounded
 * tail read; a miss is `null`, never a throw.
 * @param {string|null} rolloutPath - resolved rollout file, if any.
 * @param {number} [maxBytes] - how much of the file tail to scan.
 * @returns {Promise<number|null>} total tokens, or null when unknown.
 */
export async function readRolloutTokens(rolloutPath, maxBytes = 2_000_000) {
  if (typeof rolloutPath !== 'string' || rolloutPath.length === 0) return null
  let handle
  try {
    handle = await open(rolloutPath, 'r')
    const info = await handle.stat()
    const start = Math.max(0, info.size - maxBytes)
    const buffer = Buffer.alloc(info.size - start)
    if (buffer.length === 0) return null
    await handle.read(buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    if (start > 0) lines.shift() // the tail starts mid-line
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      if (!line.includes('"token_count"')) continue
      try {
        const total = JSON.parse(line)?.payload?.info?.total_token_usage?.total_tokens
        if (typeof total === 'number' && Number.isFinite(total)) return total
      } catch {
        // A truncated or non-JSON line: keep walking backwards.
      }
    }
    return null
  } catch {
    return null
  } finally {
    try {
      await handle?.close()
    } catch {
      // Already closed.
    }
  }
}

/**
 * One app-server connection: request/response plus notification collection.
 * Deliberately small — this client starts one thread and runs one turn.
 */
class AppServerSession {
  constructor(child, { onServerRequest } = {}) {
    this.child = child
    this.onServerRequest = onServerRequest
    this.pending = new Map()
    this.nextId = 1
    this.itemTypeCounts = new Map()
    this.commands = []
    this.lastFinalAnswer = null
    this.lastUnphasedAnswer = null
    this.turnCompleted = null
    this.threadId = null
    this.turnId = null
    this.stderr = ''
    this.closed = false

    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.reader.on('line', (line) => this.#onLine(line))
    child.stderr?.on?.('data', (chunk) => {
      if (this.stderr.length < 8192) this.stderr += String(chunk)
    })
    child.on?.('close', () => this.#failAll(new Error('codex app-server exited before the turn completed')))
  }

  #failAll(error) {
    if (this.closed) return
    this.closed = true
    for (const [, entry] of this.pending) entry.reject(error)
    this.pending.clear()
    this.turnCompleted?.reject?.(error)
  }

  #onLine(line) {
    const text = line.trim()
    if (text.length === 0) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return // ignore non-protocol noise on stdout
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(describeRpcError(message.error)))
      else entry.resolve(message.result ?? {})
      return
    }
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        // Server -> client request: never hang waiting for a human.
        const decision = this.onServerRequest?.(message.method, message.params) ?? { decision: 'decline' }
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: decision })}\n`)
        return
      }
      this.#onNotification(message.method, message.params ?? {})
    }
  }

  #onNotification(method, params) {
    if (method === 'item/completed') {
      const item = params.item ?? {}
      const type = typeof item.type === 'string' ? item.type : 'unknown'
      this.itemTypeCounts.set(type, (this.itemTypeCounts.get(type) ?? 0) + 1)
      if (type === 'agentMessage' && typeof item.text === 'string') {
        if (item.phase === 'final_answer') this.lastFinalAnswer = item.text
        else if (item.phase === null || item.phase === undefined) this.lastUnphasedAnswer = item.text
      } else if (type === 'commandExecution' && typeof item.command === 'string') {
        const exit = item.exitCode ?? item.exit_code
        this.commands.push(`$ ${item.command}${typeof exit === 'number' ? ` (exit ${exit})` : ''}`)
      }
      return
    }
    if (method === 'turn/started') {
      const turn = params.turn ?? {}
      if (typeof turn.id === 'string' && this.turnId === null) this.turnId = turn.id
      return
    }
    if (method === 'turn/completed') {
      this.turnCompleted?.resolve({ params })
    }
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error('codex app-server exited before the request was sent'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  /** The best non-commentary answer observed, or null. */
  collectAnswer() {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return typeof selected === 'string' && selected.trim().length > 0 ? selected : null
  }
}

/**
 * Run one prompt as a persistent (app-visible) Codex thread.
 * @param {object} options
 * @param {string} options.projectDir - working directory for the thread.
 * @param {string} options.promptFile - prompt file the caller wrote; its text is sent.
 * @param {string} [options.model] - model override for the thread.
 * @param {string} [options.sandbox] - `read-only` | `workspace-write` | `danger-full-access`.
 * @param {string} [options.permissionMode] - advanced override of the permission params.
 * @param {number} options.timeoutMs - hard ceiling for the whole run.
 * @param {number} [options.tailChars] - characters kept from the rendered transcript.
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.executable] - pre-resolved CLI path.
 * @param {{ spawnImpl?: Function, platform?: string, discovery?: object, scanFiles?: Function, rolloutRoot?: string, killTreeImpl?: Function, clientInfo?: object, home?: string }} [internals]
 * @returns {Promise<object>} an exec-compatible envelope plus thread/token/answer fields.
 */
export async function runCodexAppServer(options) {
  const {
    projectDir,
    promptFile,
    model,
    sandbox = 'workspace-write',
    permissionMode,
    timeoutMs,
    tailChars = DEFAULT_TAIL_CHARS,
    signal,
    executable,
    internals = {},
  } = options
  const platform = internals.platform ?? process.platform
  const spawnImpl = internals.spawnImpl ?? spawn
  const killTreeImpl = internals.killTreeImpl ?? ((p, pid) => killTree(p, pid, internals))

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(timeoutMs)}`)
  }
  if (!Number.isFinite(tailChars) || tailChars <= 0) {
    throw new Error(`invalid tailChars: expected a positive number, got ${JSON.stringify(tailChars)}`)
  }
  if (signal?.aborted) throw new Error(`mc_codex aborted before spawn: ${String(signal.reason ?? 'aborted')}`)

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

  const prompt = await readFile(promptFile, 'utf8')
  const argv = appServerArgv(found.path)
  const startedAt = Date.now()
  const command = appServerCommand(found.path, { platform })
  let child
  try {
    child = spawnImpl(argv[0], argv.slice(1), {
      cwd: projectDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(`failed to start codex app-server in ${projectDir}: ${error.message}`)
  }

  const session = new AppServerSession(child)
  const pid = typeof child?.pid === 'number' ? child.pid : -1
  let timedOut = false
  let aborted = false
  let exitCode = 0
  let failure = null
  let tokensUsed = null

  /** Best-effort interrupt, then a hard tree kill so the run always settles. */
  const stop = () => {
    if (session.turnId !== null) {
      try {
        session.request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId }).catch(() => {})
      } catch {
        // The stream may already be gone; the kill below is the backstop.
      }
    }
    setTimeout(() => killTreeImpl(platform, pid), INTERRUPT_GRACE_MS).unref?.()
  }

  const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
  const onAbort = () => { aborted = true; stop() }
  signal?.addEventListener('abort', onAbort, { once: true })
  // The signal may have fired while the prompt file was being read, before the
  // listener existed; an `abort` event does not replay.
  if (signal?.aborted) onAbort()

  try {
    await session.request('initialize', {
      clientInfo: internals.clientInfo ?? { name: 'DeepSeek Harness', title: 'DeepSeek Harness', version: '0.8.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    session.notify('initialized', {})

    const started = await session.request('thread/start', {
      cwd: projectDir,
      ephemeral: false,
      ...(model === undefined || model === null || String(model).length === 0 ? {} : { model }),
      ...(permissionMode === undefined
        ? { ...PERMISSION_PARAMS.never, sandbox }
        : (PERMISSION_PARAMS[permissionMode] ?? PERMISSION_PARAMS.never)),
    })
    const thread = started.thread ?? {}
    session.threadId = typeof thread.id === 'string' ? thread.id : null
    if (session.threadId === null) throw new Error('codex app-server did not return a thread id')

    session.turnCompleted = deferred()
    if (session.closed) session.turnCompleted.reject(new Error('codex app-server exited before the turn was sent'))
    const turn = await session.request('turn/start', {
      threadId: session.threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
    })
    if (typeof turn.turn?.id === 'string') session.turnId = turn.turn.id

    const completed = await session.turnCompleted.promise
    if (timedOut) throw new Error('turn timed out')
    if (aborted) throw new Error('turn aborted')
    const terminal = completed.params.turn ?? {}
    const status = String(terminal.status ?? 'unknown')
    if (status !== 'completed') {
      exitCode = 1
      failure = `codex turn ended with status ${status}`
    }
    tokensUsed = readTokensUsed(terminal)
  } catch (error) {
    exitCode = 1
    failure = timedOut
      ? `mc_codex timed out after ${timeoutMs}ms`
      : (aborted ? 'mc_codex aborted' : error.message)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    try {
      session.reader.close()
    } catch {
      // Already closed.
    }
    try {
      child.stdin.end()
    } catch {
      // Stream may be gone.
    }
    killTreeImpl(platform, pid)
  }

  const base = {
    mode: 'app-server',
    threadId: session.threadId,
    threadSource: 'vscode',
    command,
    executable: found.path,
    executableSource: found.source,
    projectDir,
    promptFile,
    exitCode,
    signal: null,
    timedOut,
    aborted,
    timeoutMs,
    durationMs: Date.now() - startedAt,
    answer: session.collectAnswer(),
    commands: session.commands.slice(0, 40),
    itemTypeCounts: Object.fromEntries(session.itemTypeCounts),
    tokensUsed,
    failure,
    stderrTail: session.stderr.slice(-2000),
  }

  const rolloutPath = base.threadId
    ? await findRolloutPath(base.threadId, { home: internals.home, sessionsRoot: internals.rolloutRoot })
    : null
  // `turn/completed` reports no usage (measured), so fall back to the rollout.
  const tokens = await readRolloutTokens(rolloutPath) ?? base.tokensUsed
  const filesChanged = typeof internals.scanFiles === 'function'
    ? internals.scanFiles(projectDir, startedAt)
    : await scanChangedFiles(projectDir, startedAt)

  const decorated = { ...base, rolloutPath, tokensUsed: tokens, filesChanged }
  const rendered = renderAppServerResult(decorated, { sandbox, model, tailChars })
  return { ...decorated, output: rendered }
}

/**
 * Render the app-server envelope into model-facing text. Unlike exec mode the
 * transcript is assembled from the run's items: the answer, the observed
 * actions, the token count, and the app-visible thread identity.
 * @param {object} result - the envelope from {@link runCodexAppServer}.
 * @param {{ sandbox?: string, model?: string|null, tailChars?: number }} [options]
 * @returns {{ text: string, truncated: boolean }}
 */
export function renderAppServerResult(result, options = {}) {
  const { tailChars = DEFAULT_TAIL_CHARS } = options
  const header = [`$ ${result.command}`, `prompt: ${result.promptFile} (sent as one app-server turn)`]
  const meta = [`cwd: ${result.projectDir}`]
  if (options.sandbox !== undefined) meta.push(`sandbox: ${options.sandbox}`)
  meta.push(`model: ${options.model ? options.model : 'native Codex setting'}`)
  header.push(meta.join('   '))

  const body = []
  if (typeof result.answer === 'string' && result.answer.length > 0) {
    body.push('--- 最终回答 ---', result.answer)
  } else {
    body.push('--- 最终回答 ---', '(no final_answer agentMessage was observed; see the items below)')
  }
  const counts = Object.entries(result.itemTypeCounts ?? {})
    .map(([type, count]) => `${type}×${count}`)
    .join(', ')
  if (counts.length > 0) body.push('--- 观察到的条目 ---', counts)
  for (const command of result.commands ?? []) body.push(command)
  if (result.failure !== null && result.failure !== undefined) body.push('--- 失败 ---', String(result.failure))
  if (result.stderrTail) body.push('--- app-server stderr (tail) ---', result.stderrTail.trim())

  const footer = []
  if (Array.isArray(result.filesChanged) && result.filesChanged.length > 0) {
    footer.push(`files changed (${result.filesChanged.length}): ${result.filesChanged.join(', ')}`)
  } else {
    footer.push('files changed: none detected')
  }
  if (result.threadId) {
    footer.push(`thread: ${result.threadId} — 已写入 Codex 会话库（source=${result.threadSource ?? 'unknown'}），会出现在桌面版列表里；可直接在 App 里续聊，或 codex resume ${result.threadId}`)
  }
  if (typeof result.tokensUsed === 'number') footer.push(`tokens used: ${result.tokensUsed} (rollout token_count)`)
  if (result.rolloutPath) footer.push(`rollout: ${result.rolloutPath}`)
  footer.push(`duration: ${(result.durationMs / 1000).toFixed(1)}s`)

  const capped = capOutput(body.join('\n'), tailChars)
  const text = capped.text.length === 0 ? '(codex produced no output)' : capped.text
  const marker = result.timedOut
    ? `[timed out after ${result.timeoutMs}ms]`
    : (result.signal !== null
      ? `[killed by signal: ${result.signal}]`
      : (typeof result.exitCode === 'number' && result.exitCode !== 0 ? `[exit code: ${result.exitCode}]` : ''))
  const tailLines = [...footer, ...(marker === '' ? [] : [marker])]
  return { text: `${header.join('\n')}\n${text}\n${tailLines.join('\n')}`, truncated: capped.truncated }
}
