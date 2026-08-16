import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scaffoldProject } from '../lib/scaffold.js'

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), 'minecraft-dev-test-'))
}

/**
 * v0.2 platform smoke helper: scaffold a project named my-plugin and run the
 * assertions common to every platform (main class location/package, file
 * count, wrapper four-piece set, real jar, win32 build command).
 */
async function scaffoldPlatform(platform, minecraftVersion) {
  const target = await makeTempDir()
  const result = await scaffoldProject({
    platform,
    targetDir: path.join(target, 'my-plugin'),
    name: 'my-plugin',
    packageName: 'com.example.myplugin',
    minecraftVersion,
  })

  assert.equal(result.platform, platform)
  assert.equal(result.minecraftVersion, minecraftVersion)
  assert.equal(result.wrapperReady, true)
  assert.ok(result.filesCreated.length >= 7, `filesCreated=${result.filesCreated.length}`)
  assert.equal(result.buildCommand, 'gradlew.bat build')

  // Main class lands on the rendered package path with the right package line.
  const mainPath = 'src/main/java/com/example/myplugin/MyPlugin.java'
  assert.ok(result.filesCreated.includes(mainPath), `missing ${mainPath}`)
  const main = await readFile(path.join(result.projectDir, mainPath), 'utf8')
  assert.match(main, /package com\.example\.myplugin;/)

  // Wrapper four-piece set is complete and the jar is a real zip.
  for (const rel of ['gradlew', 'gradlew.bat']) {
    assert.ok((await stat(path.join(result.projectDir, rel))).isFile(), `missing ${rel}`)
  }
  const wrapperDir = path.join(result.projectDir, 'gradle', 'wrapper')
  const entries = await readdir(wrapperDir)
  assert.deepEqual(entries.sort(), ['gradle-wrapper.jar', 'gradle-wrapper.properties'])
  const jarInfo = await stat(path.join(wrapperDir, 'gradle-wrapper.jar'))
  assert.ok(jarInfo.size > 10000)

  const read = rel => readFile(path.join(result.projectDir, rel), 'utf8')
  return { result, target, read, main }
}

