import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTextFile, renderTemplate, renderTemplateTree } from '../lib/templates.js'

test('renderTemplate replaces every placeholder', () => {
  const out = renderTemplate('{{a}}/{{b}}/{{a}}', { a: 'x', b: 2 })
  assert.equal(out, 'x/2/x')
})

test('renderTemplate throws on missing variable', () => {
  assert.throws(() => renderTemplate('{{missing}}', { other: 1 }), /undefined placeholder/)
})

test('renderTemplate leaves non-placeholder braces alone', () => {
  const out = renderTemplate('version: ${version} and {x}', { version: '1.0' })
  assert.equal(out, 'version: ${version} and {x}')
})

test('isTextFile classifies wrapper jar as binary and sources as text', () => {
  assert.equal(isTextFile('gradle/wrapper/gradle-wrapper.jar'), false)
  assert.equal(isTextFile('GRADLE/WRAPPER/GRADLE-WRAPPER.JAR'), false)
  assert.equal(isTextFile('gradlew'), true)
  assert.equal(isTextFile('build.gradle.kts'), true)
  assert.equal(isTextFile('src/main/java/a/b/Main.java'), true)
  assert.equal(isTextFile('plugin.yml'), true)
})

test('renderTemplateTree substitutes paths and text but skips binaries', () => {
  const files = [
    { rel: 'src/{{pkgPath}}/{{MainClass}}.java', content: 'package {{pkg}};' },
    { rel: 'gradle/wrapper/gradle-wrapper.jar', content: '\x00bin' },
  ]
  const out = renderTemplateTree(files, { pkgPath: 'a/b', MainClass: 'My', pkg: 'a.b' })
  assert.deepEqual(out, [
    { rel: 'src/a/b/My.java', content: 'package a.b;' },
    { rel: 'gradle/wrapper/gradle-wrapper.jar', content: '\x00bin' },
  ])
})
