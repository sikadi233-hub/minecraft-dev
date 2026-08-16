/**
 * Execution mechanism for the mc_gradle tool: runs one gradlew task in a
 * project directory via node:child_process spawn, with bounded output
 * collection, timeout/abort process-tree termination, and the dsh canonical
 * result shape. minecraft-dev does not inject the shell service, so this
 * re-implements the dsh subprocess-local mechanism (~spawn.ts) in ~100 lines:
 * cmd.exe wrapper selection, taskkill / PID /T /F tree kills, SIGTERM to the
 * negative process group on POSIX, and head+tail output capping with a
 * truncation marker. The spawn implementation is injectable (spawnImpl) so
 * unit tests run a fake child process with no real subprocess.
 * @module minecraft-dev/lib/gradle
 */

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * The truncation marker shared by {@link capOutput} and the live collector:
 * `\n… [N chars truncated] …\n`. The wording mirrors the dsh truncation
 * notice contract so terminal cards read the same way (mc_gradle writes no
 * spill file, so the notice is inline instead of pointing at one).
 * @param {number} dropped - number of characters omitted from the middle.
 * @returns {string} the marker line, newline-delimited both sides.
 */
function truncatedMarker(dropped) {
  return `\n… [${dropped} chars truncated] …\n`
}

/**
 * Construct the full argv for one gradlew run. Windows executes the .bat
 * through cmd.exe (`/d /s /c`), with each extra argument quoted and embedded
 * quotes escaped; POSIX runs `./gradlew` directly.
 *
 * win32 specifics (real-Windows smoke, V03 R10): the wrapper is resolved to an
 * absolute path inside projectDir and the whole command is wrapped in outer
 * quotes (`""C:\proj\gradlew.bat" build"`), so cmd never depends on its
 * current-directory command search (the `NoDefaultCurrentDirectoryInExePath`
 * env var disables it on hardened hosts) and `/s /c` strips only the outer
 * quotes. The caller must spawn with `windowsVerbatimArguments: true` on
 * win32: node's default quoting escapes `"` to `\"`, which cmd.exe does not
 * parse, and this argv already carries the exact quotes cmd needs.
 * @param {object} options
 * @param {string} [options.platform] - host platform; defaults to process.platform.
 * @param {string} [options.gradlew] - wrapper script name (defaults to
 *   `gradlew.bat` on win32, `./gradlew` elsewhere); resolved against projectDir on win32.
 * @param {string} [options.projectDir] - project root the win32 wrapper is
 *   resolved against; defaults to the process cwd.
 * @param {string} options.task - the Gradle task to run, e.g. 'build'.
 * @param {string[]} [options.args] - extra arguments appended to the task.
 * @returns {string[]} the complete spawn argv.
 */
export function gradleArgv(options) {
  const { platform = process.platform, gradlew, task, args = [], projectDir = '.' } = options
  if (platform === 'win32') {
    const wrapper = path.win32.resolve(projectDir, gradlew ?? 'gradlew.bat')
    const command = [quoteCmdArg(wrapper), task, ...args.map(quoteCmdArg)].join(' ')
    return ['cmd.exe', '/d', '/s', '/c', `"${command}"`]
  }
  return [gradlew ?? './gradlew', task, ...args]
}

