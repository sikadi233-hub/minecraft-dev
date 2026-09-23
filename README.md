# minecraft-dev

Minecraft 开发插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)：让 agent 更擅长写 Minecraft 服务端插件与模组，覆盖 **MC 1.7.10 ~ 26.3 全时代**。适配 dsh **≥ 0.1.5-rc.1**（profile/bundle 插件体系；低于此版本请用 0.7.0 及更早版本）。两条线各实测一种形态：**0.1.5-rc.2 走目录形态、0.1.7-rc.1 走 agentPresets 注册形态**（0.1.5-rc.3 未单独实测，但 peer 范围覆盖它）。0.1.7-alpha 通道未验证。

> **dsh 0.1.7 起 preset 的声明方式变了**，本插件两种都支持并在运行时自动选择：0.1.5–0.1.6 的 preset 是 `$DSH_HOME/.agent-presets/<id>/` 目录（插件启动时拷贝，已存在则不覆盖本地修改）；0.1.7 起 preset 改为 Cordis 声明行（`@deepseek-ai/dsh-agent-preset`）交给 `agentPresets` 服务，插件随之改用 `agentPresets.register()` 提交同一批行（`preset/*/rows.js`）。两种形态由同一个源生成，并由测试锁死一致。0.1.7-alpha 通道未验证。

