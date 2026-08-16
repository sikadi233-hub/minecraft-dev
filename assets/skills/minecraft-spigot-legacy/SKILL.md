# Spigot 老线插件开发（minecraft-spigot-legacy）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build（老线 JDK 8 与 Gradle 8.14.3 配对见该技能）。
> **铁律：API 签名一律 `read_file` 查 `references/api/`（bukkit-1.7.10.md / bukkit-1.12.2.md），禁止凭记忆写签名。** 参考里没有的，用 web 工具查老 javadoc 或反编译 vendored jar，不要编。
> 核对日期：2026-08-16。坐标全部照 v0.3 矩阵钉选值（versions.js spigot 条目），随生态更新。

## 1. 定位与家族

- 本技能覆盖 **Spigot/Bukkit 老线插件**：Minecraft 1.7.10 与 1.12.2。这两条线属老 API 时代：无 `api-version` 字段、无 Paper 现代 API、无 Brigadier 命令框架。
- 家族谱系：CraftBukkit（服务端实现）→ Spigot（性能 fork，插件开发标准目标）→ Paper（1.8 起分支，老线仍可跑但本文不涉及）。为 1.7.10/1.12.2 写的插件就是普通的 `extends JavaPlugin`，服务端加载 `plugins/` 下的 jar。
- 现代线（Paper 1.20+/1.21+/26.x）见 minecraft-paper-plugin 技能；两条线的 API 差异巨大（Material 改名、命令系统、聊天组件），不要跨线混写。
- **混合服**（Forge 模组 + Bukkit 插件同一服务端）：
  - **1.7.10 线**：Cauldron（MCPC+ 系，已停）→ **KCauldron**（1.7.10 主流，已停）→ **Thermos**（KCauldron 优化 fork，需 Java 8，仅 1.7.10，已停）→ ThermosX / Mohist-1.7.10（后继 fork）。
  - **1.12.2 线**：**Mohist 1.12.2**（Thermos 系继承，社区 EOL 但仍可用）、**CatServer 1.12.2**（国产 1.12.2 Forge+Bukkit 混合服，插件兼容性评价较高）。
  - 插件在混合服照常进 `plugins/`，用法与纯 Spigot 一致；但混合服有事件侧漏、NMS 差异、WorldEdit 等需补丁版等已知问题（见 §7），模组联动细节见 minecraft-major-mods 技能。

## 2. 版本对应与坐标

| MC | spigot-api 坐标 | API 来源 | Java 编译 |
|---|---|---|---|
| 1.12.2 | `org.spigotmc:spigot-api:1.12.2-R0.1-SNAPSHOT` | hub.spigotmc.org 双仓库（snapshots + groups/public） | 8 |
| 1.7.10 | `org.spigotmc:spigot-api:1.7.10-R0.1-SNAPSHOT`（规范名） | **vendored jar**（无公共 maven） | 8 |