/** Quote one argument for a cmd.exe command line, escaping embedded quotes. */
function quoteCmdArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`
}

/**
 * Head/tail truncation as a pure function. Short text passes through
 * unchanged; long text keeps the first ceil(tailChars/2) and last
 * floor(tailChars/2) characters joined by the truncation marker. This is the
 * exact deterministic boundary {@link runGradle}'s live collector reproduces
 * without retaining the whole stream.
 * @param {string} text - the full output text.
 * @param {number} tailChars - total characters to keep (head + tail).
 * @returns {{ text: string, truncated: boolean }}
 */
export function capOutput(text, tailChars) {
  if (text.length <= tailChars) return { text, truncated: false }
  const headLen = Math.ceil(tailChars / 2)
  const tailLen = Math.floor(tailChars / 2)
  const marker = truncatedMarker(text.length - tailChars)
  return { text: text.slice(0, headLen) + marker + text.slice(text.length - tailLen), truncated: true }
}

/**
 * Kill a process tree. win32 runs `taskkill /PID <pid> /T /F` via spawnSync —
 * spawnSync never throws, so an absent tree or a missing taskkill binary is
 * ignored, exactly like dsh-subprocess-local's taskkillProcessTree; POSIX
 * SIGTERMs the negative process-group id (the child was spawned detached).
 * Best-effort and idempotent: delivery races process exit. A non-positive pid
 * is a no-op.
 * @param {string} platform - host platform.
 * @param {number} pid - root process id (the spawned child's pid).
 * @param {{ spawnSyncImpl?: Function, processKillImpl?: Function }} [internals]
 *   - spawnSyncImpl: taskkill runner for tests; defaults to node's spawnSync.
 *   - processKillImpl: signal sender for tests; defaults to process.kill.
 */
export function killTree(platform, pid, internals = {}) {
  const { spawnSyncImpl = spawnSync, processKillImpl = process.kill } = internals
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return
  if (platform === 'win32') {
    spawnSyncImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    processKillImpl(-pid, 'SIGTERM')
  } catch {
    // Swallow: the tree may already be gone; teardown stays idempotent (dsh contract).
  }
}

/**
 * Bounded merged stdout+stderr collector: keeps only the first
 * ceil(tailChars/2) characters and a ring of the last floor(tailChars/2),
 * plus a dropped-character count — the full stream never stays in memory.
 * The final text is byte-for-byte what {@link capOutput} would produce.
 */
function createOutputCollector(tailChars) {
  const headCap = Math.ceil(tailChars / 2)
  const tailCap = Math.floor(tailChars / 2)
  let totalChars = 0
  let head = [] // retained leading parts, <= headCap chars total
  let headLen = 0
  let headFull = false
  let tail = [] // ring of the last <= tailCap chars, in order
  let tailLen = 0

  const trimTail = () => {
    while (tailLen > tailCap) {
      const first = tail[0]
      if (first.length <= tailLen - tailCap) {
        tail.shift()
        tailLen -= first.length
      } else {
        tail[0] = first.slice(tailLen - tailCap)
        tailLen = tailCap
      }
    }
  }

  const push = (text) => {
    if (text.length === 0) return
    totalChars += text.length
    if (headFull) {
      tail.push(text)
      tailLen += text.length
      trimTail()
    } else if (headLen + text.length <= headCap) {
      head.push(text)
      headLen += text.length
    } else {
      // The chunk straddles the head/tail boundary: slice it.
      const room = headCap - headLen
      head.push(text.slice(0, room))
      headLen = headCap
      headFull = true
      const rest = text.slice(room)
      if (rest.length > 0) {
        tail.push(rest)
        tailLen = rest.length
        trimTail()
      }
    }
  }

  const finalize = () => {
    if (totalChars <= tailChars) {
      // Head + tail cover the whole stream in order (capacity is exactly tailChars).
      return { text: [...head, ...tail].join(''), truncated: false }
    }
    const dropped = totalChars - tailChars
    return { text: head.join('') + truncatedMarker(dropped) + tail.join(''), truncated: true }
  }

  return { push, finalize }
}

/**
 * Run one gradlew task in the foreground and return the canonical result.
 * Non-zero exits are reported in the result, never thrown; only spawn
 * failures (e.g. a missing gradlew) reject, with a readable message. The
 * timeout timer races the exec abort signal: whoever fires first sets its
 * classification flag and kills the process tree; close resolves with the
 * flags plus the child's own exitCode/signal. The spawn implementation and
 * the tree killer are injectable for unit tests.
 * @param {object} options
 * @param {string} options.projectDir - project root; must contain gradlew/gradlew.bat.
 * @param {string} options.task - gradle task, e.g. 'build'.
 * @param {string[]} [options.args] - extra arguments appended to the task.
 * @param {number} options.timeoutMs - timeout in milliseconds; kills the tree on expiry.
 * @param {AbortSignal} [options.signal] - exec.signal; kills the tree on abort.
 * @param {number} options.tailChars - characters to keep from merged output (head+tail).
 * @param {{ spawnImpl?: Function, killTreeImpl?: Function, platform?: string }} [internals]
 *   - spawnImpl(program, args, options) -> ChildProcess-like; defaults to node's spawn.
 *   - killTreeImpl(platform, pid) -> void; defaults to {@link killTree}.
 *   - platform: host override for argv selection and kill branch.
 * @returns {Promise<{ exitCode: number|null, signal: string|null, timedOut: boolean, aborted: boolean, timeoutMs: number, output: { text: string, truncated: boolean } }>}
 */
export async function runGradle(options) {
  const { projectDir, task, args = [], timeoutMs, signal, tailChars, internals = {} } = options
  const platform = internals.platform ?? process.platform
  const spawnImpl = internals.spawnImpl ?? spawn
  const killTreeImpl = internals.killTreeImpl ?? ((p, pid) => killTree(p, pid, internals))
  const argv = gradleArgv({ platform, projectDir, task, args })

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(timeoutMs)}`)
  }
  if (!Number.isFinite(tailChars) || tailChars <= 0) {
    throw new Error(`invalid tailChars: expected a positive number, got ${JSON.stringify(tailChars)}`)
  }
  if (signal?.aborted) {
    throw new Error(`mc_gradle aborted before spawn: ${String(signal.reason ?? 'aborted')}`)
  }

  /** @type {import('node:child_process').ChildProcess} */
  let child
  try {
    child = spawnImpl(argv[0], argv.slice(1), {
      cwd: projectDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // win32: pass the cmd command string verbatim — node's default quoting
      // escapes `"` to `\"`, which cmd.exe cannot parse (see gradleArgv).
      windowsVerbatimArguments: platform === 'win32',
      // POSIX: own process group so kill(-pid) reaches the whole tree;
      // win32 kills by root pid through taskkill /T instead (dsh-spawn contract).
      detached: platform !== 'win32',
    })
  } catch (error) {
    throw new Error(`failed to start gradlew in ${projectDir}: ${error.message}`)
  }

  const pid = typeof child?.pid === 'number' ? child.pid : -1

  return new Promise((resolve, reject) => {
    const collector = createOutputCollector(tailChars)
    const collect = (stream) => {
      if (stream?.on) stream.on('data', (chunk) => collector.push(String(chunk)))
    }
    collect(child.stdout)
    collect(child.stderr)

    let timedOut = false
    let aborted = false
    let settled = false

    // Timeout and abort race: the first to fire classifies the outcome.
    const fireTimeout = () => {
      if (settled) return
      timedOut = true
      killTreeImpl(platform, pid)
    }
    const fireAbort = () => {
      if (settled) return
      aborted = true
      killTreeImpl(platform, pid)
    }
    const timer = setTimeout(fireTimeout, timeoutMs)
    const onAbort = () => fireAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`failed to run gradlew in ${projectDir}: ${error.message}`))
    })
    child.on('close', (exitCode, signalCode) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        exitCode,
        signal: signalCode,
        timedOut,
        aborted,
        timeoutMs,
        output: collector.finalize(),
      })
    })
  })
}

/**
 * Render a canonical mc_gradle result into the model-facing text, reusing the
 * dsh marker contract (tool-bash render.ts): the output body, then the
 * timeout / signal / exit markers, with the exit marker last because the
 * terminal-card parse anchors there. `[stderr]` sections never appear —
 * stdout and stderr are one merged stream — and the truncation notice is
 * already inline in output.text (no spill file is written).
 * @param {{ exitCode: number|null, signal: string|null, timedOut: boolean, timeoutMs: number, output: { text: string } }} result
 * @returns {string} the marker-suffixed output text.
 */
export function renderGradleResult(result) {
  let body = result.output.text
  if (body.length === 0) body = '(no output)'
  const markers = []
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
    // No exit marker: parseGradleExitStatus anchors on [exit code: N] with
    // digits only, and a signal-killed run has no meaningful numeric code.
  } else if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}
