# {{name}}

{{name}} — a Fabric mod for Minecraft {{mcVersion}} (26.x line), scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

The deployable jar is `build/libs/{{name}}-0.1.0.jar`.

## Install

Copy `build/libs/{{name}}-0.1.0.jar` into your Fabric server's `mods/` directory (or your client's) and restart.

## Notes

- 26.x 线用原生 fabric-loom（无 -remap）与 `implementation` 依赖配置；loom 默认官方映射，无独立映射行。
- 26.x 生态仍在跟进中（2026-06 起的新线），第三方模组库可能滞后。

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — mod entry point (ModInitializer.onInitialize + ClientModInitializer.onInitializeClient)
- `src/main/resources/fabric.mod.json` — mod metadata (`id`, `entrypoints`, `depends`)
