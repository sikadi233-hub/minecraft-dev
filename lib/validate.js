/**
 * Input validation for mc_scaffold. The registry enforces types and enums;
 * these checks cover the constraints a JSON schema cannot express (naming
 * conventions, path emptiness, version format).
 * @module minecraft-dev/lib/validate
 */

/** Project name: lowercase kebab-case, used as jar name and plugin.yml name. */
const PROJECT_NAME_RE = /^[a-z][a-z0-9-]*$/

/** Java package: dot-separated lowercase identifiers, no keywords. */
const JAVA_PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

/** Full or line Minecraft version, e.g. 1.21, 1.21.8, 26.2, 1.21.x. */
const MC_VERSION_RE = /^\d+\.\d+(\.\d+|\.x)?$/i

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while',
])

/**
 * @param {string} name - project name.
 * @returns {string} the validated name.
 */
export function validateProjectName(name) {
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(`invalid project name ${JSON.stringify(name)}: use lowercase kebab-case (a-z, 0-9, dashes)`)
  }
  return name
}

/**
 * @param {string} pkg - Java package name.
 * @returns {string} the validated package.
 */
export function validateJavaPackage(pkg) {
  if (!JAVA_PACKAGE_RE.test(pkg)) {
    throw new Error(`invalid Java package ${JSON.stringify(pkg)}: use dot-separated lowercase identifiers`)
  }
  for (const segment of pkg.split('.')) {
    if (JAVA_KEYWORDS.has(segment)) {
      throw new Error(`invalid Java package ${JSON.stringify(pkg)}: "${segment}" is a Java keyword`)
    }
  }
  return pkg
}

/**
 * @param {string} version - Minecraft version.
 * @returns {string} the validated version.
 */
export function validateMcVersion(version) {
  if (!MC_VERSION_RE.test(version)) {
    throw new Error(`invalid Minecraft version ${JSON.stringify(version)}: use e.g. 1.21.8, 1.21.x, 26.2`)
  }
  return version
}

/**
 * @param {number} javaVersion - Java language level.
 * @returns {number} the validated level.
 */
export function validateJavaVersion(javaVersion) {
  if (![8, 17, 21, 25].includes(javaVersion)) {
    throw new Error(`unsupported Java version ${javaVersion}: supported levels are 8, 17, 21, 25`)
  }
  return javaVersion
}

/** Convert a kebab-case project name to PascalCase for the main class name. */
export function toMainClass(name) {
  return name
    .split('-')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
}

/** Convert a Java package to its source path, e.g. com.example.a → com/example/a. */
export function toPackagePath(pkg) {
  return pkg.split('.').join('/')
}

/**
 * Derive the plugin.yml `api-version` value. The 1.x scheme keeps the major
 * and minor: "1.21.8" → "1.21". The year-based 26.x scheme also wants
 * major.minor: a real Paper 26.2 server rejects the bare "26" with an
 * IllegalArgumentException demanding the full form (verified 2026-08), so
 * "26.2" → "26.2". A bare major like "26" (only reachable when the version
 * was never normalized) falls back to the current line "26.2".
 * @param {string} minecraftVersion - user-supplied version.
 * @returns {string} api-version value.
 */
export function toApiVersion(minecraftVersion) {
  const stripped = minecraftVersion.replace(/\.x$/i, '')
  const parts = stripped.split('.')
  const major = Number(parts[0])
  if (major >= 26) return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : '26.2'
  return `${parts[0]}.${parts[1]}`
}
