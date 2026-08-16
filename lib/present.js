/**
 * Pure presenter views for the minecraft-dev tools. These run on both live
 * calls and session-log replay, so they must be pure functions of their
 * arguments — no I/O, no clocks, no session reads.
 * @module minecraft-dev/lib/present
 */

import { PLATFORM_LABELS } from './versions.js'

/**
 * Pending-card view for mc_scaffold.
 * @param {{ platform: string, minecraftVersion: string, targetDir: string, name: string }} args
 * @returns {{ card: 'generic', title: string, kind: 'edit', rawInput: object }}
 */
export function scaffoldCallView(args) {
  const label = PLATFORM_LABELS[args.platform] ?? args.platform
  return {
    card: 'generic',
    title: `Scaffold ${label} "${args.name}" (MC ${args.minecraftVersion})`,
    kind: 'edit',
    rawInput: {
      platform: args.platform,
      minecraftVersion: args.minecraftVersion,
      targetDir: args.targetDir,
      name: args.name,
      packageName: args.packageName,
    },
  }
}

/**
 * Parse the exit-status markers off the rendered mc_gradle text, mirroring
 * the `parseExitStatus` contract of @deepseek-ai/dsh-shell (render.ts): the
 * signal marker wins over the exit marker, and the body is the text before
 * the marker line's leading newline. minecraft-dev does not depend on
 * dsh-shell, so the two regexes are re-implemented here — the marker text
 * (`[exit code: N]` / `[killed by signal: X]`) is a stable shared contract,
 * and drift would break terminal-card exit pills (V03_PLAN R14).
 * @param {string} text - rendered result text (from renderGradleResult).
 * @returns {{ body: string, exitCode?: number, signal?: string }}
 */
export function parseGradleExitStatus(text) {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: text, exitCode: 0 }
}

/**
 * Pending-card view for mc_gradle: a terminal card headed by the gradlew
 * invocation, with the human description above it and the project root as the
 * working directory, mirroring presentBashCall's foreground branch.
 * @param {{ task: string, description?: string, projectDir?: string }} args
 * @returns {{ card: 'terminal', title: string, description?: string, cwd?: string }}
 */
export function gradleCallView(args) {
  return {
    card: 'terminal',
    title: `gradlew ${args.task}`,
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.projectDir !== undefined ? { cwd: args.projectDir } : {}),
  }
}

/**
 * Completed-card view for mc_gradle, mirroring presentBashResult: the exit
 * marker becomes the terminal card's exit pill and leaves the output body;
 * execution errors fall back to a generic fenced card without a pill.
 * @param {object} args - the call args (unused; kept for signature parity).
 * @param {{ content: Array<{ type: string, text?: string }>, isError?: boolean }} result
 * @returns {{ card: 'terminal', output: string, exitCode?: number, signal?: string }
 *   | { card: 'generic', content: Array<{ type: 'text', text: string }> } | undefined}
 */
export function gradleResultView(args, result) {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  const raw = block.text
  if (result.isError) {
    return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
  }
  const { body, ...exit } = parseGradleExitStatus(raw)
  return { card: 'terminal', output: body, ...exit }
}
