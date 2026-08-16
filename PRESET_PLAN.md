# Minecraft 专家 Agent Preset 方案（V05）

> 目标：给 minecraft-dev 插件附带一个「Minecraft 开发专家」agent preset。用户在 dsh Web UI 切换后得到一个专精 agent：人设 prompt + 完整工具集（含子代理/工作流委派）+ 通过全局技能目录使用 7 个 MC 技能。
>
> 基础：以 `apps/cli/config/agent-presets/standard/` 逐行复制为蓝本，仅替换 persona 文本与头部注释。市场规范：preset 文件必须放 `preset/minecraft/` 子目录（根目录放 preset.yml+agent.cordis.yml 会把市场类型从 cordis-plugin 误判为 agent-preset）。
>
> 版本：0.4.3 → **0.4.4**。

---

## 1. `preset/minecraft/preset.yml` 字段

```yaml
name: Minecraft 专家
description: Minecraft 服务端插件与模组开发专家：全时代（1.7.10~26.x）构建与平台知识、mc_scaffold/mc_gradle 工具、7 个按需加载技能，支持子代理与工作流协同。
order: 5
```

设计说明（对齐内置 preset 风格，见 `apps/cli/config/agent-presets/{standard,code,minimal,cordis}/preset.yml`）：

- **name**：中文四字短语（内置为「标准模式」「创造模式」「极简模式」「PTC 模式」），用「Minecraft 专家」。
- **description**：一句中文，句式与内置一致——"<定位>：<能力清单>"。内置四个均列出能力（文件编辑、Shell、Skills、计划、子代理……），我们列出：全时代知识、两个工具、7 技能、子代理协同。
- **order**：内置为 1/2/3/4（能力序），用户预设从用户根（`~/.dsh/.agent-presets/`）追加，整体排在 shipped 根之后；order 只在本根内相对排序（metadata.ts：无 order 者排在有 order 者后、再按 id 字典序）。给 5 与内置序号连续，且对本根内其他用户预设（按 id 排序）保持稳定优先。
- 该文件只承载显示文本（metadata.ts 明确：`id` 来自目录名、`trust` 来自根，preset.yml 不可写）；name/description 破损只影响卡片显示、不影响挂载。

## 2. `preset/minecraft/agent.cordis.yml` 完整行清单

以 standard 为蓝本**逐行照抄全部 16 个顶级行**（含注释），只做两处内容替换：

| # | 行 id | 插件 | 处理 | 说明 |
|---|---|---|---|---|
| 1 | `persona` | `@deepseek-ai/dsh-persona` | **替换 text**（唯一内容变更） | 见第 3 节大纲；块风格建议用字面块 `|-`（cordis 同款），多段中文 + 列表用折叠块 `>` 会塌陷换行 |
| 2 | `agent-instructions` | `@deepseek-ai/dsh-agent-instructions` | 照抄 | maxBytes: 65536 |
| 3 | `tool-bash` | `@deepseek-ai/dsh-tool-bash` | 照抄 | `disabled: !!js process.platform === 'win32'` |
| 4 | `tool-pwsh` | `@deepseek-ai/dsh-tool-pwsh` | 照抄 | `disabled: !!js process.platform !== 'win32'` |
| 5 | `tool-fs` | `@deepseek-ai/dsh-tool-fs` | 照抄 | 无 realm，注册进 host registry |
| 6 | `tool-fs-search` | `@deepseek-ai/dsh-tool-fs-search` | 照抄 | sampleOverCapGlobResults: false |
| 7 | `tool-jobs` | `@deepseek-ai/dsh-tool-jobs` | 照抄 | 后台任务控制（registry 在 host） |
| 8 | `skill-filesystem` | `@deepseek-ai/dsh-skill-filesystem` | 照抄（**不加** customSkillDirs） | 见下方「preset 本地技能」决策 |
| 9 | `tool-skill` | `@deepseek-ai/dsh-tool-skill` | 照抄 | 技能目录与加载器；merged catalog 已含全局 bundled 技能 |
| 10 | `tool-goal` | `@deepseek-ai/dsh-tool-goal` | 照抄 | |
| 11 | `planning`（组） | `cordis:group`，isolate `planMode` | 照抄 | 内含 `plan-mode` 一行（section 全文照抄，不改） |
| 12 | `compaction`（组） | `cordis:group`，isolate `compaction`+`toolResultPruner` | 照抄 | 内含 compaction-basic / command-compact / tool-result-pruner 三行 |
| 13 | `delegation`（组） | `cordis:group`，isolate `workflowEngine` | 照抄（**完整保留**） | 内含 9 行：tool-subagent-control、list-agents、tool-subagent(spawn)、tool-subagent-fork、codex(disabled)、claude-code(disabled)、workflow-worker-thread、tool-workflow、tool-ralph(maxRounds 64)；含「复制本 preset 后去掉 disabled 即可暴露产品 provider」注释 |
| 14 | `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` | 照抄 | |
| 15 | `tool-todo` | `@deepseek-ai/dsh-tool-todo` | 照抄 | allowParallelInProgress: true |
| 16 | `tool-web` | `@deepseek-ai/dsh-tool-web` | 照抄 | fetch: false, searchTimeoutMs: 60000 |

