# Minecraft Java 构建知识（minecraft-java-build）

> 前置：任何 Minecraft 项目的构建、Gradle、Java 版本问题，先加载本技能，再配合对应平台技能（minecraft-paper-plugin / minecraft-fabric-mod / minecraft-forge-mod / minecraft-neoforge-mod）使用。
> 核对日期：2026-08。版本信息随生态更新，遇到表外版本先查官方源。

## 0. 总原则

1. 构建问题先查本文件的时代表，再动手；版本/JDK 配对错误是 MC 构建第一大坑。
2. 优先使用项目自带的 gradle wrapper（`gradlew` / `gradlew.bat`），不要假设机器上有 gradle。
3. 现代线（MC 1.18.2+）用 foojay toolchain 自动下载 JDK；老线（1.7.10/1.12.2）必须手动装 Java 8 并设 `JAVA_HOME`。

## 1. 版本时代表（MC 1.7.10 ~ 26.x）

| MC 版本 | Java 编译级别 | Gradle 运行版本 | 服务端插件 | 模组 |
|---|---|---|---|---|
| 1.7.10 | 8 | 官方历史 2.x~3.x；v0.2 模板现役 7.4.2（anatawa12 ForgeGradle fork） | Spigot/Bukkit；Cauldron/KCauldron（Forge+Bukkit 混合服） | Forge（FG1.2 fork + MCP 映射）；无 Fabric/NeoForge |
| 1.12.2 | 8 | 4.9（ForgeGradle 3/4 时代） | Spigot/Bukkit；Paper（1.8.8 起） | Forge（FG3/4 + MCP） |
| 1.16.5 | 8~16 | 7.3.3（MDK 钉选，v0.2 模板） | Paper/Spigot | Forge（FG5）、Fabric |
| 1.18.2 ~ 1.20.4 | 17 | 7.6+ | Paper/Spigot | Forge（1.20.1 止）、Fabric、NeoForge（1.20.1 起） |
| 1.20.5 ~ 1.21.x | 21 | 8.5+ | Paper/Spigot（稳定主流线） | Fabric、NeoForge |
| 26.x（当前 26.2 "Chaos Cubed"，2026-06 发布） | 25 | 8.14+（v0.2 模组模板钉 9.2.1/9.5.1） | Paper 已支持 | Fabric 已支持；NeoForge 26.2 为 beta |

补充：
- 1.20.5 是 Java 21 分界点（官方把运行要求从 17 升到 21）；26.x 要求 Java 25。
- 版本号从 26.x 起改为「年.次.修订」格式。
- Gradle 与 JDK 配对：Java 25 需 Gradle ≥ 8.14；Java 21 需 ≥ 8.5；Java 17 需 ≥ 7.3。老线（Gradle 2~4.x）只能跑在 Java 8 上，用现代 JDK 启动会直接失败。
- 生态普遍滞后原版：1.21.x 仍是 2026 年大多数服务器的稳定选择，26.x 生态尚在跟进。

## 2. Gradle wrapper

- wrapper 由四个文件组成：`gradlew`（shell）、`gradlew.bat`（Windows）、`gradle/wrapper/gradle-wrapper.jar`、`gradle/wrapper/gradle-wrapper.properties`。缺任何一个都无法构建。
- `gradle-wrapper.properties` 的 `distributionUrl` 决定下载哪个 Gradle 发行版（services.gradle.org 有全部旧版本）。
- 已有 Gradle 时用 `gradle wrapper --gradle-version X` 重新生成/升级 wrapper。
- Windows 下调用 `.bat` 必须经 cmd：`cmd /c "gradlew.bat build"`；带空格路径要正确引号。
- wrapper jar 本身时代无关；时代差异全部体现在 `distributionUrl` 与 build 脚本里。

## 3. JDK 策略

### 现代线（1.18.2+）：foojay toolchain 自动下载

`settings.gradle.kts` 里加：

