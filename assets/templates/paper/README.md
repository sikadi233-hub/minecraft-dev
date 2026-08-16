# {{name}}

{{name}} — a Paper server plugin for Minecraft {{mcVersion}}, scaffolded by minecraft-dev.

## Build

```sh
# Windows
gradlew.bat build

# Linux / macOS
./gradlew build
```

The first build downloads Gradle (if missing), a JDK {{javaVersion}} toolchain, and dependencies — allow 5-15 minutes.

The deployable jar is `build/libs/{{name}}-0.1.0.jar`.

## Install

Copy `build/libs/{{name}}-0.1.0.jar` into your Paper server's `plugins/` directory and restart the server.

## Layout

- `src/main/java/{{pkgPath}}/{{MainClass}}.java` — plugin main class (onEnable/onDisable)
- `src/main/resources/plugin.yml` — plugin metadata (`name`, `main`, `api-version`)
- `build.gradle.kts` — paper-api (compileOnly) + shadow fat-jar build
