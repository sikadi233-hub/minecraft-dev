# Fabric 模组开发（minecraft-fabric-mod）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build。
> **铁律：API 签名一律 `read_file` 查 `references/api/`，禁止凭记忆写签名。** 参考里没有的，用 web 工具查官方文档（fabricmc.net / meta.fabricmc.net），不要编。
> 核对日期：2026-08。版本随生态漂移，表外版本先查官方源再动手。

## 1. 定位与家族

- **Fabric** = 轻量模组加载器，三件套：`fabric-loader`（加载器，改 mods 目录与 fabric.mod.json）、`fabric-loom`（Gradle 构建插件，反混淆/remap/runClient）、**Fabric API**（模块化库集：`fabric-lifecycle-events-v1`、`fabric-command-api-v2`、`fabric-item-group-api-v1`、`fabric-networking-api-v1` 等，需要哪个引哪个——只引 loader 不引 API 也能写 mod，事件/命令/创造栏这类便利 API 都来自 Fabric API）。
- **Quilt** 是 Fabric 的分支（API 大体兼容，另有 quilt-loader 专属内容），默认按 Fabric 目标开发，不主动适配 Quilt。
- 与 Forge/NeoForge 的差异：无全局事件总线，事件是 `Event<T>` 静态字段 + `.register(...)`；模组元数据是 `fabric.mod.json`（不是 mods.toml）。
- **26.1 起 Minecraft 不再混淆**：Mojang 官方类名直接可用、yarn 映射停更——本技能所有模板统一用官方 Mojang 映射（mojmap），1.x 线经 loom 反混淆、26.x 线直接就是官方名。

## 2. 版本对应（模板钉选，2026-08 核对）

| MC 线 | 默认 MC 版本 | Java | Gradle wrapper | fabric-loom | fabric-loader | fabric-api |
|---|---|---|---|---|---|---|
| 1.20 | 1.20.1 | 17 | 9.5.1 | 1.17.19 | 0.19.3 | `0.92.11+1.20.1` |
| 1.21 | 1.21.11 | 21 | 9.5.1 | 1.17.19 | 0.19.3 | `0.141.6+1.21.11` |
| 26 | 26.2 | 25 | 9.5.1 | 1.17.19 | 0.19.3 | `0.157.0+26.2` |

- **映射**：1.20.1 / 1.21.11 用 `mappings loom.officialMojangMappings()`（mojmap）；**26.x 不写映射行**（26.1 起无混淆）。yarn 在 1.x 时代存在但本技能不用，26.x 无 yarn。
- **构建插件 id**：1.20.1 / 1.21.11（混淆时代）用 `net.fabricmc.fabric-loom-remap`；26.x（无混淆）用原生 `net.fabricmc.fabric-loom`。
- 坐标查询：版本总览 https://fabricmc.net/develop ；全版本数据 https://meta.fabricmc.net/v2/versions/loader 、`/versions/yarn`（可确认 26.x yarn 条目为 0）、maven 元数据 https://maven.fabricmc.net/ 。
- loom 官方示例钉的是 `1.17-SNAPSHOT`，模板钉 stable `1.17.19`（maven 实测存在）；改 loom 版本前先查 maven-metadata.xml。

## 3. 项目骨架

**新项目一律用 `mc_scaffold` 工具**（platform=fabric），生成以下结构：

```
<name>/
├── build.gradle                    # loom 插件 + 依赖 + release
├── settings.gradle                 # pluginManagement（maven.fabricmc.net + mavenCentral + gradlePluginPortal）
├── gradle.properties               # 版本钉选（见第 4 节）
├── gradle/wrapper/… + gradlew(.bat) # Gradle 9.5.1 wrapper
└── src/main/
    ├── java/<pkg>/<MainClass>.java # ModInitializer + ClientModInitializer 主类
    └── resources/fabric.mod.json   # 模组元数据
```