- **1.12.2**：模板用 `compileOnly` 钉坐标，仓库必须配**三处**——spigot-api 本体在 hub `repositories/snapshots/`；其传递依赖 `net.md-5:bungeecord-chat:1.12-SNAPSHOT` **只在** hub `groups/public/` 可解析（老 sonatype snapshots 仓库已死 404，别照抄老 wiki 的单仓库写法）；guava 21.0 / gson 2.8.0 / snakeyaml 1.19 / commons-lang 2.6 / json-simple 1.1.1 等其余传递依赖**只在 Maven Central**（2026-08-16 真实构建实测：缺 `mavenCentral()` 直接解析失败）。
- **1.7.10**：2026-08 实测 spigot-api 1.7.10 在任何公共 maven 都不存在（hub 最早 1.8；各镜像 404；jitpack 因 Bukkit GitHub 历史被 DMCA 重置而无 tag）。模板采用 vendored jar：把 getbukkit.org 归档的完整服务端 jar（内含 org/bukkit/** 与 org/spigotmc/** API 类，1.7.10 时代服务端 jar 未混淆 API）放进 `libs/`，`compileOnly files('libs/spigot-1.7.10-R0.1-SNAPSHOT.jar')`。核对来源补充：maven.enginehub.org 上有 `org.bukkit:bukkit:1.7.10-R0.1-SNAPSHOT` 的 jar + javadoc jar（2026-08 实测），可用作签名核对。
- **Java 8**：两条线都按 Java 8 编译（1.12.2 服务端要求 Java 8；1.7.10 服务端 Java 7/8 皆可，社区现状按 8）。若你的 1.7.10 服跑 Java 7，需自行把 build.gradle 的 `sourceCompatibility`/`targetCompatibility` 改成 `'1.7'`（模板不提供开关）。
- **Gradle 8.14.3**：最后支持在 Java 8 上运行的行（Gradle 9 起最低 JVM 17）。老线项目本机必须装 JDK 8 并设 `JAVA_HOME`，否则 wrapper 直接失败。历史参考：1.7.10 时代 Gradle 2.x、1.12.2 时代 Gradle 4.x——不用老 Gradle，因为对 Java 8 无增益且 wrapper 兼容面差。
- `1.7.9` 等 1.7.x 按 1.7.10 API 编译即可在 1.7.9 服运行（API 相同）；`1.12.1` 同理命中 1.12.2 模板。

## 3. 项目骨架

**新项目一律用 `mc_scaffold` 工具**（platform=spigot，选 1.7.10 或 1.12.2），生成：build.gradle / settings.gradle / plugin.yml / 主类 / wrapper 四件套 / README。结构：

```
build.gradle                  # java 插件 + compileOnly spigot-api（1.12.2 走 hub；1.7.10 走 libs/ 的 vendored jar）
src/main/resources/plugin.yml # 插件元数据（无 api-version）
src/main/java/<pkg>/<Main>.java  # extends JavaPlugin
libs/README.txt               # 仅 1.7.10：API jar 放置说明
```

- 编译就是对照 spigot-api jar / vendored jar 里的类，没有反混淆步骤，`javap` 可直接查类。
- 1.7.10 项目构建前必须先按 `libs/README.txt` 放置 jar，缺失时 Gradle fail-loud。
- 两模板都不含 runClient/runServer 任务（spigot 插件开发没有 FG runs 机制）；测试 = 拷 jar 进服 reload。

## 4. plugin.yml 必填

```yaml
name: myplugin            # 小写，与 jar 名一致
version: 0.1.0
main: com.example.Main    # 主类全限定名，写错服务器直接拒绝加载
description: ...
author: ...
# 可选：commands / permissions / depend / softdepend / load
```

- **禁止 `api-version` 字段**：该字段 1.13 才引入，老线服务端不认识（1.12.2 忽略未知字段，但严格避免；无益有害）。
- commands 段老写法（与 Paper 相同但少字段）：

```yaml
commands:
  mycmd:
    description: Do something
    usage: /<command>
    permission: myplugin.mycmd
permissions:
  myplugin.mycmd:
    description: Allows /mycmd
    default: op        # true / false / op / not-op
```

- `load: STARTUP` 可选（默认 POSTWORLD）；`depend`/`softdepend` 可用于混合服模组检测的前置插件名。

## 5. API 要点（签名查 references/api/）

- **生命周期**：`JavaPlugin` 子类 + `onLoad()`/`onEnable()`/`onDisable()`；`getLogger().info(...)` 输出带 `[插件名]` 前缀；配置相关 `getConfig()`/`saveDefaultConfig()`（默认 config.yml 放 `src/main/resources/`）。
- **事件**：监听器类 `implements Listener` + `@EventHandler(priority=..., ignoreCancelled=...)`，`getServer().getPluginManager().registerEvents(listener, this)` 注册 → `bukkit-1.7.10.md` §2 / `bukkit-1.12.2.md` §2。
- **命令**：plugin.yml 声明 + 主类 `implements CommandExecutor`，`getCommand("x").setExecutor(this)`；老线无 Brigadier，补全靠 `TabCompleter` 手动注册 → 两参考文件 §3。
- **物品/玩家**：`Material`/`ItemStack` 老常量名、`Player`/`World`/`Block`/`Location` 常用方法 → 参考文件 §5/§7。
- **调度**：`Bukkit.getScheduler().runTask(...)`/`runTaskLater`/`runTaskTimer`/`runTaskAsynchronously`，`BukkitRunnable` 两线都有 → 参考文件 §6。
- **聊天**：无 Adventure，`ChatColor` 时代（`&` 前缀 + `translateAlternateColorCodes`）→ 参考文件 §4。

## 6. 构建 / 测试

1. 装 JDK 8，`JAVA_HOME` 指向它（见 minecraft-java-build；Gradle 8.14.3 要求 Java 8 才能跑）。
2. 构建：Windows `gradlew.bat build` / POSIX `./gradlew build`；可用 `mc_gradle` 工具（projectDir=项目根，task=build；慢网首次构建建议 `args: ['--no-daemon']`）。
3. 产物 `build/libs/<name>-0.1.0.jar` 拷入测试服 `plugins/`，服务端内执行 `reload`（或重启）。
4. 控制台出现 `[name] enabled` 即加载成功；报错看堆栈第一行。改代码 → 重新 build → 重新拷贝 reload。
5. 测试服 jar 来源：getbukkit.org（spigot-1.7.10 / spigot-1.12.2 完整服务端）；1.12.2 服需 Java 8。
6. 首次构建下载依赖慢（spigot-api + 传递依赖）；SNAPSHOT 缓存疑点时 `gradlew build --refresh-dependencies`。

## 7. 常见坑

1. **plugin.yml 写 `api-version`**：老服不认（1.13+ 字段），规范上禁止；写错的插件在新老服都有告警/兼容问题。
2. **JDK 版本不匹配**：JDK 7 服的 1.7.10 加载 Java 8 编译的插件 → `UnsupportedClassVersionError`；JDK 17 机器跑 Gradle 8.14.3 老项目 → wrapper 失败（需设 JAVA_HOME=JDK 8）。
3. **Material 用现代名**：老 jar 里没有 `OAK_PLANKS`/`STONE_BRICKS` 等（1.13 才改名）；对照表见参考文件 §5。同理 `getTypeId()` 老线可用、1.13 移除——老线项目别提前"现代化"。
4. **getOnlinePlayers 类型**：两线都返回 `Collection<? extends Player>`（1.7.10 还有 `@Deprecated` 的 `_INVALID_getOnlinePlayers()` 返回 `Player[]`，别用）；老代码里 `(Player[]) Bukkit.getOnlinePlayers().toArray()` 要改成 `toArray(new Player[0])`。
5. **tab-complete 误解**：别信"老线没法做补全"——`TabCompleter` 接口 1.7.10 jar 里就有（1.4.6 引入），只是要 `setTabCompleter()` 手动注册；1.13 前无 Brigadier，不能用现代注册方式。
6. **异步坑**：`runTaskAsynchronously` 里不能碰主线程 API（改方块/物品栏/传送）；聊天建议用 `AsyncPlayerChatEvent`（同步的 `PlayerChatEvent` 1.7.10 起已弃用）。
7. **混合服事件侧漏**：Thermos/KCauldron 上部分 Forge 产生的事件不会触发 Bukkit 监听器（如某些实体生成/方块变化），插件会"莫名不生效"；排查时先用 `getServer().getPluginManager().isPluginEnabled("xxx")` 确认加载，再看混合服已知问题清单。模组侧联动见 minecraft-major-mods。
8. **SNAPSHOT 缓存**：hub nexus 对非时间戳文件名直接 404，Gradle 走 maven-metadata.xml → timestamped 文件才正常；若依赖解析报 404，先清 `~/.gradle/caches` 里该模块或加 `--refresh-dependencies`，别改坐标。
9. **reload 兼容性**：老服 `/reload` 会重置插件状态（服务端本体也常见报错），测试尽量重启服务端；热重载类插件（PlugMan）在老线同样要小心。

## 8. 参考文件索引

- `references/api/bukkit-1.7.10.md` — 1.7.10 API 事实（以 enginehub 的 org.bukkit:bukkit:1.7.10-R0.1-SNAPSHOT jar + javadoc 核对，2026-08-16）
- `references/api/bukkit-1.12.2.md` — 1.12.2 API 事实（以 hub 的 spigot-api-1.12.2-R0.1-SNAPSHOT jar 核对）+ 1.12 增量
- 混合服 plugin.yml 字段对照：并入上两文件的「plugin.yml 字段」段
