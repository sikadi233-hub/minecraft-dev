# Codex(Astra) 架构交接：Codex 只做架构，我填内容并验证

本技能只在**用户点名**（提到 Codex / Astra / "让架构师写骨架" / 架构+编码分工）**且本会话有 `mc_codex` 工具**时启用。它把 Cherry Studio 里 Minecraft Architect / Minecraft Coder 的分工搬进 DSH：**Codex 当架构师**，**你（DSH）当编码员**。

## 0. 门禁（三态，先判定再动手）

| 状态 | 判定方式 | 动作 |
|---|---|---|
| **A 探不到 Codex** | `mc_codex` 返回"could not find the Codex CLI"（含已探路径清单） | 不要用 Codex。自己把活做完（内联，或用 `subagent_mc_plan/skeleton/content/verify` 四阶段链），**绝不产生 `[TODO: Agent B]` 标记**；回复里附上缺 Codex 的说明 |
| **B 能跑但失败** | 退出码≠0 / 超时 / 输出里是鉴权或额度错误 | **把命令与输出原样报告**，不自动重试；问用户是否改用自研路径 |
| **C 正常** | 用户点名 + `mc_codex` 退出码 0 | 走下面的分工流程 |

没有 `mc_codex` 工具 = 本会话没挂载「Minecraft 架构师」预设（或插件未装），直接按 A 处理。

## 1. 透明化（硬要求，缺一不可）

1. **先给命令再跑**：调用 `mc_codex` 前，在回复里说明这一步会用用户自己的 Codex 账号跑（订阅账号计入 Codex 用量窗口；API key 计入余额），并提示命令与输出都会完整显示在会话里。
2. **prompt 落盘可读可改**：`mc_codex` 会把架构 brief 写到 `<项目>/.dsh/codex-architect.md`；用户可以在跑之前就打开它、改它。
3. **完整输出回会话**：`mc_codex` 返回合并后的 stdout+stderr（头尾截断），不要用摘要替代它。
4. **退出码 / 超时 / 用时**都要报。
5. **改动文件清单**：`mc_codex` 返回 `filesChanged`，逐条报给用户。
6. **会话可追溯**：`mc_codex` 返回 `sessionId` 与 `rolloutPath`。要说清两件事：① 这次 Codex 会话已经**持久化**在 `~/.codex/sessions/<年>/<月>/<日>/rollout-…-<sessionId>.jsonl`（直接打开就能看到 Codex 的完整过程）；② **Codex 桌面版的会话列表不显示 CLI（`source: exec`）线程**，所以别让用户去 App 侧边栏找——要继续这次会话得用命令行 `codex exec resume <sessionId> "…"`。
7. **不做隐藏重试**：失败就是失败，报告后由用户决定。
8. **命令可复制**：把 `mc_codex` 返回的 `command` 原样贴出来，用户自己也能跑同一条命令。

## 2. 流程

1. **分析**：按 `minecraft-intake` 把 版本/平台/加载器/核心/兼容/部署 核对清楚；如果用户没说全，先一次性问全，别猜。把功能需求整理成一段 `goal`（要具体：命令名、事件、权限、数据存储方式）。
2. **让 Codex 做架构**：调用 `mc_codex`，参数：`projectDir`（项目绝对路径）、`goal`、`platform`、`minecraftVersion`（可选 `javaVersion`、`sandbox`、`model`）。
   - 架构步骤建议显式 `model: "deepseek-v4-pro"`（Cherry 里架构用的是 Opus，这边同等强度只有 v4-pro）；不传就跟随用户 Codex 原生模型。
   - `sandbox` 默认 `workspace-write`——架构师要能写文件。
   - 追加一句：`args: ["-m", ...]` 不要自己拼，用 `model` 参数。