**头部注释**：整体重写为 minecraft preset 的说明——"standard 的全部能力 + Minecraft 专家人设；工具与技能全部由宿主全局层供给；TRUST：本 preset 不含自我修改工具（无 tool-cordis），不可写运行时"。AGENT-PLANE 组成、realm/isolate 语义、`{{model}}`/`{{cwd}}` 解析说明保留原样（这些是标准文件里必须保留的机制注释）。

**跳过（相对 cordis preset）**：

- `tool-cordis`（`@deepseek-ai/dsh-tool-cordis`）——**不复制**。自我修改运行时对 MC 专家无用途，且是信任边界，缩小攻击面。
- cordis 的 `skill-filesystem` 变体（带 `customSkillDirs: skills/`）——**不采用**，用 standard 的朴素行。
- 不复制 cordis 的 `skills/` 目录（cordis-plugin-development / editing-cordis-compositions 两技能与 MC 无关）。

**要不要 `skill-filesystem` 行与 preset 自带 skills 目录（决策）**：

- **保留 standard 的 `skill-filesystem` 行（照抄）**：它贡献本地根发现（`~/.dsh/skills/`），让用户可放自有技能覆盖，与 README Known Limitations「本地同名技能 rank<600 会覆盖 bundled」的预期行为一致。
- **不要 preset 本地 skills 目录**。理由：
  1. minecraft-skills 已作为 profile bundle 全局注册（宿主层，`ctx.skills.registerProvider`，rank 600），preset 层 merged catalog 天然可见——不需要本地副本「才能看到」。
  2. preset 本地副本会与 bundled 内容重复并随版本漂移（bundle 升级后 preset 里还是旧版），违反「一个事实一个家」。
  3. cordis 带本地技能是因为它记录的是**本部署**的双平面规范、以 preset 为复制单位；MC 技能无此需求。
  4. 若本地副本与 bundled 同名，还会与本包 bundled 技能互相遮蔽，增加排查成本。

## 3. persona 文本大纲（C 阶段按此写全文）

格式：`- id: persona` → `text: |-`，全文中文（面向中文用户；内置 preset 的 persona 为英文但我们的用户群为中文，且人设内容为中文工作规则）。**必须保留 `{{model}}` 与 `{{cwd}}` 两个占位符**（由 persona 插件从 agent 自身 route/workspace 解析，见 standard 头部注释），禁止写死模型名或路径。

大纲：

