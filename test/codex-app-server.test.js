import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  APP_SERVER_ARGS,
  appServerArgv,
  appServerCommand,
  readRolloutTokens,
  renderAppServerResult,
  runCodexAppServer,
} from '../lib/codex-app-server.js'

const THREAD_ID = '01a0c554-a376-7f00-875b-ab665a8e13d4'
const TURN_ID = '01a0c554-b000-7000-8000-000000000001'
const NEVER = join(tmpdir(), 'mc-codex-no-such-rollouts')

// ---------------------------------------------------------------------------
// A fake `codex app-server --stdio`: newline JSON-RPC over PassThrough streams.
// ---------------------------------------------------------------------------

class FakeAppServer extends EventEmitter {
  constructor(behaviour = {}) {
    super()
    this.behaviour = behaviour
    this.pid = 4242
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.sent = [] // every JSON-RPC line written by the client
    this.stdinEnded = false
    this.stdin = {
      write: (line) => {
        this.sent.push(JSON.parse(String(line).trim()))
        this.#handle(this.sent.at(-1))
      },
      end: () => { this.stdinEnded = true },
    }
  }

  /** Push a notification. */
  emit$notification(method, params) {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  /** Push a server -> client request (approvals, user input). */
  emit$request(id, method, params) {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  }

  /** Every client message of one method, in order. */
  ofMethod(method) {
    return this.sent.filter(message => message.method === method)
  }

  /** Every client reply to a server request. */
  replies() {
    return this.sent.filter(message => message.method === undefined && message.id !== undefined)
  }

  #handle(message) {
    const { behaviour } = this
    if (message.method === 'initialize') {
      this.#reply(message.id, { userAgent: 'fake/0.0.0', codexHome: '/fake' })
      return
    }
    if (message.method === 'thread/start') {
      this.#reply(message.id, { thread: { id: THREAD_ID, cwd: behaviour.cwd ?? null }, model: 'fake-model' })
      return
    }
    if (message.method === 'turn/start') {
      this.#reply(message.id, { turn: { id: TURN_ID } })
      if (behaviour.neverCompletes === true) {
        if (behaviour.answerOnStart !== undefined) this.emit$notification('turn/started', { turn: { id: TURN_ID } })
        return
      }
      queueMicrotask(() => this.#completeTurn())
      return
    }
    if (message.method === 'turn/interrupt') {
      this.#reply(message.id, {})
      if (behaviour.status === 'interrupted') {
        queueMicrotask(() => this.emit$notification('turn/completed', { turn: { id: TURN_ID, status: 'interrupted' } }))
      }
    }
  }

  #completeTurn() {
    const { behaviour } = this
    this.emit$notification('turn/started', { turn: { id: TURN_ID } })
    if (behaviour.approvalRequest === true) this.emit$request(77, 'item/commandExecution/requestApproval', { command: 'rm -rf /' })
    this.emit$notification('item/completed', { item: { type: 'commandExecution', command: 'gradlew build', exitCode: 0 } })
    this.emit$notification('item/completed', { item: { type: 'reasoning', text: 'thinking' } })
    if (behaviour.answer !== undefined) {
      this.emit$notification('item/completed', {
        item: { type: 'agentMessage', text: behaviour.answer, phase: behaviour.phase === undefined ? 'final_answer' : behaviour.phase },
      })
    }
    this.emit$notification('turn/completed', {
      turn: { id: TURN_ID, status: behaviour.status ?? 'completed', usage: behaviour.usage ?? { total_tokens: 4321 } },
    })
  }

  #reply(id, result) {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
  }
}

/** Common internals: a fake CLI on PATH, no real killing, no real rollout scan. */
function internals(server, extra = {}) {
  return {
    platform: 'win32',
    spawnImpl: (program, args, options) => { server.spawn = { program, args, options }; return server },
    killTreeImpl: () => {},
    discovery: { home: 'C:\\Users\\tester', env: { PATH: 'C:\\tools' }, exists: p => p === 'C:\\tools\\codex.exe', listDir: () => [] },
    scanFiles: () => ['src/Main.java'],
    rolloutRoot: NEVER,
    ...extra,
  }
}

