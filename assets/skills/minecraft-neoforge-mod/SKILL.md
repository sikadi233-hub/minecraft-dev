# NeoForge 模组开发（minecraft-neoforge-mod）

> 前置：同时加载 minecraft-java-build（构建/Gradle/JDK 问题先看它）。本技能覆盖 1.20.1（legacyforge 线）、1.21.x、26.2 三线。
> **铁律：API 签名一律 `read_file` 查 `references/api/`，禁止凭记忆写签名。** 参考里没有的，用 web 工具查官方文档（docs.neoforged.net / projects.neoforged.net），不要编。
> 核对日期：2026-08。

## 1. 定位

- NeoForge 是 Forge 的继任者（1.20.1 起分叉，自研加载器与 API；20.2.x 起用独立版本号）。本技能支持三线：
  - **1.20.1**：官方路线是 **legacyforge 插件 + Forge 47.1.3 坐标**（`net.neoforged.moddev.legacyforge` 2.0.91，NeoForge 自研 1.20.1 版本已 EOL，官方 MDK 现状即此形态）；元数据走老式 `mods.toml`（javafml）。
  - **1.21.x（默认主流线，1.21.11）**：`net.neoforged.moddev` 2.0.144 + NeoForge 21.11.45；元数据 `neoforge.mods.toml`（新形态）。
  - **26.2（新线，beta 状态）**：同 moddev 2.0.144 + NeoForge 26.2.0.59；2026-06 起为 beta 构建，官方已出 `26.2.0-stable` tag，生态仍在跟进（部分模组库滞后）。
- moddev（ModDevGradle）= 官方 Gradle 插件，内置 **NeoForm** 反编译管线（把混淆 Minecraft 反编译为官方映射的可用源码），`neoFormVersion` 可切 vanilla 模式。

## 2. 版本对应

| 线 | MC | Gradle 插件（build.gradle plugins） | NeoForge/Forge 坐标（neo_version） | Gradle wrapper | JDK |
|---|---|---|---|---|---|
| 1.20 | 1.20.1 | `net.neoforged.moddev.legacyforge` 2.0.91 | 1.20.1-47.1.3（Forge 47.1.3） | 8.14.5 | 17 |
| 1.21 | 1.21.11 | `net.neoforged.moddev` 2.0.144 | 21.11.45 | 9.2.1 | 21 |
| 26 | 26.2 | `net.neoforged.moddev` 2.0.144 | 26.2.0.59 | 9.2.1 | 25 |

- 新项目一律 `mc_scaffold`（platform=neoforge，可选版本）生成，坐标已按上表钉好；不要手动拼版本。
- 版本核对源：https://projects.neoforged.net （NeoForge 各版本列表）、官方 MDK 仓库（github.com/NeoForgeMDKs）。moddev README 声明**仅支持 NeoForge ≥21.0.x**——1.20.1 必须用 legacyforge 插件。
- 26.2 线模板无 Parchment 块（官方 MDK 现状）；1.21 线有（Parchment = 社区映射，补方法名/参数名，需接受授权，构建时自动获取）。

## 3. 项目骨架

`mc_scaffold platform=neoforge` 生成的布局（1.21 线）：

```
build.gradle / settings.gradle / gradle.properties / gradle/wrapper/...
src/main/java/<pkg>/<MainClass>.java        # @Mod 主类
src/main/resources/META-INF/neoforge.mods.toml
src/generated/resources/                     # runData 输出（源集已挂载）
```

- `build.gradle` 核心：`neoForge { version = project.neo_version; runs { client / server / data }; mods { "<mod_id>" { sourceSet sourceSets.main } } }`；`neo_version` 来自 `gradle.properties`，与 `minecraft_version` 必须是同一 MC 版本。
- `processResources { expand project.properties }` 把 neoforge.mods.toml 里的 `${mod_id}` 等占位符展开成实际值（Gradle 侧 `${}` 展开；脚手架侧 `{{}}` 渲染在前，两者不冲突）。
- 1.20.1 差异：插件 `net.neoforged.moddev.legacyforge`，`legacyForge { version = "1.20.1-47.1.3" }`，元数据文件是 `META-INF/mods.toml`（老形态），有 `pack.mcmeta`。
- 26.2 差异：仅 Java toolchain 25、无 Parchment 块，其余同 1.21。

## 4. neoforge.mods.toml 必填字段

21.x / 26.x 形态（无 `modLoader`/`loaderVersion`，走默认 javafml）：

