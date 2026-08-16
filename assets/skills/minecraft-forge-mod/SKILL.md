# Forge 模组开发（minecraft-forge-mod）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build（老线 JDK 8 配对见该技能）。
> **铁律：API 签名一律 `read_file` 查 `references/api/`（forge-1.7.10-api.md / forge-1.12.2-api.md / forge-modern-api.md），禁止凭记忆写签名。** 参考里没有的，用 web 工具查官方文档（docs.minecraftforge.net / maven.minecraftforge.net 上的 MDK zip 与 javadoc），不要编。
> 核对日期：2026-08-16。本技能版本坐标全部照 v0.2 矩阵钉选值，随生态更新（R10）。

## 1. 定位与四时代

Forge 是 Minecraft 历史最久、老版本生态最全的模组加载器（2011 年起）。它的开发方式随时代剧烈变化，**年代鉴定是第一技能**：拿到一个 Forge 项目，先看 build.gradle 的 ForgeGradle 版本、`@Mod` 的写法、有无 mods.toml，确定时代，再按时代规则处理。本技能覆盖四个时代，三轴区分：

| 轴 | 1.7.10 | 1.12.2 | 1.16.5 | 1.20.1 |
|---|---|---|---|---|
| 工具链 | FG 1.2 fork（anatawa12，官方 1.2-SNAPSHOT 已不可用，见 §3）+ Gradle 7.4.2 | FG 3（Gradle 4.9） | FG 5（Gradle 7.3.3） | FG 6（Gradle 8.8） |
| 映射 | MCP（无 mappings 行，默认） | MCP snapshot 20171003-1.12 | official（mojmap）1.16.5 | official 1.20.1 |
| 元数据 | mcmod.info（JSON 数组） | mcmod.info + pack.mcmeta(3) | mods.toml + pack.mcmeta(6) | mods.toml + pack.mcmeta(15) |
| 事件 | @Mod.EventHandler + FML*Event | @Mod.EventHandler + FML*Event（另有 game bus @SubscribeEvent） | mod bus（IEventBus）+ game bus | 同 1.16.5 |
| 注册 | GameRegistry.registerBlock/Item | RegistryEvent.Register | DeferredRegister + RegistryObject | 同 1.16.5 |
| 客户端/服务端 | @SidedProxy | @SidedProxy | DistExecutor / @OnlyIn | 同 1.16.5 |
| 命令 | FMLServerStartingEvent.registerServerCommand | CommandRegistryEvent（或 ServerStartingEvent） | RegisterCommandsEvent + brigadier | 同 1.16.5 |

**NeoForge 分家点**：NeoForge 于 1.20.1 开发期（2023 年中）从 Forge 分叉。1.20.1 是两平台共存的最后版本（本技能 1.20.1 线走 Forge FG6 + 47.3.0；NeoForge 1.20.1 的 legacyforge 路线见 minecraft-neoforge-mod 技能）；**1.20.2 之后没有 Forge**，只有 NeoForge。改 1.21+ 的模组请加载 minecraft-neoforge-mod。

## 2. 版本对应

全部坐标来自 v0.2 矩阵（versions.js 的 forge 条目），mc_scaffold 自动注入，不要手写：

| 时代 | MC | Forge | ForgeGradle 坐标 | Gradle wrapper | 跑 wrapper 的 JDK | 编译级别 | 映射 | 元数据 |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.7.10 | `10.13.4.1614-1.7.10` | `com.anatawa12.forge:ForgeGradle:1.2-1.1.+` | 7.4.2 | 8~18，**建议装 JDK 8 并设 JAVA_HOME** | 8 | MCP（默认） | mcmod.info |
| 2 | 1.12.2 | `14.23.5.2860` | `net.minecraftforge.gradle:ForgeGradle:3.0.197` | 4.9 | **仅 8~10**（Java 11+ 直接失败） | 8 | MCP snapshot `20171003-1.12` | mcmod.info |
| 3 | 1.16.5 | `36.2.39` | `net.minecraftforge.gradle:ForgeGradle:5.1.77` | 7.3.3 | 8~18（建议 8） | 8 | official `1.16.5` | mods.toml |
| 4 | 1.20.1 | `47.3.0` | `net.minecraftforge.gradle:ForgeGradle:6.0.54` | 8.8 | 17+（settings.gradle 有 foojay 自动装） | 17 | official `1.20.1` | mods.toml |