- `build.gradle` 要点：`plugins { id 'net.fabricmc.fabric-loom-remap' version "{{loomVersion}}"; id 'maven-publish' }`；依赖 `minecraft "com.mojang:minecraft:…"` + `mappings loom.officialMojangMappings()`（26.x 无此行）+ `modImplementation "net.fabricmc:fabric-loader:…"` + `modImplementation "net.fabricmc.fabric-api:fabric-api:…"`（**26.x 用 `implementation`**）；`processResources` 对 fabric.mod.json 做 `expand "version": version`；`options.release = <Java 级别>`。**不写 repositories 块**（loom 自动加 Fabric maven）。
- **client source set**（进阶，模板默认不开）：需要把客户端代码与服务端代码物理分开时加
  ```gradle
  loom {
      splitEnvironmentSourceSets()
      mods {
          "{{name}}" { sourceSet sourceSets.main; sourceSet sourceSets.client }
      }
  }
  ```
  客户端代码放 `src/client/java`、客户端资源放 `src/client/resources`。
- **Mixin**：见 `references/api/mixins.md`（fabric.mod.json 加 `"mixins": ["<id>.mixins.json"]`）。
- **资源**：模型/纹理/语言文件放 `src/main/resources/assets/<modid>/`（`models/item`、`textures/item`、`lang/en_us.json`）；物品缺模型会显示紫黑纹理但注册有效。

## 4. gradle.properties（模板生成）

```properties
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true
org.gradle.configuration-cache=false   # loom 已知 issue #1349，官方示例做法，勿手痒改回 true

minecraft_version=…   # 见第 2 节表
loader_version=…
loom_version=…
fabric_api_version=…

version=0.1.0
group=…
```

- `configuration-cache=false` 保持原样；改了如果构建报 loom 缓存相关错误再改回来。
- 26.x 线没有 yarn/mappings 相关 key。

## 5. fabric.mod.json 必填字段

```json
{
  "schemaVersion": 1,
  "id": "my_mod",
  "version": "${version}",
  "name": "My Mod",
  "description": "…",
  "authors": ["…"],
  "license": "MIT",
  "environment": "*",
  "entrypoints": {
    "main": ["com.example.MyMod"],
    "client": ["com.example.MyMod"]
  },
  "depends": {
    "fabricloader": ">=0.19.3",
    "minecraft": "~1.21.11",
    "java": ">=21",
    "fabric-api": "*"
  }
}
```

- `schemaVersion` 必须 1；`id` **小写**（字母数字 `_-`，不区分大小写但规范要求小写），建议与 jar 文件名一致。
- `version` 写成 `"${version}"`，由 build.gradle 的 processResources 从 gradle `version` 展开——**别手写死版本**；展开缺失时 loader 解析失败（坑见第 8 节）。
- `depends` 三件套最常错：`fabricloader`（**>= 钉版本**）、`minecraft`（**~ 波浪线**，见下）、`java`（**>= Java 级别**，低于游戏所需直接拒绝加载）；`fabric-api: "*"` 表示任意版本。
- 版本区间语法（fabric.mod.json 规范，SemVer 扩展）：`~1.21.11` = `[1.21.11, 1.22)`（**波浪线升次版本**；`~26.2` = `[26.2, 26.3)`）；`>=1.21.5 <1.22` 用空格组合；`*` 通配任意。`depends` 值也可以是字符串数组（多区间）。
- 可选字段：`environment`（`"*"`/`"client"`/`"server"`）、`icon`（`assets/<id>/icon.png`）、`contact`（homepage/sources/issues）、`suggests`/`breaks`/`conflicts`、`mixins`、`accessWidener`。

## 6. API 要点（签名一律先查 references/api/）

| 主题 | 位置 |
|---|---|
| 入口点（ModInitializer/ClientModInitializer/DedicatedServerModInitializer）、ServerLifecycleEvents、ServerWorldEvents（26.x 改名 ServerLevelEvents）、Yarn↔mojmap 对照 | `references/api/entrypoints-and-lifecycle.md` |
| 注册（Registry/BuiltInRegistries/ResourceKey）、物品创建、1.21.2+ 的 setId 要求、创造栏 | `references/api/registries-and-items.md` |
| 事件机制、CommandRegistrationCallback + brigadier 命令、常用事件模块 | `references/api/events-and-commands.md` |
| mixin 配置 json、@Mixin/@Inject/@Redirect、注入失败排查 | `references/api/mixins.md` |

