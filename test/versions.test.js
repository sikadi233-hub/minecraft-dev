import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  defaultJavaVersion,
  lineCoords,
  normalizeMcLine,
  resolveLine,
} from '../lib/versions.js'

// v0.3: spigot legacy lines (1.7.10 / 1.12.2). Platform isolation is the key
// regression: spigot's "1.7"/"1.12" lines must never leak into forge/paper
// resolution and vice versa.

test('spigot lines resolve for 1.7.10 and 1.12.2 with Java 8', () => {
  const e1710 = resolveLine('spigot', '1.7.10')
  assert.equal(e1710.line, '1.7')
  assert.equal(e1710.javaVersion, 8)
  assert.equal(e1710.defaultMcVersion, '1.7.10')
  assert.equal(e1710.templateDir, 'spigot-1.7.10')

  const e1122 = resolveLine('spigot', '1.12.2')
  assert.equal(e1122.line, '1.12')
  assert.equal(e1122.javaVersion, 8)
  assert.equal(e1122.defaultMcVersion, '1.12.2')
  assert.equal(e1122.templateDir, 'spigot-1.12.2')

  assert.equal(defaultJavaVersion('spigot', '1.7.10'), 8)
  assert.equal(defaultJavaVersion('spigot', '1.12.2'), 8)
})

test('spigot normalization boundaries hit the intended line', () => {
  assert.equal(normalizeMcLine('1.7.10'), '1.7')
  assert.equal(normalizeMcLine('1.7.9'), '1.7')
  // 1.7.x plugins compile against the 1.7.10 API and run on 1.7.9 servers.
  assert.equal(resolveLine('spigot', '1.7.9').templateDir, 'spigot-1.7.10')
  assert.equal(normalizeMcLine('1.12.1'), '1.12')
  // 1.12.1 spigot-api has the same API; the 1.12.2 template covers it.
  assert.equal(resolveLine('spigot', '1.12.1').templateDir, 'spigot-1.12.2')
})

test('spigot coords pin Gradle 8.14.3 and the spigotApi coordinate', () => {
  assert.deepEqual(lineCoords('spigot', '1.12.2'), {
    gradleVersion: '8.14.3',
    spigotApi: 'org.spigotmc:spigot-api:1.12.2-R0.1-SNAPSHOT',
  })
  // 1.7.10 has no public maven; the coordinate is the canonical spec name
  // (the template consumes a vendored jar instead).
  assert.deepEqual(lineCoords('spigot', '1.7.10'), {
    gradleVersion: '8.14.3',
    spigotApi: 'org.spigotmc:spigot-api:1.7.10-R0.1-SNAPSHOT',
  })
})

test('spigot lines stay isolated from forge and paper', () => {
  // forge keeps its own 1.7/1.12 entries — spigot's addition changes nothing.
  assert.equal(resolveLine('forge', '1.7.10').templateDir, 'forge-1.7.10')
  assert.equal(resolveLine('forge', '1.12.2').templateDir, 'forge-1.12.2')
  // spigot rejects lines it does not ship, even when paper/forge have them.
  assert.throws(() => resolveLine('spigot', '1.13'), /no template for spigot 1\.13; supported Minecraft lines: 1\.7, 1\.12/)
  assert.throws(() => resolveLine('spigot', '1.20'), /no template for spigot 1\.20; supported Minecraft lines: 1\.7, 1\.12/)
  assert.throws(() => resolveLine('spigot', '1.21.8'), /no template for spigot 1\.21\.8; supported Minecraft lines: 1\.7, 1\.12/)
  // and paper lines still resolve through the paper matrix only.
  assert.equal(resolveLine('paper', '1.21.8').templateDir, 'paper')
})

test('spigot is registered in labels and supported platforms', () => {
  assert.equal(PLATFORM_LABELS.spigot, 'Spigot plugin')
  assert.ok(SUPPORTED_PLATFORMS.includes('spigot'))
})
