/**
 * The `minecraft-architect` agent preset as a Cordis entry list (the dsh 0.1.7+ form).
 *
 * GENERATED from `preset/minecraft-architect/agent.cordis.yml` by the repo's preset generator;
 * edit the YAML (the 0.1.5-era directory install's source) and regenerate, never
 * this file. `test/preset-rows-parity.test.js` asserts the two forms agree.
 *
 * Two substitutions are applied to the JS form only, because dsh 0.1.7 removed
 * the packages the YAML names:
 *   - `disabled: !!js process.platform === '…'` becomes a real boolean, resolved
 *     when this module loads in the host process;
 *   - `@deepseek-ai/dsh-workflow-worker-thread` becomes
 *     `@deepseek-ai/dsh-workflow-ptc`.
 *
 * This module DERIVES the architect rows from `../minecraft/rows.js` by applying
 * the same two insertions the YAML parity test strips: the Astra section appended
 * to the persona prefix, and the trailing `codex-architect` row.
 * @module minecraft-dev/preset/minecraft-architect/rows
 */

import { minecraftPreset } from '../minecraft/rows.js'

/** The Astra section appended to the expert persona, byte-for-byte from the YAML. */
const ASTRA_SECTION = `

## Codex（Astra）架构分工

This preset adds exactly two things over the Minecraft expert preset: the \`mc_codex\`
tool and the \`minecraft-codex-architect\` skill (both mounted by this preset only).
Use them only when the user names Codex/Astra or asks for an architect/coder split;
otherwise work exactly as the expert preset does.

The split: Codex — the user's own CLI, on the user's own account — writes the
skeleton, marks every business-logic method body \`// [TODO: Agent B] <description>\`,
and writes FILL-SPEC.md; you then fill exactly those markers and verify with
mc_gradle. Never change method signatures, class structures or interfaces, and never
write those markers yourself.

Transparency is mandatory, not optional. Before running, tell the user that this
consumes their own Codex account (a subscription counts against its Codex usage
window; an API key counts against its balance) and that DSH does not display that
spend. Show the exact command mc_codex returns. Report the full merged output, the
exit code, the duration, the changed-file list, the Codex thread/session id, the
rollout path and the token total mc_codex found. Say plainly which transport ran:
\`mode: "app-server"\` (the default) creates a real Codex thread that DOES appear in
the Codex desktop app and continues with \`codex resume <threadId>\`; \`mode: "exec"\`
leaves a \`source: exec\` thread the app sidebar does not list, continued with
\`codex exec resume <sessionId> "…"\` or by opening the rollout file. Either way the
run is persisted under \`~/.codex/sessions/...\`. Never retry silently.
At most one architecture delegation plus one repair delegation.

If mc_codex reports that no Codex CLI was found, or the run fails, do the work
yourself instead (inline, or the A–D subagent chain) and never leave
\`[TODO: Agent B]\` markers behind.`

/** Display metadata, mirroring `preset.yml`. */
export const META = {
    name: "Minecraft 架构师（Astra神的瞥视）",
    description: `在 Minecraft 专家预设之上增加 Codex（Astra）架构分工：用你自己装好的 Codex CLI 写项目框架，并留下 [TODO: Agent B] 标记与 FILL-SPEC.md；DSH 负责填内容与构建验证。命令、输出、改动文件、会话 id 全程公开，可 codex resume 接管。`,
    order: 6,
  }

/** The preset definition handed to `agentPresets.register()`. */
export const minecraftArchitectPreset = {
  id: 'minecraft-architect',
  name: META.name,
  description: META.description,
  order: META.order,
  plugins: [
    { ...minecraftPreset.plugins[0], config: { ...minecraftPreset.plugins[0].config, prefix: minecraftPreset.plugins[0].config.prefix + ASTRA_SECTION } },
    ...minecraftPreset.plugins.slice(1),
    { id: 'codex-architect', name: 'minecraft-dev/codex' },
  ],
}

export default minecraftArchitectPreset