test('scaffoldProject writes a complete Paper project', async () => {
  const target = await makeTempDir()
  try {
    const result = await scaffoldProject({
      platform: 'paper',
      targetDir: path.join(target, 'my-plugin'),
      name: 'my-plugin',
      packageName: 'com.example.myplugin',
      minecraftVersion: '1.21.8',
    })
    assert.equal(result.platform, 'paper')
    assert.equal(result.minecraftVersion, '1.21.8')
    assert.equal(result.wrapperReady, true)
    assert.ok(result.filesCreated.length >= 9)

    // Main class lands on the rendered package path with the right contents.
    const main = await readFile(path.join(result.projectDir, 'src/main/java/com/example/myplugin/MyPlugin.java'), 'utf8')
    assert.match(main, /package com\.example\.myplugin;/)
    assert.match(main, /public final class MyPlugin extends JavaPlugin/)

    // plugin.yml has the rendered main class and api-version.
    const pluginYml = await readFile(path.join(result.projectDir, 'src/main/resources/plugin.yml'), 'utf8')
    assert.match(pluginYml, /name: my-plugin/)
    assert.match(pluginYml, /main: com\.example\.myplugin\.MyPlugin/)
    assert.match(pluginYml, /api-version: "1\.21"/)

    // build.gradle.kts carries the paper-api dependency and Java level.
    const build = await readFile(path.join(result.projectDir, 'build.gradle.kts'), 'utf8')
    assert.match(build, /paper-api:1\.21\.8-R0\.1-SNAPSHOT/)
    assert.match(build, /JavaLanguageVersion\.of\(21\)/)

    // Wrapper four files are present and the jar is a real zip.
    const wrapperDir = path.join(result.projectDir, 'gradle', 'wrapper')
    const entries = await readdir(wrapperDir)
    assert.deepEqual(entries.sort(), ['gradle-wrapper.jar', 'gradle-wrapper.properties'])
    const jarInfo = await stat(path.join(wrapperDir, 'gradle-wrapper.jar'))
    assert.ok(jarInfo.size > 10000)
    const props = await readFile(path.join(wrapperDir, 'gradle-wrapper.properties'), 'utf8')
    assert.match(props, /gradle-8\.14\.3-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffoldProject derives Java 25 for the 26.x line', async () => {
  const target = await makeTempDir()
  try {
    const result = await scaffoldProject({
      platform: 'paper',
      targetDir: path.join(target, 'x'),
      name: 'x',
      packageName: 'a.b',
      minecraftVersion: '26.2',
    })
    const build = await readFile(path.join(result.projectDir, 'build.gradle.kts'), 'utf8')
    assert.match(build, /JavaLanguageVersion\.of\(25\)/)
    assert.match(build, /paper-api:26\.2\.build\.\+/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffoldProject rejects a non-empty target and leaves it untouched', async () => {
  const target = await makeTempDir()
  const projectDir = path.join(target, 'p')
  try {
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'existing.txt'), 'x')

    await assert.rejects(
      scaffoldProject({
        platform: 'paper',
        targetDir: projectDir,
        name: 'p',
        packageName: 'a.b',
        minecraftVersion: '1.21.8',
      }),
      /not empty/,
    )
    // The pre-existing file survives the rejected call.
    const content = await readFile(path.join(projectDir, 'existing.txt'), 'utf8')
    assert.equal(content, 'x')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffoldProject cleans up when the signal is already aborted', async () => {
  const target = await makeTempDir()
  const projectDir = path.join(target, 'cancelled')
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      scaffoldProject({
        platform: 'paper',
        targetDir: projectDir,
        name: 'cancelled',
        packageName: 'a.b',
        minecraftVersion: '1.21.8',
        signal: controller.signal,
      }),
      /cancelled/,
    )
    await assert.rejects(stat(projectDir), /ENOENT/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// v0.2 platform smoke tests: fabric / forge (four eras) / neoforge.
// ---------------------------------------------------------------------------

test('scaffold fabric 1.21.11 pins loom/loader/fabric-api coordinates', async () => {
  const { result, target, read } = await scaffoldPlatform('fabric', '1.21.11')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.fabricmc\.fabric-loom-remap' version "1\.17\.19"/)
    assert.match(build, /loom\.officialMojangMappings\(\)/)
    assert.match(build, /modImplementation "net\.fabricmc:fabric-loader:0\.19\.3"/)
    assert.match(build, /modImplementation "net\.fabricmc\.fabric-api:fabric-api:0\.141\.6\+1\.21\.11"/)
    assert.match(build, /options\.release = 21/)

    const modJson = await read('src/main/resources/fabric.mod.json')
    assert.match(modJson, /"id": "my-plugin"/)
    assert.match(modJson, /"main": \["com\.example\.myplugin\.MyPlugin"\]/)
    assert.match(modJson, /"fabricloader": ">=0\.19\.3"/)
    assert.match(modJson, /"minecraft": "~1\.21\.11"/)
    assert.match(modJson, /"java": ">=21"/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-9\.5\.1-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold fabric 26.2 uses the native loom plugin without remap or mappings', async () => {
  const { target, read } = await scaffoldPlatform('fabric', '26.2')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.fabricmc\.fabric-loom' version "1\.17\.19"/)
    assert.doesNotMatch(build, /fabric-loom-remap/)
    assert.doesNotMatch(build, /^\s*mappings\b/m)
    assert.doesNotMatch(build, /modImplementation/)
    assert.match(build, /implementation "net\.fabricmc:fabric-loader:0\.19\.3"/)
    assert.match(build, /implementation "net\.fabricmc\.fabric-api:fabric-api:0\.157\.0\+26\.2"/)
    assert.match(build, /options\.release = 25/)

    const modJson = await read('src/main/resources/fabric.mod.json')
    assert.match(modJson, /"java": ">=25"/)
    assert.match(modJson, /"minecraft": "~26\.2"/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-9\.5\.1-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold forge 1.7.10 uses the anatawa12 fork and mcmod.info metadata', async () => {
  const { result, target, read } = await scaffoldPlatform('forge', '1.7.10')
  try {
    const build = await read('build.gradle')
    assert.match(build, /com\.anatawa12\.forge:ForgeGradle:1\.2-1\.1\.\+/)
    assert.match(build, /apply plugin: 'forge'/)
    assert.match(build, /"1\.7\.10-10\.13\.4\.1614-1\.7\.10"/)
    assert.match(build, /sourceCompatibility = '1\.8'/)

    const mcmod = await read('src/main/resources/mcmod.info')
    assert.match(mcmod, /"modid": "my-plugin"/)
    assert.ok(result.filesCreated.some(rel => rel.endsWith('mcmod.info')))
    assert.ok(!result.filesCreated.some(rel => rel.endsWith('mods.toml')), '1.7.10 must not have mods.toml')

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-7\.4\.2-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold forge 1.12.2 pins FG3 with the MCP snapshot mappings', async () => {
  const { result, target, read } = await scaffoldPlatform('forge', '1.12.2')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.minecraftforge\.gradle:ForgeGradle:3\.0\.197/)
    assert.match(build, /mappings channel: 'snapshot', version: '20171003-1\.12'/)
    assert.match(build, /'net\.minecraftforge:forge:1\.12\.2-14\.23\.5\.2860'/)
    assert.match(build, /finalizedBy\('reobfJar'\)/)

    assert.ok(result.filesCreated.includes('src/main/resources/pack.mcmeta'))
    const pack = await read('src/main/resources/pack.mcmeta')
    assert.match(pack, /"pack_format": 3/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-4\.9-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold forge 1.16.5 pins FG5 official mappings and mods.toml', async () => {
  const { target, read } = await scaffoldPlatform('forge', '1.16.5')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.minecraftforge\.gradle:ForgeGradle:5\.1\.77/)
    assert.match(build, /mappings channel: 'official', version: '1\.16\.5'/)
    assert.match(build, /'net\.minecraftforge:forge:1\.16\.5-36\.2\.39'/)
    assert.match(build, /JavaLanguageVersion\.of\(8\)/)

    const modsToml = await read('src/main/resources/META-INF/mods.toml')
    assert.match(modsToml, /loaderVersion="\[36,\)"/)
    assert.match(modsToml, /modId="my-plugin"/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-7\.3\.3-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold forge 1.20.1 pins FG6 with mods.toml placeholder expansion', async () => {
  const { target, read } = await scaffoldPlatform('forge', '1.20.1')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.minecraftforge\.gradle' version '6\.0\.54'/)
    assert.match(build, /JavaLanguageVersion\.of\(17\)/)

    const modsToml = await read('src/main/resources/META-INF/mods.toml')
    assert.match(modsToml, /\$\{mod_id\}/)
    assert.match(modsToml, /\$\{forge_version_range\}/)

    const settings = await read('settings.gradle')
    assert.match(settings, /foojay-resolver-convention/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-8\.8-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold neoforge 1.20.1 uses the legacyforge plugin against Forge 47.1.3', async () => {
  const { target, read } = await scaffoldPlatform('neoforge', '1.20.1')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.neoforged\.moddev\.legacyforge' version '2\.0\.91'/)
    assert.match(build, /version = "1\.20\.1-47\.1\.3"/)
    assert.match(build, /JavaLanguageVersion\.of\(17\)/)

    const modsToml = await read('src/main/resources/META-INF/mods.toml')
    assert.match(modsToml, /modLoader="javafml"/)

    const props = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(props, /gradle-8\.14\.5-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold neoforge 1.21.11 writes neoforge.mods.toml without modLoader', async () => {
  const { result, target, read } = await scaffoldPlatform('neoforge', '1.21.11')
  try {
    const build = await read('build.gradle')
    assert.match(build, /net\.neoforged\.moddev' version '2\.0\.144'/)
    assert.match(build, /JavaLanguageVersion\.of\(21\)/)

    const props = await read('gradle.properties')
    assert.match(props, /neo_version=21\.11\.45/)

    const modsToml = await read('src/main/resources/META-INF/neoforge.mods.toml')
    assert.doesNotMatch(modsToml, /modLoader/i)
    assert.ok(result.filesCreated.includes('src/main/resources/META-INF/neoforge.mods.toml'))

    const wrapper = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(wrapper, /gradle-9\.2\.1-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold neoforge 26.2 pins Java 25 with no parchment block', async () => {
  const { target, read } = await scaffoldPlatform('neoforge', '26.2')
  try {
    const build = await read('build.gradle')
    assert.match(build, /JavaLanguageVersion\.of\(25\)/)
    assert.doesNotMatch(build, /parchment/i)

    const props = await read('gradle.properties')
    assert.match(props, /neo_version=26\.2\.0\.59/)
    assert.doesNotMatch(props, /parchment/i)

    const wrapper = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(wrapper, /gradle-9\.2\.1-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// v0.3 spigot smoke tests: 1.12.2 (hub maven coordinate) and 1.7.10 (vendored jar).
// ---------------------------------------------------------------------------

test('scaffold spigot 1.12.2 pins the spigot-api coordinate and no api-version', async () => {
  const { result, target, read } = await scaffoldPlatform('spigot', '1.12.2')
  try {
    const build = await read('build.gradle')
    assert.match(build, /compileOnly 'org\.spigotmc:spigot-api:1\.12\.2-R0\.1-SNAPSHOT'/)
    assert.match(build, /hub\.spigotmc\.org\/nexus\/content\/repositories\/snapshots/)
    assert.match(build, /hub\.spigotmc\.org\/nexus\/content\/groups\/public/)
    // Transitive deps (guava 21.0, gson 2.8.0, snakeyaml 1.19, ...) resolve only from
    // Maven Central — real-build verified 2026-08-16 (V03 R4).
    assert.match(build, /mavenCentral\(\)/)
    assert.match(build, /sourceCompatibility = targetCompatibility = '1\.8'/)

    const pluginYml = await read('src/main/resources/plugin.yml')
    assert.match(pluginYml, /name: my-plugin/)
    assert.match(pluginYml, /main: com\.example\.myplugin\.MyPlugin/)
    assert.doesNotMatch(pluginYml, /api-version/)

    const main = await read('src/main/java/com/example/myplugin/MyPlugin.java')
    assert.match(main, /package com\.example\.myplugin;/)
    assert.match(main, /extends JavaPlugin/)

    const wrapper = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(wrapper, /gradle-8\.14\.3-bin\.zip/)
    assert.ok(result.filesCreated.includes('src/main/resources/plugin.yml'))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('scaffold spigot 1.7.10 uses the vendored jar and ships the libs README', async () => {
  const { result, target, read } = await scaffoldPlatform('spigot', '1.7.10')
  try {
    const build = await read('build.gradle')
    assert.match(build, /compileOnly files\('libs\/spigot-1\.7\.10-R0\.1-SNAPSHOT\.jar'\)/)
    // No maven spigot-api coordinate and no hub snapshot repository (comment text is allowed).
    assert.doesNotMatch(build, /org\.spigotmc:spigot-api:1\.7\.10/)
    assert.doesNotMatch(build, /repositories\/snapshots/)

    assert.ok(result.filesCreated.includes('libs/README.txt'), 'missing libs/README.txt anchor')
    const libs = await read('libs/README.txt')
    assert.match(libs, /spigot-1\.7\.10-R0\.1-SNAPSHOT\.jar/)

    const pluginYml = await read('src/main/resources/plugin.yml')
    assert.doesNotMatch(pluginYml, /api-version/)

    const wrapper = await read('gradle/wrapper/gradle-wrapper.properties')
    assert.match(wrapper, /gradle-8\.14\.3-bin\.zip/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