要点：
- **Gradle 与 JDK 配对是本技能最大坑**：Gradle 4.9 只能跑 Java 8~10；7.3.3/7.4.2 只能跑 ≤18；老线没有 toolchain 自动下载（foojay 帮不上 4.9），必须手动装 JDK 8 并设 `JAVA_HOME` 再跑 `gradlew`。详见 minecraft-java-build 的时代表。
- 官方历史：1.7.10 当年官方配 Gradle 2.x~3.x + FG1.2（MCP）；现役方案是 anatawa12 fork + Gradle 7.4.2（官方 MDK zip 与 FG 1.2-SNAPSHOT 均已不可用，R2）。
- 1.16.5 官方 MDK 现状用 official（mojmap）映射；MCP 映射（channel 'snapshot'）在 1.16 时代仍可选但官方不再推荐。
- Forge 版本号规则：`<MC>-<Forge版本>`（1.7.10 坐标含两遍 MC，如 `10.13.4.1614-1.7.10`）；1.12.2 起坐标写作 `1.12.2-14.23.5.2860`。

## 3. 项目骨架

**新项目一律用 `mc_scaffold` 工具**（platform=forge + 目标 MC 版本），自动生成对应时代模板 + 钉选坐标 + wrapper。

- **buildscript-classpath 时代（1.7.10 / 1.12.2）**：build.gradle 顶部 `buildscript { repositories { ... }; dependencies { classpath '<ForgeGradle坐标>' } }` + `apply plugin: 'forge'`（1.7.10）或 `apply plugin: 'net.minecraftforge.gradle'`（1.12.2）。无 settings.gradle。
- **plugins-block 时代（1.16.5 / 1.20.1）**：1.16.5 仍用 buildscript + `apply plugin`（FG5 MDK 写法）；1.20.1 用 `plugins { id 'net.minecraftforge.gradle' version '6.0.54' }`（插件来自 maven.minecraftforge.net，settings.gradle 的 pluginManagement 里已配）+ foojay 自动装 JDK。
- **wrapper 与 common/wrapper 的关系**：模板目录自带 `gradle/wrapper/gradle-wrapper.properties` 钉各时代 Gradle（7.4.2/4.9/7.3.3/8.8）；`gradlew`/`gradlew.bat`/`gradle-wrapper.jar` 由脚手架从 `assets/templates/common/wrapper/` 复制（jar 时代无关，现代 wrapper jar 启动老发行版一般可用；common 的 properties 指向 8.14.3，仅作模板漏放时的兜底，模板自带 properties 优先级更高）。**改模板/排查构建时先看 properties 里的 distributionUrl**。
- **reobfJar 与 SRG 概念**：开发环境用人类可读名（老时代 MCP 名 `func_xxx`→语义名；新时代 official mojmap 名），运行时是混淆名/SRG。1.7.10 的 build 自动 reobf（FG1.x 内置在 jar 流程）；1.12.2 起必须 `jar.finalizedBy('reobfJar')`。**上传的产物必须 reobf 后**，dev 版本 jar 只能在本机 runClient 用。
- 1.7.10 官方 MDK 已下线（files.minecraftforge.net 404，R2），本模板内置 anatawa12 fork 方案。
- 1.16.5 模板无 settings.gradle（MDK 时代无 foojay），本机必须预装兼容 JDK 再跑 wrapper。

## 4. 元数据必填

