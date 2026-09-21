/**
 * Generic bounded process runner shared by mc_gradle and mc_codex.
 *
 * This is the mechanism `lib/gradle.js` used to own privately, extracted so a
 * second tool can run a real child process with the same discipline: merged
 * stdout+stderr collected under a head+tail cap (the full stream never stays in
 * memory), a timeout and an abort signal that both race the child, whole
 * process-tree termination, and the canonical result shape
 * `{ exitCode, signal, timedOut, aborted, timeoutMs, output }`.
 *
 * minecraft-dev does not inject the shell service, so this re-implements the
 * dsh subprocess-local mechanism in ~100 lines: cmd.exe wrapper selection lives
 * in the caller, taskkill / PID /T /F tree kills and the POSIX negative-pid
 * SIGTERM live here, and the spawn implementation is injectable (spawnImpl) so
 * unit tests run a fake child process with no real subprocess.
 * @module minecraft-dev/lib/run-process
 */

import { spawn, spawnSync } from 'node:child_process'

/**
 * The truncation marker shared by {@link capOutput} and the live collector:
 * `\n… [N chars truncated] …\n`. The wording mirrors the dsh truncation
 * notice contract so terminal cards read the same way (neither tool writes a
 * spill file, so the notice is inline instead of pointing at one).
 * @param {number} dropped - number of characters omitted from the middle.
 * @returns {string} the marker line, newline-delimited both sides.
 */
export function truncatedMarker(dropped) {
  return `\n… [${dropped} chars truncated] …\n`
}

/**
 * Head/tail truncation as a pure function. Short text passes through
 * unchanged; long text keeps the first ceil(tailChars/2) and last
 * floor(tailChars/2) characters joined by the truncation marker. This is the
 * exact deterministic boundary {@link runProcess}'s live collector reproduces
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
 * @param {number} tailChars - total characters to keep (head + tail).
 * @returns {{ push: (text: string) => void, finalize: () => { text: string, truncated: boolean } }}
 */
export function createOutputCollector(tailChars) {
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
 * Run one child process in the foreground and return the canonical result.
 * Non-zero exits are reported in the result, never thrown; only spawn failures
 * (e.g. a missing executable) reject, with a readable message. The timeout
 * timer races the exec abort signal: whoever fires first sets its
 * classification flag and kills the process tree; close resolves with the
 * flags plus the child's own exitCode/signal. The spawn implementation and the
 * tree killer are injectable for unit tests.
 * @param {object} options
 * @param {string[]} options.argv - complete spawn argv (`argv[0]` is the program).
 * @param {string} options.cwd - working directory for the child.
 * @param {number} options.timeoutMs - timeout in milliseconds; kills the tree on expiry.
 * @param {number} options.tailChars - characters to keep from merged output (head+tail).
 * @param {AbortSignal} [options.signal] - exec.signal; kills the tree on abort.
 * @param {{ program?: string, abort?: string }} [options.labels] - names used in
 *   rejection messages; `program` (default `process`) names the executable and
 *   `abort` (default `process`) the aborting tool.
 * @param {{ spawnImpl?: Function, killTreeImpl?: Function, platform?: string }} [internals]
 *   - spawnImpl(program, args, options) -> ChildProcess-like; defaults to node's spawn.
 *   - killTreeImpl(platform, pid) -> void; defaults to {@link killTree}.
 *   - platform: host override for spawn flags and the kill branch.
 * @returns {Promise<{ exitCode: number|null, signal: string|null, timedOut: boolean, aborted: boolean, timeoutMs: number, output: { text: string, truncated: boolean } }>}
 */
export async function runProcess(options) {
  const { argv, cwd, timeoutMs, tailChars, signal, labels = {}, internals = {} } = options
  const program = labels.program ?? 'process'
  const abortName = labels.abort ?? program
  const platform = internals.platform ?? process.platform
  const spawnImpl = internals.spawnImpl ?? spawn
  const killTreeImpl = internals.killTreeImpl ?? ((p, pid) => killTree(p, pid, internals))

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(timeoutMs)}`)
  }
  if (!Number.isFinite(tailChars) || tailChars <= 0) {
    throw new Error(`invalid tailChars: expected a positive number, got ${JSON.stringify(tailChars)}`)
  }
  if (signal?.aborted) {
    throw new Error(`${abortName} aborted before spawn: ${String(signal.reason ?? 'aborted')}`)
  }

  /** @type {import('node:child_process').ChildProcess} */
  let child
  try {
    child = spawnImpl(argv[0], argv.slice(1), {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // win32: pass the caller's command string verbatim — node's default
      // quoting escapes `"` to `\"`, which cmd.exe cannot parse.
      windowsVerbatimArguments: platform === 'win32',
      // POSIX: own process group so kill(-pid) reaches the whole tree;
      // win32 kills by root pid through taskkill /T instead (dsh-spawn contract).
      detached: platform !== 'win32',
    })
  } catch (error) {
    throw new Error(`failed to start ${program} in ${cwd}: ${error.message}`)
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
      reject(new Error(`failed to run ${program} in ${cwd}: ${error.message}`))
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
 * Render a canonical process result into model-facing text, reusing the dsh
 * marker contract (tool-bash render.ts): the output body, then the timeout /
 * signal / exit markers, with the exit marker last because the terminal-card
 * parse anchors there. `[stderr]` sections never appear — stdout and stderr
 * are one merged stream — and the truncation notice is already inline in
 * output.text (no spill file is written).
 * @param {{ exitCode: number|null, signal: string|null, timedOut: boolean, timeoutMs: number, output: { text: string } }} result
 * @param {{ emptyText?: string, header?: string[], footer?: string[] }} [options]
 *   - emptyText: body used when the process printed nothing (default `(no output)`).
 *   - header: lines rendered before the body (e.g. the command that ran).
 *   - footer: lines rendered after the body but before the markers.
 * @returns {string} the assembled text with the marker block last.
 */
export function renderProcessResult(result, options = {}) {
  const { emptyText = '(no output)', header = [], footer = [] } = options
  let body = result.output.text
  if (body.length === 0) body = emptyText
  const markers = []
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
    // No exit marker: parseGradleExitStatus anchors on [exit code: N] with
    // digits only, and a signal-killed run has no meaningful numeric code.
  } else if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }

  const prefix = header.length > 0 ? `${header.join('\n')}\n` : ''
  const tailLines = [...footer, ...markers]
  if (tailLines.length === 0) return prefix + body
  const text = prefix + body
  if (!text.endsWith('\n')) return `${text}\n${tailLines.join('\n')}`
  return text + tailLines.join('\n')
}
