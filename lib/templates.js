/**
 * Placeholder rendering and template-tree helpers for mc_scaffold.
 * All functions are pure: no I/O, no clocks — safe to unit-test directly.
 * @module minecraft-dev/lib/templates
 */

/** Placeholder syntax used inside template files and file names: {{name}}. */
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g

/**
 * Substitute every {{key}} occurrence with the matching variable value.
 * @param {string} content - template text.
 * @param {Record<string, string | number>} vars - substitution values.
 * @returns {string} the rendered text.
 * @throws {Error} when the text references a variable with no value.
 */
export function renderTemplate(content, vars) {
  return content.replace(PLACEHOLDER_RE, (_match, key) => {
    if (!(key in vars)) {
      throw new Error(`template references undefined placeholder {{${key}}}`)
    }
    return String(vars[key])
  })
}

/** Template file extensions that undergo placeholder substitution. */
const TEXT_EXTENSIONS = new Set([
  '.bat', '.gradle', '.info', '.java', '.json', '.kts', '.md', '.properties', '.toml', '.txt', '.xml', '.yml', '.yaml', '',
])

/**
 * Decide whether a template file is text (rendered) or binary (copied verbatim).
 * gradlew (no extension) is text; gradle-wrapper.jar is binary.
 * @param {string} relPath - template-root-relative path.
 * @returns {boolean} whether the file should be placeholder-rendered.
 */
export function isTextFile(relPath) {
  const base = relPath.toLowerCase()
  if (base.endsWith('gradle-wrapper.jar')) return false
  const dot = base.lastIndexOf('.')
  const ext = dot < 0 ? '' : base.slice(dot)
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * Render a template tree's relative paths and text contents.
 * @param {Array<{ rel: string, content: string }>} files - template files with root-relative paths.
 * @param {Record<string, string | number>} vars - substitution values.
 * @returns {Array<{ rel: string, content: string }>} rendered files, paths substituted too.
 */
export function renderTemplateTree(files, vars) {
  return files.map(file => {
    const rel = renderTemplate(file.rel, vars)
    if (!isTextFile(file.rel)) return { rel, content: file.content }
    const text = typeof file.content === 'string' ? file.content : file.content.toString('utf8')
    return { rel, content: renderTemplate(text, vars) }
  })
}
