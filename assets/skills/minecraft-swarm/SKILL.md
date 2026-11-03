# Sharded development with the arbitration engine

Use this skill when a Minecraft task spans **three or more modules** (commands,
listeners, storage, GUI, networking…) and the project is large enough that a
single serial pass would drift. For a single file fix, stay on the plain path:
`mc_scaffold` → write code → `mc_gradle build`.

The engine lives in `mc_arbitrate` and is deterministic: **no action calls a
model**. Concurrency comes from the host delegating shards with the existing
`subagent_mc_content` tool (or `subagent`), one shard per child.

## The one protocol

Everything lives under `<project>/.mcdev/`:

```
.mcdev/
├─ contract/contract.json          frozen symbol table, thread model, event priorities, allowlist fingerprint
├─ contract/stubs/*.java           interfaces + DTOs every shard implements
├─ contract/api-allowlist.json     classes a shard may import (from references/api-index/<line>.md)
├─ shards/<shard>/BRIEF.md         the three-block task for that shard
├─ shards/<shard>/RegistrationManifest.json   what the shard needs from the shared files
├─ shards/<shard>/audit-findings.json         last audit result
├─ reports/merge-report.md         what the merge wrote / skipped / refused
└─ reports/run-status.json         progress, retries, orchestrator
```

A shard **never** edits the main class, `plugin.yml` / `fabric.mod.json` /
`mods.toml`, `build.gradle(.kts)`, or another shard's package. It declares those
needs in its manifest; the merge applies them once.

## The loop

1. `mc_arbitrate { action: "freeze", projectDir, platform, minecraftVersion, packageName, modules: ["command","storage","gui"] }`
2. `mc_arbitrate { action: "brief", projectDir }` — one brief per shard; all briefs share the same Block1+Block2 prefix.
3. Delegate each shard to a child (e.g. `subagent_mc_content`) with `BRIEF.md` as the task and the shard's package as its only write scope. The child returns code + `RegistrationManifest.json`.
4. `mc_arbitrate { action: "audit", projectDir }` — 8 deterministic rules. `verdict: reject` → hand the findings back to **that shard only**; retry at most `maxAuditRetries` (default 3).
5. `mc_arbitrate { action: "merge", projectDir }` — dependencies, `plugin.yml` commands/permissions, lifecycle statements, JSON mod metadata. Ownership conflicts abort with nothing written.
6. `mc_gradle { projectDir, task: "build" }`.
7. `mc_arbitrate { action: "route", projectDir, compileLog }` — maps every `file:line: error:` to the shard that owns the file. Fix only the routed shard, rebuild, at most `maxCompileRounds` rounds.
8. `mc_arbitrate { action: "status", projectDir }` — brief/manifest/findings/retries per shard, plus the detected orchestrator.

## Hard rules

- **Do not change the frozen contract** to make a shard compile. If the contract is wrong, that is an escalation: `action: "escalate"`, amend the contract, `freeze` with `force: true`, re-run only the affected shards.
- **`contractCollapse`** in `route` (one missing symbol in ≥50% of shards) means the contract is incomplete, not that N shards are individually broken.
- **`route` replaces, it does not accumulate**: each call rewrites the shard's `compile-routes.json` from the log you pass, so re-routing the same error keeps `count: 1`. The `status` column is "errors currently routed", not a routing tally.
- **`merge` counts only real writes**: an identical file is reported under `unchanged`, so a second merge reads `written: 0, unchanged: N` — that is idempotency, not a failure.
- **Findings are evidence**: `file:line` plus the triggering text. Fix the cause; never silence a rule by deleting the handler without replacing the behaviour.
- Signatures come from `references/api-index/<line>.md` (bundled, offline) or the official docs — never from memory.
- The audit is regex-based: it catches the documented traps (`async-io-in-listener`, `missing-event-cancel`, `event-priority-mismatch`, `import-outside-allowlist`, `write-outside-scope`, `main-class-touched`, `scheduler-sync-blocking`, `missing-registration`, `listener-not-a-listener`, `public-class-name-mismatch`, `inventory-click-not-cancelled`, `command-executor-not-registered`, `repeating-task-not-cancelled`, `config-key-undeclared`, `legacy-color-code-not-translated`, `unfinished-todo`, `listener-declared-twice`, `duplicate-enable-priority`, `init-order-violation`, `command-permission-unregistered`, `field-type-unresolved`), not every possible defect. The compiler is still the final judge.

## Who drives the shards

| driver | when | how |
|---|---|---|
| `host` | default | the host agent delegates with `subagent_mc_content` / `subagent_fork` |
| `dsh-superagent` | when the superagent plugin is installed | hand `BRIEF.md` to its executor; results land back in the same `.mcdev/` layout |
| `manual` | small teams / debugging | a person runs the shards; `status` reports the same state |

`status` prints `orchestrator=host` or `orchestrator=dsh-superagent` (probe only —
this plugin has no dependency on the superagent package). A superagent bundle may be
installed but not load (unbuilt `lib/` or a missing `stateDir`); trust the probe, not the
package list, and do not plan a run around it until `status` reports it.

## Ask about the environment before anything else

The environment is per person, so it cannot be inferred: ask it in the intake
batch, before the first file is written — not at verification time, when a wrong
assumption costs a whole build. Ask with a reason attached, because the answer
changes the plan:

- **Which JDK / how many** — decides whether the toolchain auto-provisions or
  must be the one already installed (legacy lines need JDK 8, 26.x needs 25).
- **Which server jars exist for the target line** — without one, verification
  stays offline; never promise a smoke test that cannot run.
- **Where the test server is, which port, may it be started/stopped** — starting
  a server touches a world and a port; a throwaway copy is the default.
- **Which core (Paper / Folia / hybrid)** — Folia's scheduler changes the thread
  model the contract freezes.
- **Does a human client need to join** — Chinese text, GUI clicks and client
  mods can only be verified that way.
- **Can dependencies be downloaded** — if not, the build needs a vendored jar in
  \`libs/\`; otherwise the build stalls on TLS.
- **May \`runClient\` / \`runServer\` run** — a client window costs memory and time.

Unanswered questions take the default in the intake table, and the run's notes
record the answers so a later session does not re-ask. If the answer is "no
server jar for this line", say so in the result instead of silently skipping the
check.

## Limits worth knowing

- The plugin cannot sandbox a child's writes by path; isolation is the manifest +
  `write-outside-scope` audit. With `dsh-superagent`, its git worktrees add real
  filesystem isolation.
- Mod platforms (Fabric/Forge/NeoForge) have no `onDisable` at the entry point:
  `onDisableStatements` are skipped with `missing-anchor` in the merge report.
  Register teardown through events instead.
- `mc_shard`-style dedicated worker presets are not part of 0.12.0; reuse
  `mc-content` (fs-only tools).
