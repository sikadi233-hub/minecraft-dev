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
6. **会话可接管**：`mc_codex` 返回 `sessionId`；告诉用户可以用 `codex resume <sessionId>` 在 Codex 里打开同一次会话查看/接管。
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
