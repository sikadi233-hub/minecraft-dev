import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capOutput, gradleArgv, killTree, renderGradleResult, runGradle } from '../lib/gradle.js'
import { gradleCallView, gradleResultView, parseGradleExitStatus } from '../lib/present.js'

/**
 * Fake child process for the injected spawnImpl: captures the stdout/stderr
 * data listeners and close/error listeners so the test can feed chunks and
 * settle the run deterministically. No real subprocess is ever spawned.
 */
function fakeChild({ exitCode = 0, signal = null } = {}) {
  const dataListeners = []
  const errorListeners = []
  const closeListeners = []
  const child = {
    pid: 4242,
    stdout: { on: (event, fn) => { if (event === 'data') dataListeners.push(fn) } },
    stderr: { on: () => {} },
    on: (event, fn) => {
      if (event === 'error') errorListeners.push(fn)
      if (event === 'close') closeListeners.push(fn)
    },
  }
  return {
    child,
    emitData(chunk) { for (const fn of dataListeners) fn(Buffer.from(chunk)) },
    emitClose(code = exitCode, sig = signal) { for (const fn of closeListeners) fn(code, sig) },
    emitError(err) { for (const fn of errorListeners) fn(err) },
  }
}

// ---------------------------------------------------------------------------
// capOutput (pure function)
// ---------------------------------------------------------------------------

test('capOutput passes short text through unchanged', () => {
  assert.deepEqual(capOutput('hello world', 100), { text: 'hello world', truncated: false })
  assert.deepEqual(capOutput('x'.repeat(100), 100), { text: 'x'.repeat(100), truncated: false })
  assert.deepEqual(capOutput('', 100), { text: '', truncated: false })
})

test('capOutput keeps head and tail around the truncation marker', () => {
  const long = 'A'.repeat(50) + 'B'.repeat(100) + 'C'.repeat(50)
  const { text, truncated } = capOutput(long, 100)
  assert.equal(truncated, true)
  assert.ok(text.startsWith('A'.repeat(50)), 'head = first ceil(keep/2) chars')
  assert.ok(text.endsWith('C'.repeat(50)), 'tail = last floor(keep/2) chars')
  assert.match(text, /\[100 chars truncated\]/)
})

test('capOutput handles the tailChars=1 boundary', () => {
  const { text, truncated } = capOutput('abcdef', 1)
  assert.equal(truncated, true)
  assert.ok(text.startsWith('a'))
  assert.match(text, /\[5 chars truncated\]/)
})

// ---------------------------------------------------------------------------
// gradleArgv
// ---------------------------------------------------------------------------

test('gradleArgv wraps the bat through cmd.exe on win32 and quotes args', () => {
  assert.deepEqual(
    gradleArgv({ platform: 'win32', projectDir: 'C:/proj', task: 'build' }),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\proj\\gradlew.bat" build"'],
  )
  assert.deepEqual(
    gradleArgv({ platform: 'win32', projectDir: 'C:/proj', task: 'build', args: ['--no-daemon', '-Pkey=value'] }),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\proj\\gradlew.bat" build "--no-daemon" "-Pkey=value""'],
  )
  assert.deepEqual(
    gradleArgv({ platform: 'win32', projectDir: 'C:/proj', task: 'build', args: ['a b"c'] }),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\proj\\gradlew.bat" build "a b\\"c""'],
  )
})

test('gradleArgv resolves the win32 wrapper absolutely so cmd never needs the cwd search', () => {
  assert.deepEqual(
    gradleArgv({ platform: 'win32', projectDir: 'C:/Users/John Doe/proj', task: 'build' }),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\Users\\John Doe\\proj\\gradlew.bat" build"'],
  )
  assert.deepEqual(
    gradleArgv({ platform: 'win32', projectDir: 'C:/proj', gradlew: 'custom.bat', task: 'help' }),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\proj\\custom.bat" help"'],
  )
})

test('gradleArgv runs ./gradlew directly on posix', () => {
  assert.deepEqual(gradleArgv({ platform: 'linux', task: 'build', args: ['--no-daemon'] }), ['./gradlew', 'build', '--no-daemon'])
  assert.deepEqual(gradleArgv({ platform: 'darwin', task: 'runClient' }), ['./gradlew', 'runClient'])
})

// ---------------------------------------------------------------------------
// killTree
// ---------------------------------------------------------------------------

test('killTree runs taskkill with the tree flags on win32', () => {
  const calls = []
  killTree('win32', 1234, {
    spawnSyncImpl: (program, args, options) => calls.push([program, args, options]),
  })
  assert.deepEqual(calls, [['taskkill', ['/PID', '1234', '/T', '/F'], { stdio: 'ignore' }]])
})

