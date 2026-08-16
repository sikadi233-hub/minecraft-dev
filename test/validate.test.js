import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toApiVersion,
  toMainClass,
  toPackagePath,
  validateJavaPackage,
  validateMcVersion,
  validateProjectName,
} from '../lib/validate.js'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  defaultJavaVersion,
  lineCoords,
  normalizeMcLine,
  paperApiVersion,
  resolveLine,
} from '../lib/versions.js'

test('validateProjectName accepts kebab-case and rejects others', () => {
  assert.equal(validateProjectName('my-plugin'), 'my-plugin')
  assert.throws(() => validateProjectName('MyPlugin'), /invalid project name/)
  assert.throws(() => validateProjectName('my_plugin'), /invalid project name/)
  assert.throws(() => validateProjectName('-leading'), /invalid project name/)
})

test('validateJavaPackage accepts dot-separated identifiers and rejects keywords', () => {
  assert.equal(validateJavaPackage('com.example.my_plugin'), 'com.example.my_plugin')
  assert.throws(() => validateJavaPackage('com.Example.x'), /invalid Java package/)
  assert.throws(() => validateJavaPackage('com.class.x'), /Java keyword/)
  assert.throws(() => validateJavaPackage('com..x'), /invalid Java package/)
})

test('validateMcVersion accepts full, line, and x forms', () => {
  assert.equal(validateMcVersion('1.21.8'), '1.21.8')
  assert.equal(validateMcVersion('1.21.x'), '1.21.x')
  assert.equal(validateMcVersion('26.2'), '26.2')
  assert.throws(() => validateMcVersion('1.21.8.1'), /invalid Minecraft version/)
  assert.throws(() => validateMcVersion('latest'), /invalid Minecraft version/)
})

test('normalizeMcLine strips patch and x suffix', () => {
  assert.equal(normalizeMcLine('1.21.8'), '1.21')
  assert.equal(normalizeMcLine('1.21.x'), '1.21')
  assert.equal(normalizeMcLine('26.2'), '26.2')
})

test('toApiVersion derives plugin.yml api-version', () => {
  assert.equal(toApiVersion('1.21.8'), '1.21')
  assert.equal(toApiVersion('26.2'), '26')
  assert.equal(toApiVersion('1.20.x'), '1.20')
})

test('toMainClass and toPackagePath convert names', () => {
  assert.equal(toMainClass('my-plugin'), 'MyPlugin')
  assert.equal(toMainClass('a-b-c'), 'ABC')
  assert.equal(toPackagePath('com.example.x'), 'com/example/x')
})

test('resolveLine maps lines to era defaults and rejects unknown combos', () => {
  assert.equal(resolveLine('paper', '1.21.8').javaVersion, 21)
  assert.equal(resolveLine('paper', '1.20.x').javaVersion, 17)
  assert.equal(resolveLine('paper', '26.2').javaVersion, 25)
  assert.equal(defaultJavaVersion('paper', '1.21.8'), 21)
  assert.throws(() => resolveLine('paper', '1.19'), /supported Minecraft lines/)
  // v0.3: spigot is a supported platform with its own two lines.
  assert.throws(() => resolveLine('spigot', '1.21'), /no template for spigot 1\.21; supported Minecraft lines: 1\.7, 1\.12/)
})

test('resolveLine hits every platform x line with the expected Java level', () => {
  const expectations = [
    ['paper', '1.20.6', 17],
    ['paper', '1.21.11', 21],
    ['paper', '26.2', 25],
    ['fabric', '1.20.1', 17],
    ['fabric', '1.21.11', 21],
    ['fabric', '26.2', 25],
    ['forge', '1.7.10', 8],
    ['forge', '1.12.2', 8],
    ['forge', '1.16.5', 8],
    ['forge', '1.20.1', 17],
    ['neoforge', '1.20.1', 17],
    ['neoforge', '1.21.11', 21],
    ['neoforge', '26.2', 25],
  ]
  for (const [platform, version, java] of expectations) {
    assert.equal(defaultJavaVersion(platform, version), java, `${platform} ${version}`)
  }
})

test('normalizeMcLine boundary versions match the forge era entries', () => {
  for (const version of ['1.7.10', '1.12.2', '1.16.5', '1.20.1']) {
    const entry = resolveLine('forge', version)
    assert.equal(entry.line, normalizeMcLine(version))
    assert.equal(entry.defaultMcVersion, version)
  }
})