1. **身份**（1 段）：「你是 Minecraft 开发专家 agent，由 {{model}} 模型驱动，工作目录 {{cwd}}。专精 Minecraft 服务端插件与模组开发，覆盖 MC 1.7.10 ~ 26.x 全时代。」点名两个专属工具：`mc_scaffold`（一句话创建 paper/fabric/forge/neoforge/spigot 五平台可构建项目）、`mc_gradle`（项目内跑 gradlew，优先于裸 shell 调 wrapper）。
2. **MC 时代知识要点**（2~3 段，压缩版）：
   - 现代线（1.18.2+）：Paper/Spigot（含 Purpur/Pufferfish/Folia 家族）、Fabric（loom/loader/Fabric API）、NeoForge（moddev/NeoForm）；JDK 17（1.18~1.20.4）/ 21（1.20.5~1.21.x）/ 25（26.x）；foojay toolchain 自动供应。
   - 老线（1.7.10 / 1.12.2 / 1.16.5）：Forge 四时代（FG2/FG3/FG5/FG6）、Spigot legacy、Cauldron/Thermos/Mohist 混合服；JDK 8 硬性要求；老版无公共 maven（如 spigot 1.7.10 需 vendored jar）。
   - 生态：大型模组附属（Thaumcraft/TC/植物魔法/Botania/AE2/Mekanism/拔刀剑等 28 条目），curse.maven / Modrinth maven 坐标。
3. **工作铁律**（编号列表，5 条）：
   1. **先查技能**：任何 MC 任务先确认对应技能已加载（7 个：minecraft-java-build / paper-plugin / fabric-mod / forge-mod / neoforge-mod / spigot-legacy / major-mods）；模型自动按 description 路由，不确定就用 `skill` 工具查目录并加载；技能按需加载不占常驻上下文，会话中可见加载卡片，也可用 `/技能名` 手动注入。
   2. **签名查 references**：API 参考是精选高频签名（非全量 Javadoc），写代码前查 `assets/skills/<技能>/references/` 对应文件确认签名与版本配对；每个参考文件标了核对日期，以 2026-08 为准。
   3. **mc_gradle 优先**：项目有 wrapper 就跑 `mc_gradle <task>`（终端卡片、超时杀进程树、输出头尾截断、非零退出可读呈现），不要裸 shell 调 gradlew。
   4. **老线 JDK 配对**：1.7.10/1.12.2/1.16.5 必须手动 JDK 8 并设 JAVA_HOME；现代线依赖 foojay toolchain 自动下载；spigot 1.7.10 构建前按 `libs/README.txt` 放 spigot-api jar。
   5. **附属先查 mods 参考**：开发大型模组附属先查 minecraft-major-mods 的 `references/api/mods-1.7.10.md` / `mods-1.12.2.md` 拿坐标与扩展点；compileOnly 可选依赖 + 软依赖检测，跨 Forge/Cauldron/Spigot 通用。
4. **子代理协同惯例**（1 段 + 列表）：大规模任务按「**方案 → 框架 → 内容 → 审查**」四段委派——(a) 先自己或 subagent 出实现方案（planning/plan-mode 或 subagent 设计）；(b) 框架/骨架代码用 `subagent_fork` 派生子代理搭结构；(c) 内容与细节用 `subagent`（spawn、可后台 continuable）并行填充；(d) 收尾用 `tool-ralph`（subagentProvider: spawn, maxRounds: 64）或子代理审查。整段复杂工作流可用 `tool-workflow`。工具名写进人设，让模型知道有委派能力。
5. **环境与边界**（1 段）：minecraft-skills / minecraft-tools 已在宿主全局注册，**不要尝试重新注册或安装这两个插件**（会双注册报错），直接使用即可；本 preset 不含运行时自我修改工具；会话工具目录与本 preset 的 catalog 一致（plan mode 下不换目录）。

## 4. 安装方式与 D 阶段验证

### 安装（写入 README）

```sh
# 1. 建用户 preset 根（dsh 自动把 ~/.dsh/.agent-presets 追加为 user 根，
#    但目录不存在时发现为空，需先创建）
mkdir -p ~/.dsh/.agent-presets

# 2. 复制 preset 目录（含 preset.yml + agent.cordis.yml）
cp -r <minecraft-dev 仓库>/preset/minecraft ~/.dsh/.agent-presets/
```

