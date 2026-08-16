# Paper 服务端插件开发（minecraft-paper-plugin）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build。本技能覆盖现代线（MC 1.20.x / 1.21.x / 26.x）；1.7.10~1.12.2 老线见 minecraft-spigot-legacy（v0.3 提供）。
> **铁律：API 签名一律 `read_file` 查 `references/api/`，禁止凭记忆写签名。** 参考里没有的，用 web 工具查官方文档（docs.papermc.io 或 javadoc.io），不要编。
> 核对日期：2026-08。

## 1. 定位与家族

- Paper 是 Spigot/Bukkit 的延续，API 兼容 Bukkit 插件：为 Paper 写的插件一般也能跑在 Spigot 上（除非用了 Paper 专属 API）。
- 家族成员：**Paper**（主流推荐）、**Purpur**/Pufferfish（Paper 衍生，额外配置）、**Folia**（Paper 的分区调度分支，API 基本兼容但调度模型完全不同——Folia 上不能用 Bukkit 的同步调度器）。写通用插件默认目标 Paper。

## 2. 版本对应（现代线）

| MC | Paper 支持 | Java |
|---|---|---|
| 1.20.x | 支持（1.20.6 起运行要求 Java 21） | 17 / 21 |
| 1.21.x | 支持，**当前稳定主流线**，最新 1.21.8 | 21 |
| 26.x（26.2） | 已支持 | 25 |

paper-api 坐标（仓库 `https://repo.papermc.io/repository/maven-public/`）：
- 1.x 时代：`io.papermc.paper:paper-api:<mc版本>-R0.1-SNAPSHOT`（如 `1.21.8-R0.1-SNAPSHOT`）
- 26.x 时代：`io.papermc.paper:paper-api:26.<次版本>.build.+`（如 `26.2.build.+`，滚动取该线最新构建）

## 3. 项目骨架

**新项目一律优先用 `mc_scaffold` 工具**（platform=paper），它会生成配好 shadow 打包 + toolchain + wrapper 的完整项目。已有项目按下面核对：

`build.gradle.kts` 两条路线（二选一）：
- **轻量路线（默认）**：`compileOnly("io.papermc.paper:paper-api:...")` + shadow 插件打 fat jar。绝大多数插件用这个。
- **重型路线**：`io.papermc.paperweight.userdev` 插件——需要反混淆服务器类（改 NMS）时才用；会拖慢构建，不推荐新手。

## 4. plugin.yml 必填字段

```yaml
name: my-plugin          # 小写，与 jar 名一致
version: 0.1.0
main: com.example.MyPlugin   # 主类全限定名，写错服务器直接拒绝加载
api-version: "1.21"      # 声明目标 API 级别：1.x 写主次版本（"1.21"）；26.x 只写主版本（"26"，官方文档明确不含小版本）
author: name
description: 一句话说明
# 可选：commands / permissions / depend / softdepend / libraries
```

## 5. API 要点（签名查 references/api/）

- **生命周期**：`JavaPlugin` 子类 + `onEnable()`/`onDisable()`；`getLogger()` 输出日志。
- **事件**：`@EventHandler` 监听器类 + `getServer().getPluginManager().registerEvents(listener, this)` → 详见 `references/api/events.md`
- **命令**：plugin.yml 声明 + `CommandExecutor`/`TabCompleter` → `references/api/commands.md`
- **玩家/物品**：`Player`、`ItemStack`、`Inventory`、`ItemMeta` → `references/api/player-and-inventory.md`
- **调度/配置**：`BukkitRunnable`、`getConfig()` → `references/api/scheduler-and-config.md`
- **世界/方块**：`World`、`Block`、`Location`、`Material` → `references/api/world-and-block.md`

## 6. 常见坑

1. **main 类全限定名写错**：`plugin.yml` 的 `main:` 与真实类路径不一致 → 加载报 `Invalid plugin.yml` 或 `ClassNotFound`。
2. **api-version 缺失/过旧**：新 MC 上加载老声明会警告甚至拒绝；声明了就按新行为解析 Material 等枚举。
3. **异步代码触碰主线程 API**：异步任务里改方块/物品栏/传送到主线程 API → 用 `Bukkit.getScheduler().runTask(plugin, ...)` 切回主线程（Folia 例外）。
4. **依赖打进 fat jar**：paper-api 是 compileOnly，只有真正需要的运行时库才该被 shadow 打包，否则类冲突。
5. **慎用 `/reload`**：会破坏插件状态，测试时尽量重启服务器；热重载插件用 PlugMan 类插件也要小心。
6. **物品比较用 `ItemStack.isSimilar()`** 而不是 `equals()`；Material 对比不要用字符串。

## 7. 构建 / 测试 / 热重载流程

1. `gradlew build`（Windows: `cmd /c "gradlew.bat build"`）→ 产物 `build/libs/<name>-0.1.0.jar`
2. 拷入测试服的 `plugins/` 目录，重启服务器
3. 观察控制台：`[name] enabled` 出现即加载成功；报错看堆栈第一行
4. 改代码 → 重新 build → 重新拷贝重启（迭代期可配 `gradlew build -x test` 加速）
5. 本地起 Paper 测试服：从 papermc.io 下载对应版本 server jar，`java -jar paper.jar` 首次生成 eula.txt，同意后启动
