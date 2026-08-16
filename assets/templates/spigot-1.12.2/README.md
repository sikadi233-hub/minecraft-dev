# {{name}}

{{name}} — a Spigot plugin for Minecraft 1.12.2 (spigot-api {{spigotApi}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

**老线注意：本模板钉 Gradle {{gradleVersion}}（最后支持在 Java 8 上运行的行），请装 JDK 8 并设 `JAVA_HOME` 再构建。**

产物 `build/libs/{{name}}-0.1.0.jar` 拷入服务端 `plugins/` 目录，服务端内执行 `reload`（或重启）加载。首次构建下载依赖较慢（spigot-api + 传递依赖，需联网）。

服务端 jar 来源：getbukkit.org（spigot-1.12.2 完整服务端）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — JavaPlugin 主类（onEnable/onDisable）
- `src/main/resources/plugin.yml` — 插件元数据（无 api-version，老线写法）
- `build.gradle` — 纯 java 插件 + spigot-api compileOnly（hub.spigotmc.org 双仓库 + mavenCentral 传递依赖）
- `gradle/wrapper/` — Gradle {{gradleVersion}} wrapper（distributionUrl 钉 {{gradleVersion}}）

## Notes

- API 签名与老线注意事项见 minecraft-spigot-legacy 技能（references/api/bukkit-1.12.2.md）。
- 本模板不含 runClient/runServer 任务（spigot 插件开发没有 FG runs 机制）；测试 = 拷 jar 进服 reload。