test('killTree signals the negative process group on posix', () => {
  const calls = []
  killTree('linux', 42, {
    processKillImpl: (pid, signal) => calls.push([pid, signal]),
  })
  assert.deepEqual(calls, [[-42, 'SIGTERM']])
})

test('killTree no-ops for a non-positive pid', () => {
  let called = false
  for (const pid of [0, -1]) {
    killTree('win32', pid, { spawnSyncImpl: () => { called = true } })
    killTree('linux', pid, { processKillImpl: () => { called = true } })
  }
  assert.equal(called, false)
})

// ---------------------------------------------------------------------------
// runGradle with injected fake spawn
// ---------------------------------------------------------------------------

test('runGradle collects merged stdout+stderr and resolves the canonical result', async () => {
  const fake = fakeChild()
  const result = await runGradle({
    projectDir: 'C:/proj',
    task: 'build',
    timeoutMs: 5000,
    tailChars: 1000,
    internals: {
      platform: 'linux',
      spawnImpl: (program, args, options) => {
        assert.equal(program, './gradlew')
        assert.deepEqual(args, ['build'])
        assert.equal(options.cwd, 'C:/proj')
        assert.equal(options.windowsHide, true)
        assert.equal(options.windowsVerbatimArguments, false, 'verbatim quoting is win32-only')
        assert.equal(options.detached, true, 'posix spawns its own process group')
        setImmediate(() => {
          fake.emitData('stdout line\n')
          fake.emitData('stderr line\n')
          fake.emitClose(0, null)
        })
        return fake.child
      },
    },
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.signal, null)
  assert.equal(result.timedOut, false)
  assert.equal(result.aborted, false)
  assert.equal(result.timeoutMs, 5000)
  assert.deepEqual(result.output, { text: 'stdout line\nstderr line\n', truncated: false })
})

test('runGradle reports a non-zero exit instead of throwing', async () => {
  const fake = fakeChild({ exitCode: 1 })
  const result = await runGradle({
    projectDir: '/p',
    task: 'build',
    timeoutMs: 5000,
    tailChars: 1000,
    internals: {
      platform: 'linux',
      spawnImpl: () => { setImmediate(() => fake.emitClose(1, null)); return fake.child },
    },
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.timedOut, false)
  assert.equal(result.aborted, false)
})

test('runGradle kills the process tree and reports timedOut on expiry', async () => {
  const fake = fakeChild()
  const kills = []
  const result = await runGradle({
    projectDir: '/p',
    task: 'build',
    timeoutMs: 20,
    tailChars: 1000,
    internals: {
      platform: 'linux',
      spawnImpl: () => fake.child, // never closes on its own
      killTreeImpl: (platform, pid) => { kills.push([platform, pid]); fake.emitClose(null, 'SIGTERM') },
    },
  })
  assert.equal(result.timedOut, true)
  assert.equal(result.aborted, false)
  assert.deepEqual(kills, [['linux', 4242]])
})

test('runGradle kills the tree and reports aborted on the exec signal', async () => {
  const fake = fakeChild()
  const controller = new AbortController()
  const kills = []
  const result = await runGradle({
    projectDir: '/p',
    task: 'build',
    timeoutMs: 10000,
    tailChars: 1000,
    signal: controller.signal,
    internals: {
      platform: 'win32',
      spawnImpl: (program, args, options) => {
        assert.equal(program, 'cmd.exe')
        assert.equal(options.windowsVerbatimArguments, true, 'win32 passes the cmd string verbatim')
        setImmediate(() => controller.abort())
        return fake.child
      },
      killTreeImpl: (platform, pid) => { kills.push([platform, pid]); fake.emitClose(null, 'SIGTERM') },
    },
  })
  assert.equal(result.aborted, true)
  assert.equal(result.timedOut, false)
  assert.deepEqual(kills, [['win32', 4242]])
})

test('runGradle caps merged output to head and tail', async () => {
  const fake = fakeChild()
  const result = await runGradle({
    projectDir: '/p',
    task: 'build',
    timeoutMs: 5000,
    tailChars: 100,
    internals: {
      platform: 'linux',
      spawnImpl: () => {
        setImmediate(() => {
          fake.emitData('H'.repeat(60) + 'M'.repeat(200) + 'T'.repeat(60))
          fake.emitClose(0, null)
        })
        return fake.child
      },
    },
  })
  assert.equal(result.output.truncated, true)
  assert.ok(result.output.text.startsWith('H'.repeat(50)), 'head = first ceil(100/2) chars')
  assert.ok(result.output.text.endsWith('T'.repeat(50)), 'tail = last floor(100/2) chars')
  assert.match(result.output.text, /\[220 chars truncated\]/)
})

test('runGradle rejects with a readable gradlew message when spawn throws', async () => {
  await assert.rejects(
    runGradle({
      projectDir: '/p',
      task: 'build',
      timeoutMs: 5000,
      tailChars: 1000,
      internals: {
        platform: 'linux',
        spawnImpl: () => { throw Object.assign(new Error('spawn gradlew ENOENT'), { code: 'ENOENT' }) },
      },
    }),
    /gradlew/,
  )
})

test('runGradle rejects when the child emits a spawn error', async () => {
  const fake = fakeChild()
  const promise = runGradle({
    projectDir: '/p',
    task: 'build',
    timeoutMs: 5000,
    tailChars: 1000,
    internals: {
      platform: 'linux',
      spawnImpl: () => { setImmediate(() => fake.emitError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))); return fake.child },
    },
  })
  await assert.rejects(promise, /gradlew/)
})