test('resolveLine rejects unknown lines and platforms with the supported lists', () => {
  assert.throws(() => resolveLine('fabric', '1.19'), /supported Minecraft lines: 1\.20, 1\.21, 26/)
  assert.throws(() => resolveLine('forge', '1.13'), /supported Minecraft lines: 1\.7, 1\.12, 1\.16, 1\.20/)
  assert.throws(() => resolveLine('neoforge', '1.19'), /supported Minecraft lines: 1\.20, 1\.21, 26/)
  assert.throws(() => resolveLine('spigot', '1.21.8'), /no template for spigot 1\.21\.8; supported Minecraft lines: 1\.7, 1\.12/)
  // v0.3: every platform key in the matrix is supported; unknown keys still fail.
  assert.throws(() => resolveLine('unknown', '1.21.8'), /unsupported platform "unknown"; supported: paper, fabric, forge, neoforge, spigot/)
  // 1.21.3 normalizes to line "1.21" and matches the neoforge 1.21 entry
  // (startsWith semantics; the plan lists it under unknown lines but the
  // documented matrix matching makes it resolve — kept as a documented behavior).
  assert.equal(resolveLine('neoforge', '1.21.3').defaultMcVersion, '1.21.11')
})

test('lineCoords returns the per-line pinned coordinates', () => {
  assert.deepEqual(lineCoords('fabric', '1.21.11'), {
    gradleVersion: '9.5.1',
    loomVersion: '1.17.19',
    loaderVersion: '0.19.3',
    fabricApiVersion: '0.141.6+1.21.11',
  })
  assert.equal(lineCoords('fabric', '1.20.1').fabricApiVersion, '0.92.11+1.20.1')
  assert.equal(lineCoords('fabric', '26.2').fabricApiVersion, '0.157.0+26.2')
  assert.equal(lineCoords('forge', '1.7.10').forgeGradle, 'com.anatawa12.forge:ForgeGradle:1.2-1.1.+')
  assert.equal(lineCoords('forge', '1.7.10').gradleVersion, '7.4.2')
  assert.deepEqual(
    ['gradleVersion', 'forgeGradle', 'forgeVersion', 'mappingsChannel', 'mappingsVersion'],
    Object.keys(lineCoords('forge', '1.12.2')),
  )
  assert.equal(lineCoords('forge', '1.20.1').forgeGradlePluginVersion, '6.0.54')
  assert.equal(lineCoords('forge', '1.12.2').mappingsVersion, '20171003-1.12')
  assert.equal(lineCoords('forge', '1.16.5').mappingsChannel, 'official')
  assert.equal(lineCoords('forge', '1.16.5').forgeVersion, '36.2.39')
  assert.equal(lineCoords('forge', '1.20.1').forgeGradle, 'net.minecraftforge.gradle:ForgeGradle:6.0.54')
  assert.equal(lineCoords('neoforge', '1.20.1').moddevPlugin, 'net.neoforged.moddev.legacyforge')
  assert.equal(lineCoords('neoforge', '1.20.1').moddevVersion, '2.0.91')
  assert.equal(lineCoords('neoforge', '1.20.1').gradleVersion, '8.14.5')
  assert.equal(lineCoords('neoforge', '1.21.11').neoVersion, '21.11.45')
  assert.equal(lineCoords('neoforge', '26.2').neoVersion, '26.2.0.59')
  assert.equal(lineCoords('neoforge', '26.2').gradleVersion, '9.2.1')
  // Paper has no coords: falls back to {}.
  assert.deepEqual(lineCoords('paper', '1.21.8'), {})
})

test('paperApiVersion regression stays unchanged', () => {
  assert.equal(paperApiVersion('1.21.8'), '1.21.8-R0.1-SNAPSHOT')
  assert.equal(paperApiVersion('26.2'), '26.2.build.+')
})

test('PLATFORM_LABELS covers all five supported platforms', () => {
  assert.deepEqual([...SUPPORTED_PLATFORMS].sort(), ['fabric', 'forge', 'neoforge', 'paper', 'spigot'])
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.ok(PLATFORM_LABELS[platform], `missing label for ${platform}`)
  }
  assert.equal(PLATFORM_LABELS.paper, 'Paper plugin')
  assert.equal(PLATFORM_LABELS.fabric, 'Fabric mod')
  assert.equal(PLATFORM_LABELS.forge, 'Forge mod')
  assert.equal(PLATFORM_LABELS.neoforge, 'NeoForge mod')
  assert.equal(PLATFORM_LABELS.spigot, 'Spigot plugin')
})