已发布 npm：[`minecraft-dev`](https://www.npmjs.com/package/minecraft-dev)（MIT）｜ 源码：[GitHub](https://github.com/sikadi233-hub/minecraft-dev)

## 功能一览

### 8 个技能（模型按需加载，不占常驻上下文）

| 技能 | 内容 |
|---|---|
| `minecraft-java-build` | 全时代 Java/Gradle 构建知识：JDK 配对表、wrapper、foojay toolchain、依赖仓库、常见坑 |
| `minecraft-paper-plugin` | Paper/Spigot 现代线插件（1.20.x / 1.21.x / 26.x）+ 5 份 API 参考 |
| `minecraft-fabric-mod` | Fabric 模组（loom/loader/fabric-api/yarn 配合）+ 4 份 API 参考 |
| `minecraft-forge-mod` | 传统 Forge 四时代（1.7.10 FG2 / 1.12.2 FG3 / 1.16.5 FG5 / 1.20.1 FG6）+ 3 份时代 API 参考 |
| `minecraft-neoforge-mod` | NeoForge（1.20.1 legacyforge / **1.21.1** / 1.21.x / 26.2 stable + **26.3 beta-only**）+ 3 份 API 参考 |
| `minecraft-spigot-legacy` | 1.7.10 / 1.12.2 老线 Bukkit 插件 + Cauldron/Thermos/Mohist 混合服说明 + 2 份老线 API 参考 |
| `minecraft-major-mods` | 大型模组附属开发：28 个模组条目（1.7.10×10 / 1.12.2×8 / 现代×10，含拔刀剑、神秘时代、匠魂、植物魔法、Create、Botania、AE2、Mekanism、Curios、JEI/REI 等），每条含核实过的 curse.maven 坐标与扩展点 |
| `minecraft-intake` | **任务信息核对（v0.7）**：用户请求写插件/mod/附属但信息不足时，按场景批量提问（版本/平台/加载器/核心/混合端/兼容性/部署），一次问全、不重复问、授权默认 |

### 3 个工具

| 工具 | 用途 |
|---|---|
| `mc_scaffold` | 一句话创建完整可构建项目：paper / fabric / forge / neoforge / spigot 五平台，自动配好构建脚本、主类、元数据、**时代对应的 Gradle wrapper** |
| `mc_gradle` | 在项目里跑 `gradlew <task>`：终端卡片显示、超时自动杀进程树、输出头尾截断、非零退出码不报错而是可读呈现 |
| `mc_codex` | **只在「Minecraft 架构师」预设里可用**：把架构 brief 写到 `<项目>/.dsh/codex-architect.md`，再用**你自己的 Codex CLI** 跑一次完全可见的架构会话——默认走官方 `codex app-server --stdio` 协议（**会话会出现在 Codex 桌面版列表里、可续聊**），也可 `mode: "exec"` 退回 `codex exec`；命令、完整输出、退出码、用时、改动文件、会话 id/线程 id、rollout 路径、token 用量全部回到会话里 |

### 4 个内置子代理（v0.5.0，四子代理团队）

| 子代理（toolName） | 环节与产出 |
|---|---|
| `subagent_mc_plan` | A 方案：勘察项目 + web_search 联网查证 → 写 `<项目>/PLAN.md` + 5 行摘要 |
| `subagent_mc_skeleton` | B 框架：按 PLAN.md 用 mc_scaffold 搭骨架 + 资源模板 + 测试桩 → 变更清单 |
| `subagent_mc_content` | C 内容：按 PLAN.md 与骨架填充功能代码 → 变更清单 + 不确定点 |
| `subagent_mc_verify` | D 编译审查：mc_gradle 编译/测试、修小错 → 验证报告 |

（注：4 个子代理为宿主层工具，任何 preset 会话可见；使用说明见 Minecraft 专家 preset persona。）

### 2 个 Agent 预设

| 预设 | 内容 |
|---|---|
| `minecraft`（Minecraft 专家） | 一键切换的专精 agent：standard 全工具集（shell / 文件 / 检索 / 技能 / 计划 / 目标 / 子代理 / 工作流）+ 中文专家人设 + 全局可见的 8 个技能与 4 个内置子代理 subagent_mc_plan/skeleton/content/verify（v0.6.0 起装完插件重启 dsh 后**自动安装**到 `$DSH_HOME/.agent-presets/minecraft/`，见下方「Minecraft 专家 agent 的安装」） |
| `minecraft-architect`（**Minecraft 架构师（Astra神的瞥视）**，v0.8.0） | 专家预设**逐字节复制**后只多两处：一段人设 + 一行 `minecraft-dev/codex` 模块（注册 `mc_codex` 工具与 `minecraft-codex-architect` 技能）。因此专家预设的工具/技能目录完全不变，只有本预设能看到 `mc_codex` |

#### Minecraft 架构师：Codex 做架构，DSH 填内容（v0.8.0）

分工照搬 Cherry Studio 里的 Architect / Coder 两个智能体（`// [TODO: Agent B] 描述` 标记就是交接协议）：

1. DSH 先按 `minecraft-intake` 把版本/平台/加载器核对清楚，整理成一段 `goal`；
2. 点名后调用 `mc_codex`：它把架构 brief 写到 `<项目>/.dsh/codex-architect.md`（**可读可改**），然后用**你自己的 Codex**在项目目录里跑一次架构会话。默认 `mode: "app-server"`，实际执行的是
   `"…codex.exe" app-server --stdio`
   协议（`thread/start` + `turn/start`，prompt 就是那个文件的内容）——这条命令原样回显在会话里；`mode: "exec"` 时则是
   `"…codex.exe" exec - -C "<项目>" -s workspace-write --skip-git-repo-check -o "<项目>/.dsh/codex-last-message.md" < "<项目>/.dsh/codex-architect.md"`
3. Codex 只写骨架：接口/签名/build 脚本/资源模板/主类注册，所有业务逻辑方法体留 `// [TODO: Agent B] 描述`，并额外产出 `FILL-SPEC.md`（标记位置 × 方法契约 × 构建命令 × UNVERIFIED 清单 × 完成判据）；
4. DSH 只替换这些标记（不动签名/结构/接口），最后用 `mc_gradle` 跑到 build exitCode 0，并确认标记计数为 0。

**透明度**（本预设的硬要求）：执行前先声明这一步会消耗**你自己的 Codex**（订阅账号计入 Codex 用量窗口；API key 计入余额），而且 DSH 侧不会显示这笔消耗；返回完整输出、退出码、用时、改动文件清单、会话/线程 id、rollout 文件路径与 token 用量（从 rollout 的 `token_count` 事件读，源码写的是 `turn/completed` 不带 usage）；失败不静默重试，委派次数上限为「架构 1 次 + 修复 ≤1 次」。

**关于"这次会话在 Codex 桌面版里看得见吗"（实测结论）**：默认的 `mode: "app-server"` **看得见**——app-server 建的线程是 `source = vscode`、`originator = DeepSeek Harness`，实测跑完立刻能被桌面版用的 `thread/list {}` 查到（同一条 App 侧边栏查询只会返回 `vscode`/`appServer` 一类，不返回 `exec`/`cli`），所以你可以直接在 App 里点开续聊，或在命令行 `codex resume <threadId>`。两种模式都会把内容**持久化**在 `~/.codex/sessions/<年>/<月>/<日>/rollout-…-<id>.jsonl`（`mc_codex` 直接回报这条路径，打开就是 Codex 的完整过程）：

- `mode: "app-server"`（默认）：桌面版列表可见、可续聊；续接用 `codex resume <threadId>`。
- `mode: "exec"`：`source = exec`、`originator = codex_exec`，**桌面版列表不会显示**（App 里没有"显示 CLI 会话"的开关）；此时用 `codex exec resume <sessionId> "…"` 续接。
- 想让架构这一步由你**亲手在桌面版里操作**（例如先改 prompt）：把 `.dsh/codex-architect.md` 写好（可只生成不执行），在桌面版新建线程、工作目录选该项目、把内容粘进去跑完，再回来说"架构做完了"，DSH 就从磁盘上的 `FILL-SPEC.md` 与 `[TODO: Agent B]` 标记接手。
- 不建议直接改 `state_5.sqlite` 的 `source`/`originator`：rollout 的 `session_meta` 写死了 `codex_exec`，桌面版的 rollout 回填（`rollout_migration_state`/`backfill_state`）可能把它改回去，且 App 运行时持有该库。

**前提**：只需要本机装着 Codex（桌面版会顺带提供 CLI；`mc_codex` 会自己探测 PATH、`~/.codex/plugins/.plugin-appserver/`、`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\` 三处）。**不用打开 Codex 桌面版**——每次都 spawn 一个非交互会话；app-server 模式下的会话结束后会出现在桌面版列表里（想看就开，不想看也不用开）。Codex 探不到/跑失败时，本预设会退回普通做法（自己写或走 A–D 链），并且**绝不留下 `[TODO: Agent B]` 标记**。

## 安装

### 方式一：npm 安装（推荐）

```sh
dsh plugin --profile web add minecraft-dev
```

> **国内用户注意**：npm 默认源 npmmirror 会在发布后几分钟内同步；若报 `ERR_PNPM_FETCH_404` 说明镜像还没同步，加官方源即可：
> `dsh plugin --profile web add minecraft-dev --registry=https://registry.npmjs.org`

### 方式二：本地 tarball（离线/内网）

```sh
cd minecraft-dev && pnpm pack        # 产出 minecraft-dev-x.y.z.tgz
dsh plugin --profile web add ./minecraft-dev-0.5.0.tgz
```

### 方式三：源码直连（开发迭代，改完即生效）

```sh
dsh plugin --profile web add /path/to/minecraft-dev
```

### ⚠️ 如果你从源码运行 dsh：命令是 `pnpm dsh` 不是 `dsh`

**只有通过 npm 安装的 dsh**（`npx @deepseek-ai/dsh` 或 `npm i -g`）才有 `dsh` 命令。
如果你是从仓库源码跑的（比如 `C:\Users\...\deepseek-harness-master`），必须：

1. 先 `cd` 到 dsh 仓库根目录
2. 用 `pnpm dsh` 代替 `dsh`：

```sh
cd C:\Users\YX-ASUS\Desktop\deepseek-harness-master
pnpm dsh plugin --profile web add minecraft-dev --registry=https://registry.npmjs.org
```

### ⚠️ 安装后必须重启 dsh 服务

**正在运行的 dsh 不会自动加载新装的插件**。装完后：

1. 在跑 `pnpm dsh web` 的窗口按 `Ctrl+C` 停掉
2. 重新启动 `pnpm dsh web`
3. 新会话里插件生效

### 验证安装

```sh
pnpm dsh --profile web --dump-config     # 应出现 "# == minecraft-dev" 层与七行插件（skills/tools/preset + 4 个 subagent 实例）
```

### 卸载

```sh
dsh plugin --profile web remove minecraft-dev
```

### 安装 Minecraft 专家 agent（v0.6.0 起自动）

**装完插件重启 dsh 后自动安装，无需手动复制**：插件每次启动（挂载）时把自带的 `preset/minecraft/` 与 `preset/minecraft-architect/`（v0.8.0 起）分别复制到 preset 扫描根：

- 目标：`$DSH_HOME/.agent-presets/minecraft/` 与 `$DSH_HOME/.agent-presets/minecraft-architect/`（默认 `C:\Users\<用户>\.dsh\.agent-presets\`；设了 `DSH_HOME` 时以 `$DSH_HOME` 为准）。
- 幂等：目标已有 `agent.cordis.yml` 就跳过，**绝不覆盖本地修改**；目录存在但缺 composition 文件时视为损坏并自动修复。两个预设各自独立跳过，互不影响。
- **升级到 v0.8.0 想看新的架构师预设**：删掉 `$DSH_HOME/.agent-presets/minecraft-architect/` → 重启 dsh → 自动重装（专家预设目录不用动，它本来就不变）。
- 关闭：在 `$DSH_HOME/cordis.patch.yml`（或 profile 的 `cordis.patch.yml`）追加：

```yaml
- id: minecraft-preset
  config:
    autoInstallPreset: false
```

- 老版本（<0.6.0）或关闭自动安装时，手动复制：

```sh
# 1. 建用户 preset 根（dsh 自动把 ~/.dsh/.agent-presets 追加为 user 根，
#    但目录不存在时发现为空，需先创建）
mkdir -p ~/.dsh/.agent-presets

# 2. 复制 preset 目录（含 preset.yml + agent.cordis.yml）
cp -r <minecraft-dev 仓库>/preset/minecraft ~/.dsh/.agent-presets/
```

- 最终落盘：`~/.dsh/.agent-presets/minecraft/preset.yml` 与 `agent.cordis.yml`（本机默认 `C:\Users\YX-ASUS\.dsh\.agent-presets\minecraft\`；设了 `DSH_HOME` 时以 `$DSH_HOME` 为准）。
- **禁止**改内置安装目录（dsh 仓库 `packages/preset/agent-presets/presets/`）：升级会被覆盖；卸载 = 删 `~/.dsh/.agent-presets/minecraft/`。
- 发现是**热扫描**：运行中的 dsh 无需重启即可看到新 preset；但**新会话**才生效。
- Windows 用户：可用 PowerShell `Copy-Item -Recurse` 等价命令。
- 切换位置：Web UI **新建会话**的 preset 选择器选「Minecraft 专家」。
- 验证：新建会话选该 preset，问「列出你能用的技能」，应返回 8 个 minecraft-* 技能 + mc_scaffold/mc_gradle + 4 个内置子代理 subagent_mc_* + subagent/subagent_fork/tool-workflow/ralph 工具；问「你是什么模型、工作目录在哪」，应回答本会话模型与目录（`{{model}}` / `{{cwd}}` 解析）。

## 使用

### 技能：模型自动加载，也可手动注入

- 发 MC 相关任务时，模型会自动调 `skill` 工具加载对应技能（会话中可见加载卡片）
- 手动注入：在输入框直接发 `/minecraft-paper-plugin`（或其它技能名）
- 查看全部：问 agent「列出你可以用的技能」

### 对话示例

```
创建一个 Paper 插件 my-plugin，包名 com.example.myplugin，MC 1.21.8
创建一个 Forge 1.12.2 模组 mymod，包名 com.example.mymod
写一个植物魔法 1.12.2 附属，注册一种新的花
用 mc_gradle 跑一下当前项目的 build
帮我做个插件            # 信息不足 → agent 会批量提问（版本/平台/核心/兼容/部署），不会直接开工
```

完整流程：模型加载技能 → 调 `mc_scaffold` 生成项目（含 wrapper）→ `mc_gradle build`（或 `cmd /c "gradlew.bat build"`）→ 产出 `build/libs/*.jar`。

### 四子代理团队委派（v0.5.0）

3+ 工作项的新插件/模组任务可用内置四子代理团队（A→B→C→D 委派链）；小改动建议 agent 内联完成。示例对话：

```
用四子代理团队帮我做一个 Paper 插件 my-plugin，包名 com.example.myplugin，MC 1.21.8
```

- 委派链严格 A → B → C → D 串行：A（方案）勘察项目并联网查证，写 `<项目>/PLAN.md` + 5 行摘要；B（框架）按 PLAN.md 用 `mc_scaffold` 搭骨架；C（内容）填充功能代码；D（编译审查）用 `mc_gradle` 构建/测试并出验证报告。前一环未返回不得调下一环。
- `<项目>/PLAN.md` 是唯一共享工件：B/C/D 每次重读；宿主改需求 = 先改 PLAN.md 再继续。
- 某环失败：附上失败报告重委派同一环，或宿主小修后继续；不要静默跳过 D。
- 每个子代理独立上下文、看不到宿主对话，委派 prompt 必须带绝对路径；最终回复有行数上限（A=5 行摘要、B/C≤30 行变更清单、D≤40 行验证报告）。

### 平台 × 版本支持矩阵（mc_scaffold）

| 平台 | 支持版本 | Java |
|---|---|---|
| paper | 1.20.x / 1.21.x / 26.2 / **26.3**（Paper 侧目前只有 `-alpha` 构建） | 17 / 21 / 25 |
| fabric | 1.20.1 / 1.21.x / 26.2 / **26.3** | 17 / 21 / 25 |
| forge | 1.7.10 / 1.12.2 / 1.16.5 / 1.20.1 | 8 / 8 / 8 / 17 |
| neoforge | 1.20.1 / **1.21.1** / 1.21.x（1.21.11）/ 26.2 / **26.3**（上游只有 `-beta`） | 17 / 21 / 21 / 25 |
| spigot | 1.7.10 / 1.12.2 | 8 |

26.x 的坐标按版本钉死（26.2 与 26.3 各一套）：mod 平台请求一个未钉的版本（如 `26.4`）会**显式报错**并列出已钉版本，不会静默给你另一版的项目。26.2 的坐标：fabric `loom 1.17.19 / loader 0.19.3 / api 0.157.0+26.2`、neoforge `moddev 2.0.144 / 26.2.0.59`；26.3：fabric `loom 1.17.21 / loader 0.19.5 / api 0.161.0+26.3`、neoforge `moddev 2.0.147 / 26.3.0.12-beta`。26.3 的 Java 仍是 25。**四组真机构建已跑通**（2026-09）：paper 26.2（对照）/ paper 26.3 / fabric 26.3 / neoforge 26.3 全部 BUILD SUCCESSFUL。fabric 的 loom 刻意留在 1.17 线：1.18.2 要求 **Gradle 自身跑在 Java 25** 上（`requires at least JVM runtime version 25`），会把「用旧 JDK 启动 Gradle」的用户全部挡掉。

## 前置要求

- dsh 本体（Node ^22.19 || >=24，pnpm）
- **JDK**：现代线（1.18.2+）模板内置 foojay toolchain，缺 JDK 时 Gradle 自动下载（首次联网）；老线（1.7.10/1.12.2/1.16.5）需手动装 JDK 8 并设 `JAVA_HOME`
- spigot 1.7.10 模板构建前需按项目内 `libs/README.txt` 放置 spigot-api jar（该版本无公共 maven）
- 首次构建下载依赖需 5~15 分钟

## 开发

```sh
npm run test         # node --test 单测（纯函数，无 dsh 依赖）
npm run check-links  # 核对文档链接与 curse.maven projectId（联网；BROKEN=0 为通过）
```

### npm 发布（用户已授权自动执行）

**发布流程由 agent 自动执行**（用户 2026-08-31 确认"以后都这样发"）：

1. `npm whoami --registry=https://registry.npmjs.org` 确认登录；401/404 时先 `npm login --auth-type=web --registry=https://registry.npmjs.org`（浏览器授权，TTY 下会打印完整 `https://www.npmjs.com/auth/cli/...` 链接）。
2. `npm publish --registry=https://registry.npmjs.org`（prepublishOnly 自动跑测试）。
3. 发布后 `npm view <name> version` 验证（npm 提示"processing may take a few minutes"，验证需稍等）。

已知坑（2026-08-31 实测）：
- **token 过期** → `npm publish` 报 `404 PUT /package - Not found`（npm 对未授权发布统一回 404 掩码；不是网络问题）。解法：重新 web 登录。
- **版本已 staged** → 报 `409 Cannot publish over previously staged version "X.Y.Z"`（上次发布中断残留）。解法：等 staged 过期，或 bump 到下一个版本发布。
- 浏览器授权 URL 只在真实 TTY 显示（管道/重定向时被 `***` 打码）——需要用户终端操作时明确交给用户。

## Known Limitations and Deferred Work

- API 参考为精选高频签名（非全量 Javadoc），每份标注核对日期；`npm run check-links` 校验 http(s) 链接与 curse.maven projectId（经 api.cfwidget.com；403 限流等归 UNVERIFIABLE），**fileId 仍须以 CurseForge 文件页「Curse Maven 代码」为准**。API 更新流程：改 references → `npm run check-links` → 人工复核 UNVERIFIABLE 项。
- `mc_gradle` 依赖目标机存在 taskkill（win32）；输出截断为头尾内联标记，不做 spill 文件。
- 用户本地同名技能（`~/.dsh/skills/` 等，rank 低于 600）会覆盖本包 bundled 技能——预期行为，冲突时删本地同名目录。
- 版本信息以 2026-09 为准；26.x 生态仍在快速变化（**Paper 26.3 只有 `-alpha` 构建、NeoForge 26.3 只有 `-beta`**，26.2 两边都已 stable）。
- **26.3 已真机构建验证，但生态仍是 alpha/beta 期**：2026-09 实跑四组构建全部成功 —— paper 26.2（对照，13s）、paper 26.3（8s，`26.3.build.+` 命中上游 `-alpha` 构建）、fabric 26.3（23s）、neoforge 26.3（6m43s，NeoForge `26.3.0.12-beta` + moddev 2.0.147）。但 **Paper 26.3 目前只有 `-alpha` 构建、NeoForge 26.3 只有 `-beta`**，生产使用前请自行评估；26.2 两边都已 stable。
- **fabric 模板的 toolchain 修复（v0.9.0）**：两个 fabric 模板此前缺 foojay 解析器与 `java.toolchain`，只写 `options.release` + source/targetCompatibility —— 环境 JDK 低于目标时（本机默认 Java 22、26.x 线目标 25）直接报「不支持发行版本 25」且无法自举。现在与 paper/neoforge 一致：`settings.gradle` 带 `org.gradle.toolchains.foojay-resolver-convention:1.0.0`，`build.gradle` 用 `java { toolchain { languageVersion = JavaLanguageVersion.of(N) } }`，由 foojay 自动 provision。**这是 fabric（含 1.20/1.21 线）长期存在的缺陷，本次因真机构建才暴露。**
- 市场类型判定：preset 文件（`preset.yml` + `agent.cordis.yml`）必须放在仓库的 `preset/minecraft/` 子目录——放仓库根目录会把市场类型从 cordis-plugin 误判为 agent-preset。
- preset 人设为 2026-09 基线；26.x 生态（NeoForge 26.3 beta）变化时以技能 references 更新为准。
- **两种 preset 形态**（v0.9.0）：`agent.cordis.yml` 是 0.1.5/0.1.6 的目录安装源，`rows.js` 由它生成、供 0.1.7+ 的 `agentPresets.register()` 使用；`test/preset-rows-parity.test.js` 锁死两者一致（行 id/name 顺序、标量配置、所有块标量的逐字节文本）。只有两处刻意不同：`!!js` 平台表达式在 JS 里是真实布尔值，`dsh-workflow-worker-thread` 在 0.1.7 里换成 `dsh-workflow-ptc`。
- 4 个子代理的 toolFilter：A 环白名单含 `web_search` + `web_fetch`（preset 的 `tool-web` 已设 `fetch: true`，宿主注册 `web_fetch`）；若部署自定义关闭 `fetch`，需把 `web_fetch` 从 A 的 allow 名单移除，否则 `restrict()` 启动校验会报未知工具。
- toolFilter 名单在子代理启动时校验（`tools.restrict()`），未知工具名直接报错——部署裁剪工具集（如禁用 tool-fs/tool-web）时需同步改 `cordis.patch.yml` 的 allow 名单（报错信息会列出已知全局工具名，可据此调整）。
- preset 自动安装（v0.6.0，**仅 0.1.5/0.1.6 的目录形态**）发生在 dsh 启动（插件挂载）时——装完插件**必须重启 dsh** 才触发（这同时也是插件生效所需的重启）；只写入、永不覆盖已有 preset（`agent.cordis.yml` 存在即跳过）；关闭开关 `autoInstallPreset: false`（只影响文件拷贝，不影响 0.1.7 的服务注册）；preset 内容更新不会自动传播——需删掉 `$DSH_HOME/.agent-presets/minecraft/` 让下次启动重新安装。**0.1.7+ 是服务注册，没有文件、没有这个陈旧问题：每次启动都按 `rows.js` 重新声明。**
- **preset 人设更新（v0.7：铁律 7 信息核对）需重装 preset**：删 `$DSH_HOME/.agent-presets/minecraft/` → 重启 dsh → 自动重装（人设含"信息不足先批量提问"行为规则；不重装则只有技能层生效，行为规则缺失）。**重装会覆盖手改——更新前先备份该目录**。
- 子代理继承宿主进程环境（`JAVA_HOME` 等）：老线（1.7.10/1.12.2/1.16.5）构建失败多为 JDK 8 环境问题而非代码问题，D 环会优先报环境。
- **v0.8.0 架构师预设必须在重启 dsh 后才可用（实测）**：预设行 `minecraft-dev/codex` 是从 profile 目录解析的，而运行中的 dsh 进程已缓存了旧版 `package.json`（无 `./codex` 导出）与旧 `lib/present.js`，于是会报 `Package subpath './codex' is not defined by "exports"` 或 `does not provide an export named 'codexCallView'`。**重装插件后重启 dsh 即可**（新进程读的是磁盘上的新清单）；重启前的挂载失败不代表文件有问题。
- `preset.yml` 用严格 YAML 解析（js-yaml）：`name`/`description` 里出现 `[`、`]`、`: ` 等必须**加引号**，否则整个元数据块被丢弃，预设会显示成无名且没有 roster 顺序（v0.8.0 开发中踩过：未加引号的 `[TODO: Agent B]`）。
- `mc_codex` 的 `filesChanged` 是按 mtime 扫描项目目录得出的（已跳过 `.dsh/.git/node_modules/build/...`），因此可能包含子进程自己产生的临时文件（例如 PowerShell 的 `ModuleAnalysisCache`）——这是如实报告，不是项目文件清单。
- `mc_codex` 用的是**你自己账号的 Codex**，DSH 不会显示这笔消耗（订阅计入用量窗口 / API key 计入余额）；技能因此把委派上限写死为「架构 1 次 + 修复 ≤1 次」，且失败不自动重试。
- `mc_codex` 的 `mode: "app-server"` 走官方 `codex app-server --stdio`（NDJSON JSON-RPC：`initialize` → `initialized` → `thread/start` → `turn/start` → `turn/completed`），**不经过 shell**，所以卡片上的命令是 `"…codex.exe" app-server --stdio`，实际交互是协议而非命令行；prompt 仍然原样放进 `turn/start` 的一个 text input，内容就是 `.dsh/codex-architect.md`。`mode: "exec"` 则走 `cmd.exe /d /s /c` + stdin 重定向（POSIX 走 `/bin/sh -c`）：卡片显示的命令**就是**实际执行的命令。两种模式下 Codex 自身报错（鉴权/额度/网络）都会原样回显，不做归类改写。
- **app-server 模式的两条协议细节（实测，0.155.0-alpha.9.2）**：① `turn/completed` **不带** usage，token 总量只能从 rollout 的 `event_msg`/`token_count`/`info.total_token_usage.total_tokens` 读，所以 `mc_codex` 会自己去读那个文件的尾部；② 线程的 `source` 由 app-server 协议决定（实测为 `vscode`，`originator` = 客户端名 `DeepSeek Harness`），**不能用参数指定**（`sessionStartSource` 只接受 `startup`/`clear`，`codex exec resume --thread-source vscode` 也不会改已有线程的 source）。
- **CLI 会话不进 Codex 桌面版列表（实测）**：`codex exec` 线程在 `state_5.sqlite` 里是 `source='exec'`、`has_user_event=0`，而桌面版侧边栏的 `thread/list` 带固定 `sourceKinds` 白名单（只含 `vscode`/`appServer` 一类），所以 App 里找不到；这也是 `mc_codex` 默认改用 app-server 模式的原因——该模式下线程是 `source='vscode'`，实测跑完立刻出现在默认 `thread/list` 结果里。`mode: "exec"` 时仍额外回报 `rolloutPath`，续接用 `codex exec resume <id> "…"`。