test('runGradle rejects when the signal is already aborted before spawn', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runGradle({
      projectDir: '/p',
      task: 'build',
      timeoutMs: 5000,
      tailChars: 1000,
      signal: controller.signal,
      internals: { platform: 'linux', spawnImpl: () => { throw new Error('must not spawn') } },
    }),
    /aborted before spawn/,
  )
})

test('runGradle validates timeoutMs and tailChars', async () => {
  const never = { spawnImpl: () => { throw new Error('must not spawn') } }
  await assert.rejects(
    runGradle({ projectDir: '/p', task: 'build', timeoutMs: -1, tailChars: 100, internals: never }),
    /timeoutMs/,
  )
  await assert.rejects(
    runGradle({ projectDir: '/p', task: 'build', timeoutMs: 5000, tailChars: 0, internals: never }),
    /tailChars/,
  )
})

// ---------------------------------------------------------------------------
// render + presenters
// ---------------------------------------------------------------------------

test('renderGradleResult follows the dsh marker contract', () => {
  const base = { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1, output: { text: '' } }
  assert.equal(renderGradleResult({ ...base, output: { text: 'ok\n' } }), 'ok\n')
  assert.equal(renderGradleResult(base), '(no output)')
  assert.equal(
    renderGradleResult({ ...base, exitCode: 2, output: { text: 'x' } }),
    'x\n[exit code: 2]',
  )
  assert.equal(
    renderGradleResult({ ...base, exitCode: null, signal: 'SIGTERM', output: { text: 'x' } }),
    'x\n[killed by signal: SIGTERM]',
  )
  assert.equal(
    renderGradleResult({ ...base, exitCode: null, signal: null, timedOut: true, timeoutMs: 500, output: { text: 'x' } }),
    'x\n[timed out after 500ms]',
  )
})

test('gradleCallView renders the terminal card with cwd and description', () => {
  assert.deepEqual(gradleCallView({ task: 'build', description: 'Build the plugin', projectDir: 'C:/proj' }), {
    card: 'terminal',
    title: 'gradlew build',
    description: 'Build the plugin',
    cwd: 'C:/proj',
  })
  assert.deepEqual(gradleCallView({ task: 'build' }), { card: 'terminal', title: 'gradlew build' })
})

test('parseGradleExitStatus matches the dsh-shell contract', () => {
  assert.deepEqual(parseGradleExitStatus('body here\n[exit code: 3]'), { body: 'body here', exitCode: 3 })
  assert.deepEqual(parseGradleExitStatus('body here\n[killed by signal: SIGTERM]'), { body: 'body here', signal: 'SIGTERM' })
  assert.deepEqual(parseGradleExitStatus('plain body'), { body: 'plain body', exitCode: 0 })
})

test('gradleResultView turns the rendered text into a terminal result view', () => {
  const view = gradleResultView({ task: 'build' }, { content: [{ type: 'text', text: 'output here\n[exit code: 1]' }] })
  assert.deepEqual(view, { card: 'terminal', output: 'output here', exitCode: 1 })

  const killed = gradleResultView({ task: 'build' }, { content: [{ type: 'text', text: 'out\n[killed by signal: SIGTERM]' }] })
  assert.deepEqual(killed, { card: 'terminal', output: 'out', signal: 'SIGTERM' })

  const error = gradleResultView({ task: 'build' }, { isError: true, content: [{ type: 'text', text: 'boom' }] })
  assert.deepEqual(error, { card: 'generic', content: [{ type: 'text', text: '```console\nboom\n```' }] })

  assert.equal(gradleResultView({ task: 'build' }, { content: [] }), undefined)
})