3. **读交接物**：Codex 跑完后读两份东西——`<项目>/FILL-SPEC.md`（填充规范）和代码里的 `// [TODO: Agent B] ...` 标记。
4. **填内容**：严格按 `references/coder-rules.md` 执行——只替换标记、不改签名/结构/接口；API 不确定就先加载对应平台技能（`minecraft-paper-plugin` / `minecraft-fabric-mod` / `minecraft-forge-mod` / `minecraft-neoforge-mod` / `minecraft-spigot-legacy`）及其 `references/api/*.md`。
5. **验证**：用 `mc_gradle` 跑 `build`（有测试桩时跑 `test`），退出码必须 0；并确认项目里 `[TODO: Agent B]` 计数为 0、`FILL-SPEC.md` 的签名清单没被改动。
6. **汇报**：平台/版本、Codex 命令与退出码、改动文件、填充了哪些标记、构建结果、剩余风险（含 `UNVERIFIED` 项）；失败则原样贴输出。

## 3. 交接协议（来自 Cherry Studio 的原始约定）

- **标记**：`// [TODO: Agent B] 功能描述`——架构师只写这一种，你只删这一种。
- **所有权**：架构师拥有构建脚本、目录结构、接口/抽象类/方法签名、资源模板、主类注册代码；你只拥有标记所在的方法体。
- **FILL-SPEC.md**：待填文件 × 标记位置 × 方法契约 × 目标时代与构建命令 × `UNVERIFIED` 清单 × 完成判据。
- **完成判据**：标记计数 0 + `mc_gradle` build/test 退出码 0 + 签名未改。

## 4. 次数上限（防止反复烧额度）

- **架构委派最多 1 次**；确有结构性问题时最多再 1 次修复委派（并在回复里说明为什么需要第二次）。
- 不并发发起多个 `mc_codex`；`limit`/额度类错误**不重试**。
- 记住：`mc_codex` 跑的是**用户自己的 Codex 账号**，DSH 侧不会显示这笔消耗——所以次数上限和"先声明再执行"是硬要求。

## 5. 与四阶段子代理链的关系

`subagent_mc_plan/skeleton/content/verify`（A→B→C→D，DeepSeek 子代理）依然可用，两者是替代关系：

- 用户点名 Codex/架构分工 → 用本技能（Codex 做架构，你做编码）。
- 用户没点名，或 Codex 不可用 → 用 A–D 链或直接自己做。

不要混用：**一旦走了 Codex 架构，就必须按 `[TODO: Agent B]` 标记协议填完**，不要改用 A–D 的 TODO 约定。

## 6. 想让这次架构会话出现在 Codex 桌面版？（实测结论 + 唯一受支持的做法）

**事实**（读 app-server 与桌面版代码确认）：`codex exec` 建的线程 `source = exec`、`originator = codex_exec`，而桌面版调用 `thread/list` 时带固定的 `sourceKinds` 白名单（只含它自己用的 `vscode`/`appServer` 一类），**服务端就不会返回 `exec`（连普通 `codex` TUI 的 `cli` 也不返回）**；桌面版里没有任何"显示 CLI 会话"的开关。所以要"在桌面版里看见"，只能**让架构这一步从桌面版发起**：

1. 你（DSH）把 `<项目>/.dsh/codex-architect.md` 写好（如果用 `mc_codex` 就已经写好了；也可以只让模型生成这份文件而不执行）；
2. 让用户在 **Codex 桌面版**里新建一个线程、工作目录选该项目，把这份文件的内容粘进去（或直接说"按 `.dsh/codex-architect.md` 的要求做架构"）；
3. 用户在桌面版里跑完，回来说一句"架构做完了"；
4. 你从磁盘接手：读 `<项目>/FILL-SPEC.md` 与 `// [TODO: Agent B]` 标记 → 第 4、5 节照常填内容 + `mc_gradle` 验证。

这样会话在桌面版列表里可见、可续聊，而编码与验证仍然由 DSH 负责；交接物依旧是磁盘上的文件，和 `mc_codex` 路径完全兼容。

不建议的做法：直接改 `~/.codex/state_5.sqlite` 里的 `source`/`originator`。——实测 rollout 的 `session_meta` 写死了 `"originator":"codex_exec"`，而桌面版有 rollout 回填机制（`rollout_migration_state`/`backfill_state`），改了可能被覆盖，且 App 运行中持有该库。若用户坚持要试，先关掉桌面版、备份 DB 与 `.codex-global-state.json` 再动。
