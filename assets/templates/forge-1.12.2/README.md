# {{name}}

{{name}} — a Forge mod for Minecraft 1.12.2 (Forge {{forgeVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

**老线注意：Gradle 4.9 只能跑在 JDK 8~10 上（建议 JDK 8 并设 JAVA_HOME）。**

产物 `build/libs/{{name}}-0.1.0.jar`（reobf 后）拖入 `mods/` 启动测试；`gradlew runClient`/`runServer` 可用。

## Wrapper

本模板自带 `gradle/wrapper/gradle-wrapper.properties`，钉 **Gradle {{gradleVersion}}**（distributionUrl 指向 `gradle-{{gradleVersion}}-bin.zip`）；`gradlew` / `gradlew.bat` / `gradle-wrapper.jar` 由脚手架从全局 `assets/templates/common/wrapper/` 复制（wrapper jar 时代无关，现代 jar 可启动老发行版）。common 的 properties 指向 8.14.3，仅作模板漏放时的兜底，本模板以自带 properties 为准。构建报错先核对 distributionUrl 与 JDK 配对（见 minecraft-java-build）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + FML 三阶段 EventHandler
- `src/main/resources/mcmod.info` — 1.12.2 时代元数据（JSON 数组）
- `src/main/resources/pack.mcmeta` — pack_format 3
- `build.gradle` — ForgeGradle 3 + MCP snapshot 映射 + reobfJar
