# {{name}}

{{name}} — a NeoForge mod for Minecraft {{mcVersion}} (NeoForge {{neoVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

产物 `build/libs/{{name}}-0.1.0.jar` 拖入 `mods/` 启动测试；`gradlew runClient`/`runServer`/`runData` 可用。

## Notes

- 26.2 属新线（2026-06 起 beta 构建，官方已出 stable tag），生态跟进中，第三方模组库可能滞后（R5）。
- 首次构建 NeoForm 反编译可达一小时（R9）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + mod bus / game bus 注册点
- `src/main/resources/META-INF/neoforge.mods.toml` — 26.x 形态（无 modLoader/loaderVersion，license 必填）
- `build.gradle` — moddev {{moddevVersion}} + Java 25 toolchain，无映射配置块（官方 MDK 现状）