- **注册（物品/方块/事件/命令）全部放 `onInitialize()`**，不要在静态块/字段初始化里注册。
- 本工程是 **mojmap 名**：`BuiltInRegistries.ITEM`、`Item.Properties`、`CommandSourceStack`、`Commands.literal`；社区教程常见 Yarn 名（`Registries`、`Item.Settings`、`ServerCommandSource`、`CommandManager`）要翻译后使用，**禁止混用**。
- 1.21.2+ 注册物品必须 `Item.Properties().setId(itemKey)` + `Registry.register(BuiltInRegistries.ITEM, itemKey, item)`（`Identifier.fromNamespaceAndPath` 构造 id）；1.20.1 用 `new ResourceLocation(ns, path)` 老形式。

## 7. 构建 / 测试流程

1. `gradlew build`（Windows 用 `gradlew.bat build`）→ 产物 `build/libs/<name>-0.1.0.jar`。
2. 拷入客户端 `mods/` 目录或服务器 `mods/`，重启。
3. 本地测试：`gradlew runClient`（起测试客户端）或 `gradlew runServer`（起测试服务端，首次要 `run/` 下 eula.txt 同意、`online-mode=false` 可选）——两个任务由 loom 生成，开箱即用。
4. 观察日志：主类 onInitialize 里的 `LOGGER.info` 出现即加载成功；报错看 `run/logs/latest.log` 第一处堆栈。
5. 首次构建要下载 Gradle 发行版 + 依赖，5~15 分钟正常，设足够超时；Gradle 9.5.1 需要 JDK 17+ 跑 wrapper（toolchain 会按需下载 JDK）。

## 8. 常见坑

1. **loom 坐标用 SNAPSHOT**：官方示例钉 `1.17-SNAPSHOT`；模板钉 stable `1.17.19`。自己改版本时先查 https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml ，不要从记忆写。
2. **26.x 与 1.x 结构不同**：26.x 插件 id 是 `net.fabricmc.fabric-loom`（无 `-remap`）、依赖用 `implementation`（非 `modImplementation`）、**无 mappings 行**——把 1.x 的 build.gradle 直接搬到 26.x 会构建失败；反之 26.x 的搬回 1.x 也会失败。
3. **`~` 波浪线语义**：`~1.21.11` 是 `[1.21.11, 1.22)`，不含 26.x；写错区间（如 `>=1.21.11` 写成 `~1.21` 想表达补丁自由）会导致依赖解析不符预期。
4. **mojmap / yarn 混用**：教程示例多是 Yarn 名，mojmap 工程里直接抄会编译不过（`Registries`→`BuiltInRegistries`、`Item.Settings`→`Item.Properties`、`ServerCommandSource`→`CommandSourceStack`、`Identifier` 在 1.20.1 mojmap 是 `ResourceLocation`）。对照表见 `references/api/entrypoints-and-lifecycle.md` 第 5 节。
5. **mixin 注入失败**：先看 `run/logs/latest.log` 的 `mixin` 字样，加 `-Dmixin.debug.verbose=true -Dmixin.debug.countInjections=true` 看注入点匹配；新 loom 不生成 refmap，别按老教程等 refmap.json（详见 `references/api/mixins.md`）。
6. **`java` depends 低于目标版本**：loader 直接拒绝加载（不满足依赖），不是编译期问题——改 fabric.mod.json 的 `"java": ">=…"`。
7. **1.21.2+ 物品注册漏 `setId`**：报 `NullPointerException: Item id not set`（官方文档明示）。
8. **客户端逻辑混进 main 入口**：`onInitializeClient` 里引用 `Screen`/`GuiGraphics` 等客户端专用类，服务端加载主类时 ClassNotFound——模板里主类同时实现两个接口，加客户端逻辑后应拆独立 client 类（必要时开 splitEnvironmentSourceSets）。
9. **版本漂移**：fabric-api 逐日发版，表的钉选值数月后会过时；坐标集中在一处（模板 + lib/versions.js），改版本时三处对账：gradle.properties 的 `fabric_api_version`、fabric.mod.json 的 `minecraft` 区间、meta.fabricmc.net 的实际可用性。
10. **手写 fabric.mod.json 忘 `${version}` 展开**：`version` 恒为字面 `${version}`，loader 解析失败；确认 build.gradle 里有 `processResources { filesMatching('fabric.mod.json') { expand "version": version } }`。
