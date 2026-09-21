/**
 * Codex(Astra) architecture bridge for the "Minecraft 架构师" agent preset.
 *
 * This module is mounted by `preset/minecraft-architect/` ONLY — never by the
 * bundle patch — so the Minecraft expert preset keeps exactly the tool and
 * skill catalog it shipped with. It contributes two things to that one preset:
 *
 * - the `mc_codex` tool, which writes the architecture brief to a visible file
 *   and runs the user's own Codex CLI on it as a normal, inspectable child
 *   process (command, output, exit code, changed files and session id all come
 *   back into the session);
 * - the `minecraft-codex-architect` skill, whose body carries the workflow and
 *   the Coder rules (the Cherry Studio Architect/Coder split, with the
 *   `[TODO: Agent B]` marker as the handoff contract).
 * @module minecraft-dev/codex
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import Schema from '@deepseek-ai/schemastery'
import { architectFacts, renderArchitectBrief } from './lib/architect-brief.js'
import {
  CODEX_SANDBOXES,
  DEFAULT_CODEX_SANDBOX,
  renderCodexResult,
  runCodex,
} from './lib/codex-cli.js'
import { codexCallView, codexResultView } from './lib/present.js'
import { SUPPORTED_PLATFORMS } from './lib/versions.js'

/** Cordis plugin name. */
export const name = 'minecraft-codex'

/** Services this plugin consumes: the tool and skill registries. */
export const inject = ['tools', 'skills']

/** Deployment configuration. */
export const Config = Schema.object({
  /** Default mc_codex timeout: framework-writing runs are long (default 30 min). */
  codexTimeoutMs: Schema.number().default(1_800_000),
  /** Characters mc_codex keeps from the merged Codex output (head + tail). */
  outputTailChars: Schema.number().default(20_000),
})

/** The single skill this module contributes (preset-scoped, unlike skills.js). */
const SKILL_NAME = 'minecraft-codex-architect'
const SKILL_PROVIDER = 'minecraft-dev-codex'

const SKILL_DESCRIPTION = 'Use the user\'s own Codex (Astra) as a Minecraft ARCHITECT: write a '
  + 'visible architecture brief, run `codex exec` on it, and get a skeleton whose business-logic '
  + 'method bodies are `// [TODO: Agent B] <description>` markers plus a FILL-SPEC.md. Then fill '
  + 'exactly those markers yourself and verify with mc_gradle. Use only when the user explicitly '
  + 'asks for Codex/Astra or for an architect/coder split, and only when the mc_codex tool is '
  + 'available in this session.'

const ASSET_DIR = fileURLToPath(new URL('./assets/codex-architect/', import.meta.url))
const SKILL_LOCATOR = new URL('./assets/codex-architect/SKILL.md', import.meta.url)

const CODEX_DESCRIPTION = 'Use the user\'s own Codex CLI as an architect for one Minecraft project. '
  + 'Writes <projectDir>/.dsh/codex-architect.md (the exact prompt, readable and editable), then '
  + 'runs `codex exec` on it through a visible command with the user\'s own Codex account and '
  + 'configuration. Returns the command, the full merged output, the exit code, the files the run '
  + 'changed, and the Codex session id (resume with `codex resume <id>`). The prompt is sent on '
  + 'stdin, so nothing is hidden and the user can re-run the same command themselves. Expect a '
  + 'skeleton with `// [TODO: Agent B] <description>` markers plus a FILL-SPEC.md; that is the '
  + 'handoff contract for mc_codex uses.'

/** Assert the target project directory exists; a missing one is a caller bug. */
async function assertProjectDir(projectDir) {
  let info
  try {
    info = await stat(projectDir)
  } catch {
    throw new Error(`projectDir does not exist: ${projectDir} — create it (mc_scaffold or mkdir) before calling mc_codex`)
  }
  if (!info.isDirectory()) throw new Error(`projectDir is not a directory: ${projectDir}`)
}

/** The bundled skill provider, mirroring the skills.js provider pattern. */
function makeSkillProvider() {
  const candidate = {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: SKILL_PROVIDER,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: ASSET_DIR },
    rank: BUNDLED_SKILL_RANK,
    locator: SKILL_LOCATOR,
  }
  return {
    name: SKILL_PROVIDER,
    list: () => Promise.resolve([candidate]),
    async get() {
      return { ...candidate, content: await readFile(SKILL_LOCATOR, 'utf8') }
    },
  }
}

