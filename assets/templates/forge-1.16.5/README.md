# {{name}}

{{name}} — a Forge mod for Minecraft 1.16.5 (Forge {{forgeVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

**老线注意：Gradle 7.3.3 需要 JDK ≤18（建议 JDK 8 并设 JAVA_HOME）；本模板无 settings.gradle（MDK 时代无 foojay 自动装 JDK）。**

产物 `build/libs/{{name}}-0.1.0.jar` 拖入 `mods/` 启动测试；`gradlew runClient`/`runServer`/`runData` 可用。

## Wrapper

本模板自带 `gradle/wrapper/gradle-wrapper.properties`，钉 **Gradle {{gradleVersion}}**（distributionUrl 指向 `gradle-{{gradleVersion}}-bin.zip`，官方 MDK 钉 7.3.3 而非 7.5）；`gradlew` / `gradlew.bat` / `gradle-wrapper.jar` 由脚手架从全局 `assets/templates/common/wrapper/` 复制（wrapper jar 时代无关，现代 jar 可启动老发行版）。common 的 properties 指向 8.14.3，仅作模板漏放时的兜底，本模板以自带 properties 为准。构建报错先核对 distributionUrl 与 JDK 配对（Gradle 7.3.3 只能跑 JDK ≤18，见 minecraft-java-build）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + mod bus / game bus 注册点
- `src/main/resources/META-INF/mods.toml` — mods.toml 元数据（`${file.jarVersion}` 依赖 manifest Implementation-Version）
- `src/main/resources/pack.mcmeta` — pack_format 6
- `build.gradle` — ForgeGradle 5 + official 映射 + Java 8 toolchain + reobfJar
