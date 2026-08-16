# {{name}}

{{name}} — a Fabric mod for Minecraft {{mcVersion}}, scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

The first build downloads Gradle, a JDK {{javaVersion}} toolchain, and dependencies — allow 5-15 minutes.

The deployable jar is `build/libs/{{name}}-0.1.0.jar`.

## Install

Copy `build/libs/{{name}}-0.1.0.jar` into your Fabric server's `mods/` directory (or your client's) and restart.

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — mod entry point (ModInitializer.onInitialize + ClientModInitializer.onInitializeClient)
- `src/main/resources/fabric.mod.json` — mod metadata (`id`, `entrypoints`, `depends`)
- `build.gradle` — fabric-loom ({{loomVersion}}) + fabric-loader ({{loaderVersion}}) + Fabric API build