/** Register the mc_codex tool and the architect skill on `ctx`. */
export function apply(ctx, config = {}) {
  const provider = makeSkillProvider()
  ctx.skills.registerProvider(() => provider)

  ctx.tools.register(defineTool({
    name: 'mc_codex',
    description: CODEX_DESCRIPTION,
    parameters: {
      projectDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the existing project directory. Codex runs with this as its working directory (-C).',
      },
      goal: {
        type: 'string',
        required: true,
        description: 'What the plugin should do — one paragraph of functional requirements for the architect.',
      },
      platform: {
        type: 'string',
        required: true,
        enum: [...SUPPORTED_PLATFORMS],
        description: `Project platform. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
      },
      minecraftVersion: {
        type: 'string',
        required: true,
        description: 'Target Minecraft version, e.g. 1.21.8, 1.12.2, 26.2. Coordinates come from the shipped line matrix.',
      },
      javaVersion: {
        type: 'integer',
        enum: [8, 17, 21, 25],
        description: 'Java language level for the brief. Omit for the era default.',
      },
      sandbox: {
        type: 'string',
        enum: [...CODEX_SANDBOXES],
        description: `Codex sandbox (-s) for the run. Default ${DEFAULT_CODEX_SANDBOX}, which the architect needs to write files.`,
      },
      model: {
        type: 'string',
        description: 'Codex model (-m) for this run, e.g. deepseek-v4-pro. Omit to use the user\'s native Codex model.',
      },
      timeoutMs: {
        type: 'number',
        description: `Timeout in milliseconds; defaults to ${config.codexTimeoutMs ?? 1_800_000}. The whole process tree is killed on expiry.`,
      },
      description: {
        type: 'string',
        description: 'Short human description shown on the terminal card.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', required: true },
          executable: { type: 'string', required: true },
          projectDir: { type: 'string', required: true },
          promptFile: { type: 'string', required: true },
          lastMessageFile: { type: 'string', required: true },
          sandbox: { type: 'string', required: true },
          model: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          timeoutMs: { type: 'number', required: true },
          durationMs: { type: 'number', required: true },
          sessionId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          rolloutPath: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          filesChanged: { type: 'array', required: true, items: { type: 'string' } },
          briefBytes: { type: 'number', required: true },
          target: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              platform: { type: 'string', required: true },
              minecraftVersion: { type: 'string', required: true },
              javaVersion: { type: 'number', required: true },
              apiCoord: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            },
          },
          output: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderCodexResult(value, {
          projectDir: value.projectDir,
          sandbox: value.sandbox,
          model: value.model,
        }),
      }],
    },
    async execute(args, exec) {
      const projectDir = args.projectDir
      await assertProjectDir(projectDir)

      const facts = architectFacts({
        platform: args.platform,
        minecraftVersion: args.minecraftVersion,
        javaVersion: args.javaVersion,
      })
      const template = await readFile(new URL('./assets/codex-architect/references/architect-prompt.md', import.meta.url), 'utf8')
      const brief = renderArchitectBrief({ template, facts, projectDir, goal: args.goal })

      const dotDsh = join(projectDir, '.dsh')
      await mkdir(dotDsh, { recursive: true })
      const promptFile = join(dotDsh, 'codex-architect.md')
      await writeFile(promptFile, brief, 'utf8')
      const lastMessageFile = join(dotDsh, 'codex-last-message.md')

      const sandbox = args.sandbox ?? DEFAULT_CODEX_SANDBOX
      const timeoutMs = args.timeoutMs ?? config.codexTimeoutMs ?? 1_800_000
      const result = await runCodex({
        projectDir,
        promptFile,
        sandbox,
        model: args.model,
        lastMessageFile,
        timeoutMs,
        tailChars: config.outputTailChars ?? 20_000,
        signal: exec.signal,
      })

      return {
        command: result.command,
        executable: result.executable,
        projectDir,
        promptFile,
        lastMessageFile,
        sandbox,
        model: args.model ?? null,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        aborted: result.aborted,
        timeoutMs: result.timeoutMs,
        durationMs: result.durationMs,
        sessionId: result.sessionId,
        rolloutPath: result.rolloutPath,
        filesChanged: result.filesChanged,
        briefBytes: Buffer.byteLength(brief, 'utf8'),
        target: {
          platform: facts.platform,
          minecraftVersion: facts.minecraftVersion,
          javaVersion: facts.javaVersion,
          apiCoord: facts.apiCoord,
        },
        output: result.output,
      }
    },
    presentCall: codexCallView,
    presentResult: codexResultView,
  }))
}