### mcmod.info（1.7.10 / 1.12.2）
JSON 数组（可含多个 mod 条目），放 `src/main/resources/mcmod.info`。必填：`modid`、`name`、`description`、`version`、`mcversion`、`authorList`（数组）。1.12.2 支持 `dependencies`（数组，元素含 modid/mandatory/versionRange/ordering）。`${version}`/`${mcversion}` 由 build.gradle 的 processResources expand 替换（模板已配）。**无 mods.toml / pack.mcmeta**（1.7.10 连 pack.mcmeta 都不需要；1.12.2 有 pack.mcmeta，pack_format 3）。

### mods.toml（1.16.5 / 1.20.1）
放 `src/main/resources/META-INF/mods.toml`（TOML 格式）。必填：
- 顶层：`modLoader="javafml"`、`loaderVersion`（1.16.5 钉 `"[36,)"`；1.20.1 用 `"${loader_version_range}"`= `[47,)`）、`license`。
- `[[mods]]`：`modId`（小写，模板用 `{{name}}` 或 `${mod_id}`）、`version`、`displayName`、`description`（authorList 在 1.20.1 是 `authors` 数组）。
- `[[dependencies.<modId>]]` 至少两条：`modId="forge"` + versionRange（1.16.5 `[36,)` / 1.20.1 `${forge_version_range}`）+ `mandatory=true`；`modId="minecraft"` + versionRange（1.16.5 `[1.16.5,1.17)` / 1.20.1 `${minecraft_version_range}`）。
- **版本号来源两时代不同**：1.16.5 用 `${file.jarVersion}`（加载器读 jar manifest 的 Implementation-Version，模板 jar 块已写）；1.20.1 用 `${mod_version}` 由 Gradle processResources expand（`${}` 展开与 scaffold 的 `{{}}` 渲染互不冲突——**不要**把 `${...}` 写成 `{{...}}`，R12）。

pack.mcmeta：1.16.5 为 pack_format 6、1.20.1 为 15（模板已配）。

## 5. API 要点（签名一律查 references/api/）

三个参考文件按时代分：
- **`references/api/forge-1.7.10-api.md`**：cpw.mods.fml 时代——@Mod 属性形态、@Mod.EventHandler + FML*Event 签名、GameRegistry、MinecraftForge.EVENT_BUS、@SidedProxy、ICommand 注册。
- **`references/api/forge-1.12.2-api.md`**：net.minecraftforge.fml.common 时代——@Mod、FML 三阶段、RegistryEvent.Register + ForgeRegistries、CommandRegistryEvent、@SidedProxy。
- **`references/api/forge-modern-api.md`**：1.16.5 / 1.20.1——@Mod("modid") 单参形态、mod bus（FMLJavaModLoadingContext）+ game bus（MinecraftForge.EVENT_BUS）、@SubscribeEvent、DeferredRegister + RegistryObject、@EventBusSubscriber、DistExecutor、RegisterCommandsEvent、GatherDataEvent/runData。

时代差异速记：
- `@Mod`：1.7.10/1.12.2 是属性形态（`@Mod(modid=..., name=..., version=...)`，modid 必填）；1.16.5+ 是单参形态（`@Mod("modid")`），属性形态已废弃。
- 事件：1.7.10/1.12.2 生命周期用 `@Mod.EventHandler` + FML*Event；1.12.2 起游戏事件（非生命周期）用 `@SubscribeEvent` 挂 `MinecraftForge.EVENT_BUS`；1.16.5+ 分 **mod bus**（加载期，注册/数据生成用）与 **game bus**（运行时事件），bus 类型 `IEventBus`（net.minecraftforge.eventbus.api）。
- 注册：1.7.10 `GameRegistry.registerItem/registerBlock`（字符串名）；1.12.2 `RegistryEvent.Register<T>` + `setRegistryName`；1.16.5+ `DeferredRegister`（mod bus 上 `register(bus)`）。
- 客户端/服务端：1.7.10/1.12.2 `@SidedProxy`（proxy 字段，clientSide/serverSide 两个类）；1.16.5+ `DistExecutor.unsafeRunWhenOn(Dist.CLIENT, ...)` / `@OnlyIn(Dist.CLIENT)`。

