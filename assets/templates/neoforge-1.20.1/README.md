# {{name}}

{{name}} — a NeoForge mod for Minecraft 1.20.1 (legacyforge route, Forge {{forgeVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

产物 `build/libs/{{name}}-0.1.0.jar` 拖入 `mods/` 启动测试；`gradlew runClient`/`runServer`/`runData` 可用。

## Notes

- NeoForge 20.x 官方 1.20.1 路线 = `net.neoforged.moddev.legacyforge` 插件对 **Forge {{forgeVersion}}** 坐标开发（官方 MDK `1.20.1-legacy` 分支现状）；mods.toml 走 javafml 老形态。
- moddev 插件声明仅支持 NeoForge ≥21.0.x，1.20.1 必须用 legacyforge 插件（R6）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + 事件总线注册骨架
- `src/main/resources/META-INF/mods.toml` — javafml 形态（modLoader/loaderVersion 必填）
- `src/main/resources/pack.mcmeta` — pack_format 15
- `build.gradle` — legacyforge {{moddevVersion}} + Parchment + Java 17 toolchain
