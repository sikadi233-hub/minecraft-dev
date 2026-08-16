# {{name}}

{{name}} — a NeoForge mod for Minecraft {{mcVersion}} (NeoForge {{neoVersion}}), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

产物 `build/libs/{{name}}-0.1.0.jar` 拖入 `mods/` 启动测试；`gradlew runClient`/`runServer`/`runData` 可用（runServer 需改 eula.txt 与 online-mode=false）。

## Notes

- 首次构建 NeoForm 反编译可达一小时（R9），请设足够超时。
- 无 pack.mcmeta（官方 MDK 现状）。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — `@Mod` 主类 + mod bus / game bus 注册点
- `src/main/resources/META-INF/neoforge.mods.toml` — 21.x 形态（无 modLoader/loaderVersion，license 必填）
- `build.gradle` — moddev {{moddevVersion}} + Parchment + Java 21 toolchain
