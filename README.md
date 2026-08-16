# minecraft-dev

Minecraft 开发插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)：让 agent 更擅长写 Minecraft 服务端插件与模组，覆盖 **MC 1.7.10 ~ 26.x 全时代**。

已发布 npm：[`minecraft-dev`](https://www.npmjs.com/package/minecraft-dev)（MIT）

## 功能一览

### 7 个技能（模型按需加载，不占常驻上下文）

| 技能 | 内容 |
|---|---|
| `minecraft-java-build` | 全时代 Java/Gradle 构建知识：JDK 配对表、wrapper、foojay toolchain、依赖仓库、常见坑 |
| `minecraft-paper-plugin` | Paper/Spigot 现代线插件（1.20.x / 1.21.x / 26.x）+ 5 份 API 参考 |
| `minecraft-fabric-mod` | Fabric 模组（loom/loader/fabric-api/yarn 配合）+ 4 份 API 参考 |
| `minecraft-forge-mod` | 传统 Forge 四时代（1.7.10 FG2 / 1.12.2 FG3 / 1.16.5 FG5 / 1.20.1 FG6）+ 3 份时代 API 参考 |
| `minecraft-neoforge-mod` | NeoForge（1.20.1 legacyforge / 1.21.x / 26.2 beta）+ 3 份 API 参考 |
| `minecraft-spigot-legacy` | 1.7.10 / 1.12.2 老线 Bukkit 插件 + Cauldron/Thermos/Mohist 混合服说明 + 2 份老线 API 参考 |
| `minecraft-major-mods` | 大型模组附属开发：28 个模组条目（1.7.10×10 / 1.12.2×8 / 现代×10，含拔刀剑、神秘时代、匠魂、植物魔法、Create、Botania、AE2、Mekanism、Curios、JEI/REI 等），每条含核实过的 curse.maven 坐标与扩展点 |

### 2 个工具

| 工具 | 用途 |
|---|---|
| `mc_scaffold` | 一句话创建完整可构建项目：paper / fabric / forge / neoforge / spigot 五平台，自动配好构建脚本、主类、元数据、**时代对应的 Gradle wrapper** |
| `mc_gradle` | 在项目里跑 `gradlew <task>`：终端卡片显示、超时自动杀进程树、输出头尾截断、非零退出码不报错而是可读呈现 |

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
dsh plugin --profile web add ./minecraft-dev-0.4.0.tgz
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
pnpm dsh --profile web --dump-config     # 应出现 "# == minecraft-dev" 层与两行插件
```

### 卸载

```sh
dsh plugin --profile web remove minecraft-dev
```

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
```

完整流程：模型加载技能 → 调 `mc_scaffold` 生成项目（含 wrapper）→ `mc_gradle build`（或 `cmd /c "gradlew.bat build"`）→ 产出 `build/libs/*.jar`。

### 平台 × 版本支持矩阵（mc_scaffold）

| 平台 | 支持版本 | Java |
|---|---|---|
| paper | 1.20.x / 1.21.x / 26.x | 17 / 21 / 25 |
| fabric | 1.20.1 / 1.21.x / 26.2 | 17 / 21 / 25 |
| forge | 1.7.10 / 1.12.2 / 1.16.5 / 1.20.1 | 8 / 8 / 8 / 17 |
| neoforge | 1.20.1 / 1.21.x / 26.2 beta | 17 / 21 / 25 |
| spigot | 1.7.10 / 1.12.2 | 8 |

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

## Known Limitations and Deferred Work

- API 参考为精选高频签名（非全量 Javadoc），每份标注核对日期；`npm run check-links` 校验 http(s) 链接与 curse.maven projectId（经 api.cfwidget.com；403 限流等归 UNVERIFIABLE），**fileId 仍须以 CurseForge 文件页「Curse Maven 代码」为准**。API 更新流程：改 references → `npm run check-links` → 人工复核 UNVERIFIABLE 项。
- `mc_gradle` 依赖目标机存在 taskkill（win32）；输出截断为头尾内联标记，不做 spill 文件。
- 用户本地同名技能（`~/.dsh/skills/` 等，rank 低于 600）会覆盖本包 bundled 技能——预期行为，冲突时删本地同名目录。
- 版本信息以 2026-08 为准；26.x 生态仍在快速变化（NeoForge 26.2 为 beta）。