/** Write a prompt file and return {dir, promptFile}. */
async function promptFixture(text = 'ARCHITECT BRIEF BODY\n') {
  const dir = await mkdtemp(join(tmpdir(), 'mc-codex-as-'))
  const promptFile = join(dir, 'codex-architect.md')
  await writeFile(promptFile, text, 'utf8')
  return { dir, promptFile }
}

/** Poll until `predicate()` is true, so a test never races the handshake. */
async function waitFor(predicate, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${label}`)
}

// ---------------------------------------------------------------------------
// argv / command rendering
// ---------------------------------------------------------------------------

test('appServerArgv and appServerCommand describe a real `codex app-server --stdio` call', () => {
  assert.deepEqual(APP_SERVER_ARGS, ['app-server', '--stdio'])
  assert.deepEqual(appServerArgv('C:\\tools\\codex.exe'), ['C:\\tools\\codex.exe', 'app-server', '--stdio'])
  assert.equal(appServerCommand('C:\\tools\\codex.exe', { platform: 'win32' }), '"C:\\tools\\codex.exe" app-server --stdio')
  assert.equal(appServerCommand('/usr/bin/codex', { platform: 'linux' }), "'/usr/bin/codex' app-server --stdio")
})

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

test('runCodexAppServer drives thread/start + turn/start and returns the answer', async () => {
  const server = new FakeAppServer({ answer: 'FRAMEWORK WRITTEN\n// [TODO: Agent B] add the listener\n' })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir,
      promptFile,
      model: 'deepseek-v4-pro',
      sandbox: 'workspace-write',
      timeoutMs: 5000,
      tailChars: 4000,
      internals: internals(server),
    })

    // The child is spawned as a protocol peer, not through a shell.
    assert.equal(server.spawn.program, 'C:\\tools\\codex.exe')
    assert.deepEqual(server.spawn.args, ['app-server', '--stdio'])
    assert.equal(server.spawn.options.cwd, dir)
    assert.equal(server.spawn.options.shell, undefined)

    // Handshake order: initialize -> initialized -> thread/start -> turn/start.
    assert.deepEqual(server.sent.map(m => m.method).filter(Boolean), ['initialize', 'initialized', 'thread/start', 'turn/start'])

    // The thread is persistent and app-visible: this is the whole point.
    const start = server.ofMethod('thread/start')[0].params
    assert.equal(start.ephemeral, false)
    assert.equal(start.cwd, dir)
    assert.equal(start.model, 'deepseek-v4-pro')
    assert.equal(start.approvalPolicy, 'never')
    assert.equal(start.sandbox, 'workspace-write')

    // The prompt is the file's contents, verbatim, as one text input.
    const turn = server.ofMethod('turn/start')[0].params
    assert.equal(turn.threadId, THREAD_ID)
    assert.deepEqual(turn.input, [{ type: 'text', text: 'ARCHITECT BRIEF BODY\n', text_elements: [] }])

    assert.equal(result.mode, 'app-server')
    assert.equal(result.threadId, THREAD_ID)
    assert.equal(result.threadSource, 'vscode')
    assert.equal(result.executable, 'C:\\tools\\codex.exe')
    assert.equal(result.executableSource, 'PATH')
    assert.equal(result.exitCode, 0)
    assert.equal(result.timedOut, false)
    assert.equal(result.aborted, false)
    assert.equal(result.failure, null)
    assert.equal(result.tokensUsed, 4321)
    assert.deepEqual(result.filesChanged, ['src/Main.java'])
    assert.equal(result.rolloutPath, null)
    assert.match(result.command, /^"C:\\tools\\codex\.exe" app-server --stdio$/)
    assert.match(result.answer, /FRAMEWORK WRITTEN/)
    assert.deepEqual(result.commands, ['$ gradlew build (exit 0)'])
    assert.equal(result.itemTypeCounts.commandExecution, 1)
    assert.equal(result.itemTypeCounts.agentMessage, 1)

    // The transcript reports identity and the exact resume path.
    assert.match(result.output.text, /^\$ "C:\\tools\\codex\.exe" app-server --stdio/)
    assert.match(result.output.text, /prompt: .*codex-architect\.md/)
    assert.match(result.output.text, /sandbox: workspace-write/)
    assert.match(result.output.text, /FRAMEWORK WRITTEN/)
    assert.match(result.output.text, /files changed \(1\): src\/Main\.java/)
    assert.match(result.output.text, /thread: 01a0c554-a376-7f00-875b-ab665a8e13d4/)
    assert.match(result.output.text, /source=vscode/)
    assert.match(result.output.text, /codex resume 01a0c554-a376-7f00-875b-ab665a8e13d4/)
    assert.match(result.output.text, /tokens used: 4321/)
    assert.equal(result.output.truncated, false)
    assert.equal(server.stdinEnded, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer falls back to an unphased agentMessage and to the native model', async () => {
  const server = new FakeAppServer({ answer: 'only commentary-ish text', phase: null })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 2000, internals: internals(server),
    })
    assert.equal(result.answer, 'only commentary-ish text')
    assert.equal(server.ofMethod('thread/start')[0].params.model, undefined)
    assert.match(result.output.text, /model: native Codex setting/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer ignores commentary-only agents and says so', async () => {
  const server = new FakeAppServer({ answer: 'step one done', phase: 'commentary' })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 2000, internals: internals(server),
    })
    assert.equal(result.answer, null)
    assert.match(result.output.text, /--- 最终回答 ---\n\(no final_answer agentMessage was observed/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer answers server->client requests instead of hanging on a human', async () => {
  const server = new FakeAppServer({ answer: 'done', approvalRequest: true })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 2000, internals: internals(server),
    })
    assert.equal(result.exitCode, 0)
    const replies = server.replies()
    assert.equal(replies.length, 1)
    assert.equal(replies[0].id, 77)
    assert.deepEqual(replies[0].result, { decision: 'decline' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// failure paths
// ---------------------------------------------------------------------------

test('runCodexAppServer kills the run and reports a timeout', async () => {
  const server = new FakeAppServer({ neverCompletes: true, status: 'interrupted' })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 25, tailChars: 2000, internals: internals(server),
    })
    assert.equal(result.timedOut, true)
    assert.equal(result.exitCode, 1)
    assert.match(result.failure, /timed out after 25ms/)
    assert.equal(server.ofMethod('turn/interrupt').length, 1)
    assert.match(result.output.text, /\n\[timed out after 25ms\]$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer reports a non-completed turn status as a failure', async () => {
  const server = new FakeAppServer({ answer: 'partial', status: 'failed' })
  const { dir, promptFile } = await promptFixture()
  try {
    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 2000, internals: internals(server),
    })
    assert.equal(result.exitCode, 1)
    assert.match(result.failure, /status failed/)
    assert.match(result.output.text, /\n\[exit code: 1\]$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer fails fast when the app-server child is gone', async () => {
  const server = new FakeAppServer({ neverCompletes: true })
  const { dir, promptFile } = await promptFixture()
  try {
    const promise = runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 1000, internals: internals(server),
    })
    // Close only once the handshake reached turn/start, which is synchronous.
    await waitFor(() => server.ofMethod('turn/start').length === 1, 'turn/start')
    server.emit('close', 1, null)
    const result = await promise
    assert.equal(result.exitCode, 1)
    assert.match(result.failure, /exited before the turn completed/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer refuses to run without a Codex CLI and validates its own options', async () => {
  const { dir, promptFile } = await promptFixture()
  try {
    await assert.rejects(
      runCodexAppServer({
        projectDir: dir, promptFile, timeoutMs: 1000, tailChars: 100,
        internals: { platform: 'win32', killTreeImpl: () => {}, discovery: { home: 'C:\\t', env: { PATH: 'C:\\tools' }, exists: () => false, listDir: () => [] } },
      }),
      /could not find the Codex CLI[\s\S]*Paths checked:/,
    )
    await assert.rejects(
      runCodexAppServer({ projectDir: dir, promptFile, timeoutMs: 0, tailChars: 100, internals: {} }),
      /invalid timeoutMs/,
    )
    await assert.rejects(
      runCodexAppServer({ projectDir: dir, promptFile, timeoutMs: 1000, tailChars: 0, internals: {} }),
      /invalid tailChars/,
    )
    await assert.rejects(
      runCodexAppServer({ projectDir: dir, promptFile, timeoutMs: 1000, tailChars: 100, signal: AbortSignal.abort('user'), internals: {} }),
      /aborted before spawn/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCodexAppServer honours a pre-aborted-adjacent abort signal', async () => {
  const server = new FakeAppServer({ neverCompletes: true, status: 'interrupted' })
  const { dir, promptFile } = await promptFixture()
  const controller = new AbortController()
  try {
    const promise = runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 1000, signal: controller.signal, internals: internals(server),
    })
    await waitFor(() => server.ofMethod('turn/start').length === 1, 'turn/start')
    controller.abort('user pressed stop')
    const result = await promise
    assert.equal(result.aborted, true)
    assert.equal(result.exitCode, 1)
    assert.match(result.failure, /aborted/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// rollout token usage
// ---------------------------------------------------------------------------

test('runCodexAppServer reads the real token total out of the rollout file', async () => {
  const server = new FakeAppServer({ answer: 'done' })
  const { dir, promptFile } = await promptFixture()
  const rollouts = await mkdtemp(join(tmpdir(), 'mc-codex-rollout-'))
  try {
    // Mirror the real layout: findRolloutPath matches on the id in the name.
    const day = join(rollouts, '2026', '09', '22')
    await mkdir(day, { recursive: true })
    const rollout = join(day, `rollout-2026-09-22T03-16-16-${THREAD_ID}.jsonl`)
    await writeFile(rollout, [
      JSON.stringify({ type: 'session_meta', payload: { id: THREAD_ID } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 111 } } } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 13387 } } } }),
      '',
    ].join('\n'), 'utf8')

    const result = await runCodexAppServer({
      projectDir: dir, promptFile, timeoutMs: 5000, tailChars: 2000,
      internals: internals(server, { rolloutRoot: rollouts }),
    })
    assert.equal(result.tokensUsed, 13387)
    assert.equal(result.rolloutPath, rollout)
    assert.match(result.output.text, /tokens used: 13387 \(rollout token_count\)/)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(rollouts, { recursive: true, force: true })
  }
})

test('readRolloutTokens is bounded and never throws on junk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mc-codex-rt-'))
  try {
    const file = join(dir, 'rollout-2026-09-22T03-16-16-x.jsonl')
    // The last token_count line wins even when it sits behind filler.
    await writeFile(file, `${'{"filler":"x"}\n'.repeat(50)}${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 7 } } } })}\n`, 'utf8')
    assert.equal(await readRolloutTokens(file), 7)
    // A tiny window that cuts the only token_count line off still returns null.
    assert.equal(await readRolloutTokens(file, 10), null)
    assert.equal(await readRolloutTokens(join(dir, 'missing.jsonl')), null)
    assert.equal(await readRolloutTokens(null), null)
    assert.equal(await readRolloutTokens(''), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// renderAppServerResult
// ---------------------------------------------------------------------------
test('renderAppServerResult renders a thread-less, answer-less run', () => {
  const { text } = renderAppServerResult({
    command: '"codex.exe" app-server --stdio',
    projectDir: 'C:\\p',
    promptFile: 'C:\\p\\.dsh\\codex-architect.md',
    answer: null,
    commands: [],
    itemTypeCounts: {},
    filesChanged: [],
    threadId: null,
    rolloutPath: null,
    failure: 'boom',
    durationMs: 1000,
    exitCode: 1,
    signal: null,
    timedOut: false,
  }, { sandbox: 'read-only', model: null })
  assert.match(text, /files changed: none detected/)
  assert.doesNotMatch(text, /codex resume/)
  assert.doesNotMatch(text, /rollout:/)
  assert.match(text, /no final_answer agentMessage was observed/)
  assert.match(text, /--- 失败 ---\nboom/)
  assert.match(text, /\n\[exit code: 1\]$/)
})
