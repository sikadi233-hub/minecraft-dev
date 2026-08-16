# {{name}}

{{name}} — a Forge mod for Minecraft 1.7.10 (Forge {{forgeVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

**老线注意：Gradle 7.4.2 需要 JDK ≤18（建议 JDK 8 并设 JAVA_HOME）。**

1.7.10 时代无 runClient/runServer 任务；产物 `build/libs/{{name}}-0.1.0.jar` 直接拖入 `mods/` 启动测试（或配 IDE 的 setupDevWorkspace）。

## Wrapper

本模板自带 `gradle/wrapper/gradle-wrapper.properties`，钉 **Gradle {{gradleVersion}}**（distributionUrl 指向 `gradle-{{gradleVersion}}-bin.zip`）；`gradlew` / `gradlew.bat` / `gradle-wrapper.jar` 由脚手架从全局 `assets/templates/common/wrapper/` 复制（wrapper jar 时代无关，现代 jar 可启动老发行版）。common 的 properties 指向 8.14.3，仅作模板漏放时的兜底，本模板以自带 properties 为准。构建报错先核对 distributionUrl 与 JDK 配对（Gradle 7.4.2 只能跑 JDK ≤18，见 minecraft-java-build）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类（modid 属性时代）+ FMLInitializationEvent
- `src/main/resources/mcmod.info` — 1.7.10 时代元数据（无 mods.toml / pack.mcmeta）
- `build.gradle` — ForgeGradle 1.2 fork（坐标 `{{forgeGradle}}`，anatawa12 维护，官方 1.2 已不可用）
