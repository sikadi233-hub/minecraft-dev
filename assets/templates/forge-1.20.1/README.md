# {{name}}

{{name}} — a Forge mod for Minecraft 1.20.1 (Forge {{forgeVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

产物 `build/libs/{{name}}-0.1.0.jar` 拖入 `mods/` 启动测试；`gradlew runClient`/`runServer`/`runData` 可用。

## Wrapper

本模板自带 `gradle/wrapper/gradle-wrapper.properties`，钉 **Gradle {{gradleVersion}}**（distributionUrl 指向 `gradle-{{gradleVersion}}-bin.zip`，官方 MDK 钉 8.8）；`gradlew` / `gradlew.bat` / `gradle-wrapper.jar` 由脚手架从全局 `assets/templates/common/wrapper/` 复制（wrapper jar 时代无关）。common 的 properties 指向 8.14.3，仅作模板漏放时的兜底，本模板以自带 properties 为准。构建报错先核对 distributionUrl 与 JDK 配对（Gradle 8.8 需 JDK 17+，settings.gradle 的 foojay 可自动装 toolchain，见 minecraft-java-build）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + mod bus / game bus 注册点
- `src/main/resources/META-INF/mods.toml` — mods.toml（`${mod_id}` 等由 Gradle expand 替换）
- `src/main/resources/pack.mcmeta` — pack_format 15
- `build.gradle` — ForgeGradle 6（坐标 `{{forgeGradle}}`）+ official 映射 + Java 17 toolchain + reobfJar
- `settings.gradle` — foojay 0.7.0 自动装 JDK
