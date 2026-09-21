import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_SANDBOXES,
  DEFAULT_CODEX_SANDBOX,
  codexArgv,
  extractSessionId,
  findCodexExecutable,
  renderCodexResult,
  runCodex,
  scanChangedFiles,
} from '../lib/codex-cli.js'

// ---------------------------------------------------------------------------
// findCodexExecutable
// ---------------------------------------------------------------------------

test('findCodexExecutable prefers PATH, then the app-server copy, then the desktop install', () => {
  const home = 'C:\\Users\\tester'
  const pathExe = 'C:\\tools\\codex.exe'

  const onPath = findCodexExecutable({
    platform: 'win32',
    home,
    env: { PATH: 'C:\\tools;C:\\other', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
    exists: candidate => candidate === pathExe,
    listDir: () => { throw new Error('should not be reached') },
  })
  assert.deepEqual(onPath.path, pathExe)
  assert.equal(onPath.source, 'PATH')

  const appServerExe = join(home, '.codex', 'plugins', '.plugin-appserver', 'codex.exe')
  const appServer = findCodexExecutable({
    platform: 'win32',
    home,
    env: { PATH: 'C:\\tools' },
    exists: candidate => candidate === appServerExe,
    listDir: () => { throw new Error('should not be reached') },
  })
  assert.deepEqual(appServer.path, appServerExe)
  assert.equal(appServer.source, 'codex-app-server')

  const desktopExe = join('C:\\Users\\tester\\AppData\\Local', 'OpenAI', 'Codex', 'bin', 'abc123', 'codex.exe')
  const desktop = findCodexExecutable({
    platform: 'win32',
    home,
    env: { PATH: 'C:\\tools', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
    exists: candidate => candidate === desktopExe,
    listDir: () => [{ name: 'abc123', isDirectory: () => true }],
  })
  assert.deepEqual(desktop.path, desktopExe)
  assert.equal(desktop.source, 'codex-desktop')
})

test('findCodexExecutable reports every path it checked when nothing matches', () => {
  const result = findCodexExecutable({
    platform: 'win32',
    home: 'C:\\Users\\tester',
    env: { PATH: 'C:\\tools', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
    exists: () => false,
    listDir: () => [{ name: 'deadbeef', isDirectory: () => true }],
  })
  assert.equal(result.path, null)
  assert.equal(result.source, null)
  assert.ok(result.checked.length >= 4, `expected several candidates, got ${result.checked.length}`)
  assert.ok(result.checked.some(candidate => candidate.includes('.plugin-appserver')))
  assert.ok(result.checked.some(candidate => candidate.includes('deadbeef')))
})

test('findCodexExecutable looks for a bare name on posix', () => {
  const result = findCodexExecutable({
    platform: 'linux',
    home: '/home/tester',
    env: { PATH: '/usr/local/bin:/usr/bin' },
    exists: candidate => candidate === '/usr/bin/codex',
    listDir: () => [],
  })
  assert.equal(result.path, '/usr/bin/codex')
  assert.equal(result.source, 'PATH')
})

// ---------------------------------------------------------------------------
// codexArgv
// ---------------------------------------------------------------------------

test('codexArgv builds a copy-pasteable win32 command that reads the prompt on stdin', () => {
  const { argv, command } = codexArgv({
    platform: 'win32',
    executable: 'C:\\Users\\tester\\.codex\\plugins\\.plugin-appserver\\codex.exe',
    projectDir: 'C:\\work\\my plugin',
    promptFile: 'C:\\work\\my plugin\\.dsh\\codex-architect.md',
    sandbox: 'workspace-write',
    model: 'deepseek-v4-pro',
    lastMessageFile: 'C:\\work\\my plugin\\.dsh\\codex-last-message.md',
  })
  assert.equal(argv[0], 'cmd.exe')
  assert.deepEqual(argv.slice(1, 4), ['/d', '/s', '/c'])
  assert.equal(argv.length, 5)
  assert.match(command, /^"C:\\Users\\tester\\\.codex\\plugins\\\.plugin-appserver\\codex\.exe" exec - /)
  assert.match(command, /-s workspace-write/)
  assert.match(command, /-m "deepseek-v4-pro"/)
  assert.match(command, /--skip-git-repo-check/)
  assert.match(command, /-o "C:\\work\\my plugin\\\.dsh\\codex-last-message\.md"/)
  assert.match(command, /-C "C:\\work\\my plugin"/)
  assert.match(command, /< "C:\\work\\my plugin\\\.dsh\\codex-architect\.md"$/)
  // --ephemeral must never appear: the run has to stay resumable.
  assert.doesNotMatch(command, /--ephemeral/)
})

test('codexArgv builds a posix command through sh and omits optional flags', () => {
  const { argv, command } = codexArgv({
    platform: 'linux',
    executable: '/usr/bin/codex',
    projectDir: '/work/demo',
    promptFile: '/work/demo/.dsh/codex-architect.md',
  })
  assert.deepEqual(argv.slice(0, 2), ['/bin/sh', '-c'])
  assert.equal(argv[2], command)
  assert.match(command, /^'\/usr\/bin\/codex' exec - /)
  assert.match(command, /-s workspace-write/)
  assert.doesNotMatch(command, /-m /)
  assert.doesNotMatch(command, /-o /)
})

test('codexArgv rejects an unknown sandbox and appends extra args verbatim', () => {
  assert.throws(() => codexArgv({
    platform: 'win32', executable: 'codex.exe', projectDir: 'C:\\p', promptFile: 'C:\\p\\prompt.md', sandbox: 'yolo',
  }), /invalid sandbox/)
  const { command } = codexArgv({
    platform: 'win32', executable: 'codex.exe', projectDir: 'C:\\p', promptFile: 'C:\\p\\prompt.md',
    extraArgs: ['--json'],
  })
  assert.match(command, /--json/)
  assert.deepEqual(CODEX_SANDBOXES.includes(DEFAULT_CODEX_SANDBOX), true)
})

// ---------------------------------------------------------------------------
// session id + changed files + rendering
// ---------------------------------------------------------------------------

test('extractSessionId reads the header line and the JSON event form', () => {
  const id = '01a0c4a6-9298-7a12-b9ca-3a8ae815fa30'
  assert.equal(extractSessionId(`workdir: C:\\p\nsession id: ${id}\n`), id)
  assert.equal(extractSessionId(`{"type":"thread.started","session_id":"${id}"}`), id)
  assert.equal(extractSessionId('no id here'), null)
})

test('scanChangedFiles reports fresh files and skips build noise', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mc-codex-scan-'))
  try {
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'Main.java'), 'class Main {}\n')
    await writeFile(join(root, 'node_modules', 'ignored.js'), 'x\n')
    const since = Date.now() - 60_000
    const found = await scanChangedFiles(root, since)
    assert.deepEqual(found, ['src/Main.java'])
    // A baseline in the future finds nothing.
    assert.deepEqual(await scanChangedFiles(root, Date.now() + 60_000), [])
    // A missing root is "no evidence", not a throw.
    assert.deepEqual(await scanChangedFiles(join(root, 'nope'), since), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('renderCodexResult shows the command, the output, the changed files and the resume hint', () => {
  const result = {
    command: '"codex.exe" exec - -C "C:\\p" -s workspace-write < "C:\\p\\.dsh\\codex-architect.md"',
    exitCode: 0,
    signal: null,
    timedOut: false,
    timeoutMs: 1000,
    durationMs: 12_300,
    sessionId: '01a0c4a6-9298-7a12-b9ca-3a8ae815fa30',
    filesChanged: ['src/Main.java', 'build.gradle.kts'],
    output: { text: 'skeleton written', truncated: false },
  }
  const text = renderCodexResult(result, { projectDir: 'C:\\p', sandbox: 'workspace-write', model: 'deepseek-v4-pro' })
  assert.match(text, /^\$ "codex\.exe" exec - /)
  assert.match(text, /sandbox: workspace-write/)
  assert.match(text, /model: deepseek-v4-pro/)
  assert.match(text, /skeleton written/)
  assert.match(text, /files changed \(2\): src\/Main\.java, build\.gradle\.kts/)
  assert.match(text, /codex resume 01a0c4a6-9298-7a12-b9ca-3a8ae815fa30/)
  assert.match(text, /duration: 12\.3s/)
})

test('renderCodexResult says so when nothing changed and no session id was seen', () => {
  const result = {
    command: 'codex exec -',
    exitCode: 2,
    signal: null,
    timedOut: false,
    timeoutMs: 1000,
    durationMs: 500,
    sessionId: null,
    filesChanged: [],
    output: { text: '' },
  }
  const text = renderCodexResult(result, { projectDir: 'C:\\p', sandbox: 'read-only' })
  assert.match(text, /files changed: none detected/)
  assert.doesNotMatch(text, /codex resume/)
  assert.match(text, /model: native Codex setting/)
  assert.match(text, /\(codex produced no output\)/)
  assert.match(text, /\n\[exit code: 2\]$/)
})

// ---------------------------------------------------------------------------
// runCodex
// ---------------------------------------------------------------------------

test('runCodex refuses to run when no Codex CLI is present, listing what it checked', async () => {
  await assert.rejects(
    runCodex({
      projectDir: 'C:\\p',
      promptFile: 'C:\\p\\prompt.md',
      timeoutMs: 1000,
      tailChars: 100,
      internals: {
        platform: 'win32',
        discovery: { home: 'C:\\Users\\tester', env: { PATH: 'C:\\tools' }, exists: () => false, listDir: () => [] },
      },
    }),
    /could not find the Codex CLI[\s\S]*Paths checked:/,
  )
})

test('runCodex runs the discovered executable with the file cwd and returns the envelope', async () => {
  const calls = []
  const stdout = []
  const closeListeners = []
  const child = {
    pid: 7,
    stdout: { on: (event, fn) => { if (event === 'data') stdout.push(fn) } },
    stderr: { on: () => {} },
    on: (event, fn) => { if (event === 'close') closeListeners.push(fn) },
  }
  const promise = runCodex({
    projectDir: 'C:\\p',
    promptFile: 'C:\\p\\.dsh\\codex-architect.md',
    sandbox: 'workspace-write',
    timeoutMs: 1000,
    tailChars: 500,
    internals: {
      platform: 'win32',
      spawnImpl: (program, args, options) => { calls.push({ program, args, options }); return child },
      discovery: { home: 'C:\\Users\\tester', env: { PATH: 'C:\\tools' }, exists: p => p === 'C:\\tools\\codex.exe', listDir: () => [] },
      scanFiles: () => ['a.java'],
    },
  })
  for (const fn of stdout) fn(Buffer.from('session id: 01a0c4a6-9298-7a12-b9ca-3a8ae815fa30\nskeleton written\n'))
  for (const fn of closeListeners) fn(0, null)
  const result = await promise
  assert.equal(calls[0].program, 'cmd.exe')
  assert.equal(calls[0].options.cwd, 'C:\\p')
  assert.equal(calls[0].options.windowsVerbatimArguments, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.executable, 'C:\\tools\\codex.exe')
  assert.equal(result.executableSource, 'PATH')
  assert.equal(result.sessionId, '01a0c4a6-9298-7a12-b9ca-3a8ae815fa30')
  assert.deepEqual(result.filesChanged, ['a.java'])
  assert.match(result.command, /codex\.exe" exec - -C "C:\\p"/)
  assert.equal(typeof result.durationMs, 'number')
})
