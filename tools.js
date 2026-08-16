/**
 * Minecraft development tools for DeepSeek Harness. v0.3 registers
 * `mc_scaffold` for Paper, Fabric, Forge (1.7.10/1.12.2/1.16.5/1.20.1),
 * NeoForge and Spigot (1.7.10/1.12.2), plus `mc_gradle` (v0.3) which runs a
 * Gradle task via the project wrapper. Deployment tunables (gradle timeout,
 * output tail) are Config fields — see cordis.patch.yml.
 * @module minecraft-dev/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { renderGradleResult, runGradle } from './lib/gradle.js'
import { gradleCallView, gradleResultView, scaffoldCallView } from './lib/present.js'
import { scaffoldProject } from './lib/scaffold.js'
import { SUPPORTED_PLATFORMS } from './lib/versions.js'

const SCAFFOLD_DESCRIPTION = `Create a new Minecraft project from the bundled template. `
  + `Generates the complete Gradle project: build scripts, main class, plugin/mod metadata, `
  + `and a Gradle wrapper so the project builds without a Gradle installation. `
  + `Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}. `
  + `targetDir must be a new or empty directory. javaVersion defaults to the era's level `
  + `(8 for the 1.7.10/1.12.2/1.16.5 lines, 17 for 1.20.x, 21 for 1.21.x, 25 for 26.x) when omitted. `
  + `After scaffolding, run "gradlew.bat build" (Windows) or "./gradlew build" in targetDir; `
  + `the first build downloads dependencies and takes several minutes.`

const SCAFFOLD_OUTPUT_DESCRIPTION = {
  platform: 'The platform scaffolded.',
  minecraftVersion: 'The Minecraft version the project targets.',
  projectDir: 'Absolute path of the created project root.',
  filesCreated: 'Root-relative paths of every file written.',
  buildCommand: 'The shell command that builds the project.',
  wrapperReady: 'Whether the Gradle wrapper files were included.',
}

/** Cordis plugin name. */
export const name = 'minecraft-tools'
/** Service required by the tool consumer. */
export const inject = ['tools']

/**
 * Deployment configuration. Defaults match the values written out in
 * cordis.patch.yml; the schema default is the source of truth.
 */
export const Config = Schema.object({
  /** Default mc_gradle timeout in milliseconds (old lines download slowly on first build). */
  gradleTimeoutMs: Schema.number().default(600_000),
  /** Characters mc_gradle keeps from merged output (head + tail around the truncation marker). */
  outputTailChars: Schema.number().default(12_000),
})

/** Register the minecraft-dev tools on `ctx.tools`. */
export function apply(ctx, config = {}) {
  ctx.tools.register(defineTool({
    name: 'mc_scaffold',
    description: SCAFFOLD_DESCRIPTION,
    parameters: {
      platform: {
        type: 'string',
        required: true,
        enum: [...SUPPORTED_PLATFORMS],
        description: `Project platform. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
      },
      targetDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the new project root directory; must not exist or must be empty.',
      },
      name: {
        type: 'string',
        required: true,
        description: 'Project name in lowercase kebab-case (e.g. my-plugin); used as the jar name and plugin/mod id.',
      },
      packageName: {
        type: 'string',
        required: true,
        description: 'Java package name, e.g. com.example.myplugin.',
      },
      minecraftVersion: {
        type: 'string',
        required: true,
        description: 'Target Minecraft version, e.g. 1.7.10, 1.12.2, 1.16.5, 1.21.8, 1.21.x, 26.2. Supported lines per platform are listed in the error when unknown.',
      },
      javaVersion: {
        type: 'integer',
        enum: [8, 17, 21, 25],
        description: 'Java language level (8, 17, 21, or 25). Omit to use the era default: 8 for the 1.7.10/1.12.2/1.16.5 lines (spigot/forge), 17 for 1.20.x, 21 for 1.21.x, 25 for 26.x.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.platform },
          minecraftVersion: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.minecraftVersion },
          projectDir: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.projectDir },
          filesCreated: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: SCAFFOLD_OUTPUT_DESCRIPTION.filesCreated,
          },
          buildCommand: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.buildCommand },
          wrapperReady: { type: 'boolean', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.wrapperReady },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created ${value.platform} project ${value.projectDir} for Minecraft ${value.minecraftVersion} `
          + `(${value.filesCreated.length} files, Gradle wrapper included). `
          + `Build with: ${value.buildCommand} — the first build downloads dependencies and takes several minutes.`
          + (value.platform === 'spigot' && value.minecraftVersion.startsWith('1.7')
            ? `\nNote: before building, place the vendored API jar into ${value.projectDir}\\libs\\ per libs/README.txt (no public maven hosts 1.7.10 spigot-api).`
            : ''),
      }],
    },
    execute(args, exec) {
      return scaffoldProject({
        platform: args.platform,
        targetDir: args.targetDir,
        name: args.name,
        packageName: args.packageName,
        minecraftVersion: args.minecraftVersion,
        javaVersion: args.javaVersion,
        signal: exec.signal,
      })
    },
    presentCall: scaffoldCallView,
  }))

  ctx.tools.register(defineTool({
    name: 'mc_gradle',
    description: 'Run a Gradle task in a Minecraft project via its wrapper (gradlew / gradlew.bat). '
      + 'Reports the exit code in the result instead of failing on non-zero exits; output is truncated '
      + 'head and tail. Use to build, test, or run client/server tasks (e.g. task="build", task="runClient"). '
      + 'projectDir must be the scaffolded project root containing gradlew.',
    parameters: {
      projectDir: { type: 'string', required: true, description: 'Absolute path of the Gradle project root (must contain gradlew or gradlew.bat).' },
      task: { type: 'string', required: true, description: 'Gradle task to run, e.g. build, clean, runClient, runServer, runData.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Extra arguments appended to the task, e.g. --no-daemon, -Pfoo=bar.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds; defaults to the plugin config gradleTimeoutMs (600000). Kills the whole process tree on expiry.' },
      description: { type: 'string', description: 'Short human description for the terminal card.' },
    },
    output: {
      // Field names mirror the tool-bash foreground branch (canonicalBashResult),
      // minus sandbox/spillPath: mc_gradle has no sandbox and writes no spill
      // file — stdout+stderr are one merged stream with an inline truncation marker.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          timeoutMs: { type: 'number', required: true },
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
      render: (_args, value) => [{ type: 'text', text: renderGradleResult(value) }],
    },
    execute(args, exec) {
      return runGradle({
        projectDir: args.projectDir,
        task: args.task,
        args: args.args,
        timeoutMs: args.timeoutMs ?? config.gradleTimeoutMs,
        signal: exec.signal,
        tailChars: config.outputTailChars,
      })
    },
    presentCall: gradleCallView,
    presentResult: gradleResultView,
  }))
}