```kotlin
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.9.0"
}
```

配合 `build.gradle.kts` 的 toolchain 声明，缺 JDK 时 Gradle 自动下载（首次需联网）。`JAVA_HOME` 只决定运行 Gradle 的 JVM，toolchain 决定编译级别——两者可不同。

### 老线（1.7.10 / 1.12.2）：手动装 Java 8

- 必须安装 JDK 8，并把 `JAVA_HOME` 指向它后运行老 wrapper；现代 JDK 跑不动 Gradle 2~4.x。
- 多 JDK 共存：按项目切换 `JAVA_HOME`（或使用 JDK 管理工具）。给用户指引时先检查 `java -version` 和 `JAVA_HOME`。
- 编译级别用 `sourceCompatibility`/`targetCompatibility` 直接写 1.8（老 Gradle 没有 toolchain 概念）。

## 4. 依赖仓库清单

| 用途 | 仓库 URL |
|---|---|
| Paper/Paper 家族 | `https://repo.papermc.io/repository/maven-public/` |
| Fabric | `https://maven.fabricmc.net/` |
| NeoForge | `https://maven.neoforged.net/releases/` |
| Spigot 老线 API | `https://hub.spigotmc.org/nexus/content/repositories/snapshots/`（`org.spigotmc:spigot-api:1.7.10-R0.1-SNAPSHOT` 式坐标） |
| 通用 | `https://maven.minecraftforge.net/`（老 Forge）、`mavenCentral()`、`gradlePluginPortal()` |
| CurseForge 模组 jar | `https://cursemaven.com`（坐标 `curse.maven:<slug>-<projectId>:<fileId>`） |
| Modrinth 模组 jar | `https://api.modrinth.com/maven`（坐标 `maven.modrinth:<slug>:<version>`） |

## 5. 常用任务

| 任务 | 说明 |
|---|---|
| `gradlew build` | 构建产物 jar（插件在 `build/libs/`，模组同名目录） |
| `gradlew clean build` | 全量重建 |
| `gradlew runServer` / `runClient` | 模组开发环境直接启动测试客户端/服务端（loom/moddev/MDK 提供） |
| `gradlew runData` | 数据生成（现代 Forge/NeoForge） |
| `gradlew tasks` | 列出可用任务 |
| `gradlew build --offline` | 离线构建（依赖已缓存时） |
| `gradlew build -x test` | 跳过测试 |
| `gradlew --stop` | 停止 daemon |

## 6. 常见坑

1. **Gradle/JDK 配对错误**（最常见）：报 `Unsupported class file major version` 或 daemon 启动失败 → 查第 1 节表格换 JDK/wrapper 版本。
2. **首次构建慢**：下载 Gradle 发行版 + JDK toolchain + 依赖，5~15 分钟正常，不是卡死；给用户设足够超时。
3. **daemon 内存不足**：`gradle.properties` 里 `org.gradle.jvmargs=-Xmx2G`。
4. **Windows 路径带空格**：`.bat` 必须经 cmd 且整条命令正确引号。
5. **依赖找不到**：仓库没配齐（第 4 节逐个核对）；SNAPSHOT 依赖旧坐标可能已下线，改用官方模板的坐标。
6. **`JAVA_HOME` 指向错误 JDK**：多 JDK 机器上最常见，`java -version` 与编译级别对不上时报错。
7. **代理/镜像**：国内网络下载慢可用 Gradle 镜像（如阿里云 mirror）替换 repository URL，但注意镜像不全。

## 7. Multi-loader 项目（进阶）

同时支持多 loader（Fabric+Forge/NeoForge）的常见结构：`common` 子项目放共享代码，各 loader 子项目依赖 common 并各自提供入口。1.20.1+ 可用 Architectury 或手写多模块 Gradle 结构；老版本（1.12.2）一般按 loader 拆独立项目。需要时再深入，不默认使用。
