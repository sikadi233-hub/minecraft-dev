# {{name}}

{{name}} — a Spigot plugin for Minecraft 1.7.10 (spigot-api {{spigotApi}} 规范名，vendored jar 提供), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

**老线注意：本模板钉 Gradle {{gradleVersion}}（最后支持在 Java 8 上运行的行），请装 JDK 8 并设 `JAVA_HOME` 再构建。若你的 1.7.10 服跑 Java 7，需自行把 build.gradle 的 source/target 改成 '1.7'。**

构建前必须按 `libs/README.txt` 放置 `libs/spigot-1.7.10-R0.1-SNAPSHOT.jar`（1.7.10 的 API 无公共 maven，见该文件）。缺文件时构建直接失败，报错指向该文件。

产物 `build/libs/{{name}}-0.1.0.jar` 拷入服务端 `plugins/` 目录，服务端内执行 `reload`（或重启）加载。

服务端 jar 来源：getbukkit.org（spigot-1.7.10 完整服务端）。

## 混合服（Cauldron / KCauldron / Thermos）

- 1.7.10 时代可用 KCauldron / Thermos（Forge 模组 + Bukkit 插件同一服务端）。
- 插件照常进 `plugins/` 目录，用法与纯 Spigot 一致；但混合服事件侧漏、
  NMS 差异等已知问题见 minecraft-spigot-legacy 技能 §1/§7。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — JavaPlugin 主类（onEnable/onDisable）
- `src/main/resources/plugin.yml` — 插件元数据（无 api-version，老线写法）
- `build.gradle` — 纯 java 插件 + vendored spigot-api（compileOnly files）
- `libs/README.txt` — 1.7.10 API jar 放置说明（下载来源）
- `gradle/wrapper/` — Gradle {{gradleVersion}} wrapper（distributionUrl 钉 {{gradleVersion}}）

## Notes

- API 签名与老线注意事项见 minecraft-spigot-legacy 技能（references/api/bukkit-1.7.10.md）。
- 本模板不含 runClient/runServer 任务（spigot 插件开发没有 FG runs 机制）；测试 = 拷 jar 进服 reload。