## 6. 构建 / 测试

- 构建：`gradlew.bat build`（Windows）/ `./gradlew build`；产物 `build/libs/{{name}}-0.1.0.jar`（reobf 后），拖入客户端或服务器 `mods/` 目录。
- 运行任务按时代：
  - 1.7.10：**无 runClient/runServer**。可用 `gradlew setupDevWorkspace` 或 IDE（IntelliJ：`genIntellijRuns` 不适用于 FG1.x，用 FG 的 eclipse/idea 任务；不确定查官方 MDK 说明），最简单是直接把产物 jar 放进 `mods/` 启动游戏测试。
  - 1.12.2+：`gradlew runClient` / `gradlew runServer`（首次启动反编译/下载慢，给足超时，R9）。
  - 1.16.5+：另有 `gradlew runData`（数据生成，输出到 `src/generated/resources`；模板已把该目录加入 resources sourceSet）。
- 服务器首次启动会停在 EULA 提示：改 `run/eula.txt` 的 `eula=true`；联机类测试还要 `online-mode=false`。
- 老线构建报错先查 §7 的 JDK/Gradle 配对，再查映射/坐标。

## 7. 常见坑

1. **JDK 与 Gradle 配对（第一大坑）**：Gradle 4.9 只能 Java 8~10；7.3.3/7.4.2 只能 ≤18；用现代 JDK 跑老 wrapper 直接失败（"Unsupported class file major version" 或 Gradle 直接退出）。老线先 `java -version` 确认，再设 `JAVA_HOME` 指向 JDK 8。
2. **FG 与 Gradle 版本严格绑定**：ForgeGradle 1.2 fork↔7.4.2、3.x↔4.9、5.x↔7.3.3、6.x↔8.8，这是官方 MDK 钉选，换 wrapper 前先查表；FG 版本不能随便升级（FG3 的 `3.+` 会被 3.0.197 之后的 SNAPSHOT 破坏）。
3. **mappings 与 MC 不匹配**：1.12.2 的 snapshot 必须对应 1.12.2（20171003-1.12）；1.16.5/1.20.1 的 official 映射版本号必须等于 MC 版本。写错会在反编译/启动阶段崩溃（类找不到、方法签名错误）。
4. **reobfJar 产物别用 dev 版本上传**：本地 runClient 能跑的 jar 不 reobf 直接发出去，客户端加载即崩（NoSuchMethodError）。1.12.2+ 检查 build.gradle 有 `jar.finalizedBy('reobfJar')`。
5. **`${file.jarVersion}` 依赖 manifest**：1.16.5 的 mods.toml 用 `${file.jarVersion}` 取版本，jar 块必须写 `"Implementation-Version": "${version}"`，否则显示空版本号且依赖区间匹配异常。
6. **mcmod.info 的 `${version}` 依赖 processResources expand**：1.7.10/1.12.2 模板已配；手动建项目时漏掉会导致游戏内版本显示字面 `${version}`。
7. **mods.toml 与 TOML 语法**：`[[dependencies.<modId>]]` 的键必须用实际 modId（1.20.1 模板是 `[[dependencies.${mod_id}]]`，展开后为 `[[dependencies.mymod]]`）；漏 `mandatory=true` 或写错 versionRange 会在加载时被拒。
8. **老线运行环境**：1.16.5 客户端官方只发 Java 8（模板 toolchain 8）；1.7.10/1.12.2 时代服务端同样 Java 8。编译级别保持 8，不要为了"现代"改级别（R14）。
9. **首次构建慢**：Forge 老线首次构建要下 MCP/反编译数据，可达 30 分钟~1 小时（R9）；不是卡死，看 `gradlew --status` 或日志。
10. **1.7.10 专属**：`setTextureName` 只有 1.7.10 有（1.8+ 移除，用 JSON 模型）；`CreativeTabs.tabMisc` 小写字段名是老时代写法，1.16.5+ 是 `CreativeModeTab.TAB_MISC`。
