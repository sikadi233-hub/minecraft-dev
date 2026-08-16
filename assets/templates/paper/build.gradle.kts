plugins {
    `java-library`
    // Fat jar: bundles the plugin's runtime dependencies into one deployable jar.
    id("com.gradleup.shadow") version "8.3.6"
}

group = "{{pkg}}"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // The Paper server provides this API at runtime, so it must not be bundled.
    compileOnly("io.papermc.paper:paper-api:{{paperApiVersion}}")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of({{javaVersion}})
    }
}

tasks {
    shadowJar {
        archiveBaseName.set("{{name}}")
        archiveClassifier.set("")
    }
    assemble {
        dependsOn(shadowJar)
    }
    processResources {
        // Keep plugin.yml in sync with the build version.
        filesMatching("plugin.yml") {
            expand("version" to version)
        }
    }
}