- 最终落盘：`~/.dsh/.agent-presets/minecraft/preset.yml` 与 `agent.cordis.yml`（本机默认 `C:\Users\YX-ASUS\.dsh\.agent-presets\minecraft\`；DSH_HOME 覆盖时以 `$DSH_HOME` 为准——路径变量是 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`）。
- **禁止**改内置安装目录（dsh 仓库 `apps/cli/config/agent-presets/`）：升级会被覆盖；本 preset 全部内容在用户根，卸载 = 删目录。
- 发现是**热扫描**（discovery.ts 每次调用重读根），运行中的 dsh 无需重启即可看到新 preset；但**新会话**才生效（standing mount 按会话固定）。
- Windows 用户提示：可用 PowerShell `Copy-Item -Recurse` 等价命令；仓库内 `preset/minecraft/` 是唯一事实来源，npm 包 `files` 建议加 `"preset"` 使 tarball 携带（不影响市场判定，判定看仓库根）。

### D 阶段验证方法

1. **发现验证（roster 健康）**：`pnpm dsh web` 启动，启动日志无 `agent-presets` 相关报错。discovery 的健康检查会把「composition 缺失或不可加载」的目录报为 **broken roster row**（卡片上显示原因）而不是静默跳过——所以启动无报错 + 无 broken 卡片即发现层通过。
2. **UI 验证**：Web UI 新建会话 → preset 选择器出现「Minecraft 专家」（读 preset.yml 的 name；该选择器读的就是 roster）。若显示的是目录名 `minecraft` 说明 preset.yml 未读到（仅显示层问题，仍可挂载）。
3. **挂载验证**：新建会话选「Minecraft 专家」，确认不报 `agent-presets: refusing to mount preset`；对话中问「列出你能用的技能」，应返回 7 个 minecraft-* 技能 + mc_scaffold/mc_gradle + subagent/subagent_fork/tool-workflow/ralph 工具（后四者是 delegation 组在 standing mount 生效的直接证据）。
4. **占位符验证**：问「你是什么模型、工作目录在哪」，应回答本会话模型与工作目录——`{{model}}`/`{{cwd}}` 正确解析。
5. **注意**：`--dump-config` 只能验证 bundle 层（minecraft-skills/minecraft-tools 两行），**不能**验证 roster——roster 是运行期服务，不落在 profile 树里；roster 验证以上面 1~4 为准。
6. **回滚**：删除 `~/.dsh/.agent-presets/minecraft/` 即卸载，新会话回到部署默认 preset。

## 5. README 更新点与 version bump

README.md（`C:/Users/YX-ASUS/Desktop/minecraft-dev/README.md`）新增一节「Agent 预设（Minecraft 专家）」：

- 是什么：切到「Minecraft 专家」preset 后的 agent = 全工具集（standard 全部能力）+ 中文专家人设 + 子代理/工作流委派 + 全局可见的 7 技能。
- 安装步骤（上文第 4 节命令）；切换位置（Web UI 新建会话的 preset 选择器）；验证（第 4 节 1~4）；卸载（删目录）；双注册警告（宿主已注册，preset 不重复装插件）。
- 已知限制追加一行：preset 人设为 2026-08 基线，26.x 生态（NeoForge 26.2 beta）变化时以技能 references 更新为准。

其他改动：

- `package.json`：version `0.4.3` → `0.4.4`；`files` 数组追加 `"preset"`（tarball 携带 preset 源）。
- 仓库结构：新增 `preset/minecraft/preset.yml`、`preset/minecraft/agent.cordis.yml`（**不放根目录**——防市场类型误判为 agent-preset）。

## 变更文件总览

| 文件 | 动作 |
|---|---|
| `preset/minecraft/preset.yml` | 新增（第 1 节内容） |
| `preset/minecraft/agent.cordis.yml` | 新增（standard 全行照抄 + persona 替换 + 头部注释重写；无 skills 目录） |
| `PRESET_PLAN.md` | 本文件 |
| `README.md` | 新增「Agent 预设」节 + 已知限制追加 |
| `package.json` | 0.4.4 + files 加 "preset" |