```toml
license="All Rights Reserved"   # 必填（可改 MIT 等开源许可证）

[[mods]]
modId="my-plugin"               # 必填；^[a-z][a-z0-9_]{1,63}$
version="${mod_version}"        # 建议必有（gradle.properties 展开）
displayName="${mod_name}"       # 建议必有
authors="${mod_authors}"        # 建议必有
description="${mod_description}"

[[dependencies.my-plugin]]      # [[dependencies.<modId>]]
modId="neoforge"                # 必填依赖
versionRange="${neo_version_range}"
mandatory=true

[[dependencies.my-plugin]]
modId="minecraft"
versionRange="${minecraft_version_range}"
mandatory=true
```

- 1.20.1 时代（`mods.toml`）：另有必填 `modLoader="javafml"`、`loaderVersion`（如 `"[47,)"` 对应 Forge 47 加载器）；依赖段 `modId="forge"` + `minecraft`。
- 陷阱：modId 非法字符/大写（`^[a-z][a-z0-9_]{1,63}$`）、dependencies 表头写成 `[[dependencies]]`（必须带 `.<modId>`）都会导致加载失败。
- 与 `@Mod` 注解的 modid 必须一致——**gradle.properties 的 `mod_id` 和 `@Mod(MyPlugin.MODID)` 两处都要改**（脚手架生成时已一致，改模组名时注意两处）。

## 5. API 要点（签名一律查 references/api/）

- **入口与事件总线**：`@Mod` 类 + 构造器注入 mod bus（`IEventBus`）；game bus = `NeoForge.EVENT_BUS`；`@SubscribeEvent` / `@EventBusSubscriber(bus = Bus.MOD|GAME)` → `references/api/mod-bus-events.md`
- **注册**：`DeferredRegister.create(Registries.ITEM, MODID)` + `register(modEventBus)` + `DeferredHolder` → `references/api/deferred-register.md`（1.20.1 线返回 `RegistryObject`）
- **数据生成**：`GatherDataEvent`（mod bus）+ `DataGenerator.addProvider` + runData → `src/generated/resources` → `references/api/data-generation.md`
- 客户端/服务端隔离：`@EventBusSubscriber(dist = Dist.CLIENT)` / `@OnlyIn(Dist.CLIENT)`（见 mod-bus-events.md 第 4 节）。

## 6. 构建 / 测试流程

1. `gradlew build`（Windows: `cmd /c "gradlew.bat build"`）→ 产物 `build/libs/<name>-0.1.0.jar`。
2. 首次构建下载 Gradle + JDK toolchain + 依赖，**NeoForm 反编译可达一小时**（R9）——设足够超时，别以为卡死。
3. `gradlew runClient` 起开发客户端（带模组）；`gradlew runServer` 起开发服务器（首次会生成 `run/eula.txt`，改为 `eula=true`；服务器默认 `online-mode=true`，局域网/单人调试可改 `online-mode=false`）。
4. `gradlew runData` 生成数据文件（见 data-generation.md）。
5. 发布：`build/libs/<name>-0.1.0.jar` 拖入客户端 `mods/` 目录（客户端模组直接进 mods/；服务端模组进服务器 mods/）。

## 7. 常见坑

1. **moddev 与 NeoForge 版本配对**：moddev 2.x 仅支持 NeoForge ≥21.0.x；1.20.1 用 `legacyforge` 插件（`net.neoforged.moddev.legacyforge`），插件选错 → 构建或加载直接失败。
2. **26.x 生态未齐**：26.2 是 2026-06 起的新 beta 线，部分模组库/文档滞后；先用 1.21.11 线做生产开发。
3. **`minecraft_version` 与 `neo_version` 必须对应同一 MC**（如 `1.21.11` ↔ `21.11.45`），改版本只动一处 → 构建产物加载即崩。
4. **modid 三处一致性**：`gradle.properties` 的 `mod_id`、`@Mod(...)` 注解、`neoforge.mods.toml` 的 `modId`（后两者由脚手架渲染一致；手改注意同步）。
5. **`${}` 与 `{{}}` 双展开**：toml 里 Gradle 占位符是 `${mod_id}`（build 时展开），脚手架占位符是 `{{name}}`（生成时展开）；不要把 `${...}` 写成 `{{...}}`（脚手架会报未定义占位符），反之亦然。
6. **生成文件被覆盖**：`src/generated/resources` 是 runData 的输出，改 provider 而不是改输出文件。
7. **runServer 首次失败**：先查 `run/eula.txt` 是否 `eula=true`；`online-mode` 调试期可关。
8. **首次构建超时**：NeoForm 反编译 + Parchment 下载可达一小时，日志无输出不代表卡死。
9. **1.20.1 线是老形态**：`mods.toml`（非 neoforge.mods.toml）、`modLoader="javafml"`、依赖 `forge` 段——照 3.8/4 节 1.20.1 差异处理，别套 21.x 形态。
