import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { clearScopeCache, detectProjectKind, explainScope, isUnder, shouldExposeSkills } from '../lib/skill-scope.js'

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'mcdev-scope-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, ...relativePath.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  clearScopeCache()
  return root
}

const MAVEN_MARKERS = {
  'build.gradle': "plugins { id 'java-library' }\ndependencies { compileOnly 'io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT' }\n",
}

test('a plugin.yml anywhere in the resource layout marks a Minecraft project', () => {
  const root = project({ 'src/main/resources/plugin.yml': 'name: demo\n' })
  try {
    assert.deepEqual(detectProjectKind(root), { minecraft: true, other: false })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a build script that names a Minecraft toolchain marks it too', () => {
  const root = project(MAVEN_MARKERS)
  try {
    assert.equal(detectProjectKind(root).minecraft, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a gradle.properties with minecraft_version is enough', () => {
  const root = project({ 'gradle.properties': 'minecraft_version=1.21.8\n' })
  try {
    assert.equal(detectProjectKind(root).minecraft, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a Java source importing a Minecraft API is enough', () => {
  const root = project({
    'src/main/java/com/example/Demo.java': 'package com.example;\nimport org.bukkit.plugin.java.JavaPlugin;\npublic class Demo extends JavaPlugin {}\n',
  })
  try {
    assert.equal(detectProjectKind(root).minecraft, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('another stack with no Minecraft marker is recognised as other', () => {
  const root = project({ 'package.json': '{"name":"not-minecraft"}\n' })
  try {
    assert.deepEqual(detectProjectKind(root), { minecraft: false, other: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an empty or unrecognised directory is neither', () => {
  const root = project({ 'notes.txt': 'nothing to see\n' })
  try {
    assert.deepEqual(detectProjectKind(root), { minecraft: false, other: false })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('auto shows the catalog in Minecraft and unknown workspaces, hides it in another stack', () => {
  const mc = project(MAVEN_MARKERS)
  const other = project({ 'pyproject.toml': '[project]\nname = "x"\n' })
  const empty = project({ 'readme.md': 'x\n' })
  try {
    assert.equal(shouldExposeSkills({ cwd: mc }), true)
    assert.equal(shouldExposeSkills({ cwd: other }), false)
    assert.equal(shouldExposeSkills({ cwd: empty }), true)
    assert.equal(shouldExposeSkills({ cwd: undefined }), true, 'no workspace means no reason to hide')
    assert.equal(shouldExposeSkills({ cwd: mc, scope: 'always' }), true)
    assert.equal(shouldExposeSkills({ cwd: mc, scope: 'off' }), false)
  } finally {
    rmSync(mc, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  }
})

test('listed only shows the catalog under the configured roots', () => {
  const inside = project({ 'plugin.yml': 'name: x\n' })
  const outside = project({ 'plugin.yml': 'name: y\n' })
  try {
    assert.equal(shouldExposeSkills({ cwd: inside, scope: 'listed', workspaces: [inside] }), true)
    assert.equal(shouldExposeSkills({ cwd: outside, scope: 'listed', workspaces: [inside] }), false)
    assert.equal(shouldExposeSkills({ cwd: undefined, scope: 'listed', workspaces: [inside] }), false)
    const nested = join(inside, 'sub', 'module')
    mkdirSync(nested, { recursive: true })
    assert.equal(shouldExposeSkills({ cwd: nested, scope: 'listed', workspaces: [inside] }), true, 'a nested project is under its root')
  } finally {
    rmSync(inside, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('isUnder ignores trailing separators and case on Windows', () => {
  assert.equal(isUnder('C:\\work\\proj', 'C:\\work\\proj'), true)
  assert.equal(isUnder('C:\\work\\proj\\', 'C:\\work\\proj'), true)
  assert.equal(isUnder('C:\\work\\proj2', 'C:\\work\\proj'), false)
})

test('explainScope names the reason it decided on', () => {
  const mc = project(MAVEN_MARKERS)
  const other = project({ 'Cargo.toml': '[package]\nname = "x"\n' })
  try {
    assert.match(explainScope({ cwd: mc }).reason, /Minecraft markers/)
    assert.match(explainScope({ cwd: other }).reason, /another stack/)
    assert.match(explainScope({ cwd: mc, scope: 'listed', workspaces: [mc] }).reason, /^under /)
    assert.match(explainScope({ cwd: mc, scope: 'always' }).reason, /scope=always/)
  } finally {
    rmSync(mc, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})
