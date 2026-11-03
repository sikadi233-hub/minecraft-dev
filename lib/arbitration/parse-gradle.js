// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Build-script surgery for the merge step.
 *
 * The templates carry a `// [mc:dependencies]` line inside their `dependencies`
 * block; the merger inserts one coordinate per line there and nowhere else. That
 * is deliberately narrow: rewriting a Gradle script with regexes is how build
 * files get broken, so the rule is "anchor in, lines appended, anchor kept".
 *
 * Both dialects are supported because the Paper template is Kotlin DSL
 * (`build.gradle.kts`) while every other template is Groovy — and the same
 * `implementation`/`compileOnly` names differ in syntax (`'x:y:z'` vs
 * `("x:y:z")`).
 *
 * @module minecraft-dev/lib/arbitration/parse-gradle
 */

/** The anchor line every template carries inside its dependencies block. */
export const DEPENDENCY_ANCHOR = '// [mc:dependencies]'

/** Scope → dependency configuration, per dialect. */
const CONFIGURATIONS = {
  groovy: { compile: 'implementation', runtime: 'runtimeOnly', compileOnly: 'compileOnly', test: 'testImplementation' },
  kotlin: { compile: 'implementation', runtime: 'runtimeOnly', compileOnly: 'compileOnly', test: 'testImplementation' },
}

/**
 * Dialect of a build script, from its file name.
 * @param {string} path - `build.gradle` or `build.gradle.kts`.
 * @returns {'groovy'|'kotlin'} dialect.
 */
export function dialectOf(path) {
  return /\.kts$/i.test(path) ? 'kotlin' : 'groovy'
}

/**
 * Whether the script still carries the anchor.
 * @param {string} content - build script text.
 * @returns {boolean} true when the anchor line is present.
 */
export function hasDependencyAnchor(content) {
  return String(content).split(/\r?\n/).some(line => line.trim() === DEPENDENCY_ANCHOR)
}

/**
 * Render one dependency line in the script's dialect.
 * @param {'groovy'|'kotlin'} dialect - script dialect.
 * @param {{ group: string, name: string, version: string, scope?: string }} dep - coordinate.
 * @returns {string} the line, without indentation.
 */
export function renderDependencyLine(dialect, dep) {
  const configuration = CONFIGURATIONS[dialect][dep.scope ?? 'compile']
  if (!configuration) throw new Error(`unsupported dependency scope: ${dep.scope}`)
  const coordinate = `${dep.group}:${dep.name}:${dep.version}`
  return dialect === 'kotlin' ? `${configuration}("${coordinate}")` : `${configuration} '${coordinate}'`
}

/**
 * Insert dependency lines after the anchor.
 *
 * Coordinates already present anywhere in the script are skipped, so running the
 * merge twice (or merging a shard that declared a scaffold dependency) does not
 * duplicate lines.
 * @param {object} options - content, dialect, dependencies.
 * @returns {{ content: string, inserted: string[], skipped: string[], anchor: boolean }} result.
 */
export function injectDependencies({ content, dialect, dependencies }) {
  const text = String(content)
  const lines = text.split(/\r?\n/)
  const anchorIndex = lines.findIndex(line => line.trim() === DEPENDENCY_ANCHOR)
  if (anchorIndex < 0) return { content: text, inserted: [], skipped: dependencies.map(dep => `${dep.group}:${dep.name}:${dep.version}`), anchor: false }

  const anchorIndent = /^(\s*)/.exec(lines[anchorIndex])[1]
  const memberIndent = `${anchorIndent}    `
  const inserted = []
  const skipped = []
  const additions = []
  for (const dep of dependencies) {
    const coordinate = `${dep.group}:${dep.name}:${dep.version}`
    const already = new RegExp(`(?:^|[\\s'"(:])${coordinate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['")]|$)`).test(text)
    if (already) { skipped.push(coordinate); continue }
    additions.push(`${memberIndent}${renderDependencyLine(dialect, dep)}`)
    inserted.push(coordinate)
  }
  if (additions.length === 0) return { content: text, inserted, skipped, anchor: true }
  lines.splice(anchorIndex + 1, 0, ...additions)
  return { content: lines.join('\n'), inserted, skipped, anchor: true }
}

/** Supported scopes, exported for the tool schema. */
export const SUPPORTED_SCOPES = Object.keys(CONFIGURATIONS.groovy)
