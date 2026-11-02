/**
 * Shared machinery for the offline API-signature indexes.
 *
 * The plugin ships one index per (platform, line) under
 * `assets/skills/minecraft-<platform>/references/api-index/`, generated from the
 * artefacts the runtime actually compiles against. Three properties matter:
 *
 * 1. **Signatures only.** We never copy method bodies or javadoc prose; the
 *    index is a list of `package.Class` headings with one line per visible
 *    member. That keeps it small and keeps it a reference rather than a copy.
 * 2. **Provenance or bust.** Every file starts with a machine-checked header
 *    (platform, line, artefact coordinate, sha1, fetch date, JDK, name mapping,
 *    truncation). `test/api-index.test.js` rejects a file without it, so a
 *    hand-edited index cannot quietly claim to come from a jar it did not.
 * 3. **Local artefacts first.** A machine that has built a Minecraft project
 *    already holds the api jars in Gradle's cache; reaching the network is the
 *    fallback, not the default (maven hosts are routinely unreachable).
 *
 * `javap` is the extractor: it reads class files directly, so it works for
 * compiled jars without sources and reports exact parameter types. Source
 * extraction exists for the one artefact that ships sources locally (NeoForge)
 * and is marked as such in the header.
 *
 * @module minecraft-dev/scripts/mc-index-lib
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

/** Highest member count emitted for one class before its tail is cut. */
export const MEMBERS_PER_CLASS_CAP = 40

/** Hard ceiling for one index file; the renderer truncates classes to fit. */
export const INDEX_BYTES_CAP = 300 * 1024

/** Packages never worth indexing: the JDK, and shaded third-party code. */
const SKIP_PREFIXES = ['java.', 'javax.', 'sun.', 'jdk.', 'com.google.', 'org.slf4j.', 'it.unimi.', 'com.mojang.', 'org.jetbrains.']

/** Repo-relative cache dir for downloaded artefacts (gitignored). */
const REPO = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CACHE = join(REPO, '.cache', 'mc-api')

/**
 * sha1 of a file, for the provenance header.
 * @param {string} path - absolute file path.
 * @returns {string} lowercase hex digest.
 */
export function sha1Of(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

/**
 * Locate a usable JDK for the class-file level we are reading.
 *
 * `javap` from an older JDK refuses class files from a newer one, so ask for the
 * line's level and fall back to the highest JDK on the machine (a newer javap
 * reads older class files without complaint).
 * @param {number} javaVersion - the line's Java level (8/17/21/25).
 * @returns {{ bin: string, version: number } | undefined} JDK bin dir and level.
 */
export function findJdk(javaVersion) {
  const candidates = []
  for (const root of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium']) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const hit = /(?:jdk|jdk-)(\d+)/i.exec(name)
      if (hit) candidates.push({ bin: join(root, name, 'bin'), version: Number(hit[1]) })
    }
  }
  const gradleJdks = join(homedir(), '.gradle', 'jdks')
  if (existsSync(gradleJdks)) {
    for (const name of readdirSync(gradleJdks)) {
      const hit = /-(\d+)-/.exec(name)
      const bin = join(gradleJdks, name, 'bin')
      if (hit && existsSync(join(bin, 'javap.exe'))) candidates.push({ bin, version: Number(hit[1]) })
    }
  }
  const usable = candidates.filter(entry => existsSync(join(entry.bin, 'javap.exe')))
  const exact = usable.filter(entry => entry.version >= javaVersion).sort((a, b) => a.version - b.version)[0]
  return exact ?? usable.sort((a, b) => b.version - a.version)[0]
}

/**
 * List class entries inside a jar/zip using the system tar (bsdtar reads zip).
 * @param {string} jarPath - absolute path to a jar or zip.
 * @returns {string[]} entry names.
 */
export function listArchive(jarPath) {
  const result = spawnSync('tar', ['-tf', jarPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`tar -tf failed for ${jarPath}: ${result.stderr || result.status}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

/**
 * Extract an archive into `dest` (created if missing).
 * @param {string} archivePath - jar or zip.
 * @param {string} dest - destination directory.
 */
export function extractArchive(archivePath, dest) {
  mkdirSync(dest, { recursive: true })
  const result = spawnSync('tar', ['-xf', archivePath, '-C', dest], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`tar -xf failed for ${archivePath}: ${result.stderr || result.status}`)
}

/**
 * Binary class names (no `.class`, no nested `$` classes) from a jar.
 * Nested classes are skipped on purpose: they multiply the output without
 * adding lookup value for an API reference.
 * @param {string} jarPath - absolute jar path.
 * @param {string[]} packages - package prefixes to keep (empty keeps everything).
 * @returns {string[]} dotted class names, sorted.
 */
export function listClasses(jarPath, packages) {
  const names = []
  for (const entry of listArchive(jarPath)) {
    if (!entry.endsWith('.class') || entry.endsWith('module-info.class')) continue
    const name = entry.slice(0, -'.class'.length).replaceAll('/', '.')
    if (name.includes('$')) continue
    if (SKIP_PREFIXES.some(prefix => name.startsWith(prefix))) continue
    if (packages.length > 0 && !packages.some(prefix => name.startsWith(prefix))) continue
    names.push(name)
  }
  return [...new Set(names)].sort()
}

/**
 * Run `javap -public` over a batch of classes and parse the output.
 *
 * Output shape we rely on (stable across JDK 17-25):
 *
 *     Compiled from "Bukkit.java"
 *     public final class org.bukkit.Bukkit {
 *       public static org.bukkit.Server getServer();
 *     }
 * @param {string} jarPath - absolute jar path.
 * @param {string[]} classes - dotted class names.
 * @param {string} jdkBin - JDK `bin` directory.
 * @returns {Map<string, string[]>} class name → member lines.
 */
export function javapClasses(jarPath, classes, jdkBin) {
  const out = new Map()
  const batchSize = 120
  for (let offset = 0; offset < classes.length; offset += batchSize) {
    const batch = classes.slice(offset, offset + batchSize)
    const result = spawnSync(join(jdkBin, 'javap.exe'), ['-public', '-classpath', jarPath, ...batch], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    if (result.status !== 0 && !result.stdout) {
      throw new Error(`javap failed for ${relative(process.cwd(), jarPath)}: ${result.stderr || result.status}`)
    }
    let current
    for (const raw of result.stdout.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('Compiled from') || line === '}') continue
      const declaration = /^(?:public|protected)[^=]*\b(class|interface|enum|record)\s+([\w.$]+)/.exec(line)
      if (declaration) {
        current = declaration[2]
        out.set(current, [])
        continue
      }
      if (current === undefined) continue
      if (!/^(?:public|protected)/.test(line)) continue
      if (!line.endsWith(';')) continue
      out.get(current).push(line.replace(/\s+/g, ' '))
    }
  }
  return out
}

/**
 * Extract public/protected declarations from unpacked `.java` sources.
 * Used only for artefacts whose sources ship locally (NeoForge); the header
 * says so, and the parser deliberately keeps just the declaration line.
 * @param {string} sourceDir - directory holding unpacked sources.
 * @param {string[]} packages - package prefixes to keep.
 * @returns {Map<string, string[]>} fully-qualified class name → member lines.
 */
export function sourcesClasses(sourceDir, packages) {
  const out = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.java')) continue
      const text = readFileSync(full, 'utf8')
      const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text)?.[1]
      if (!pkg) continue
      if (packages.length > 0 && !packages.some(prefix => pkg.startsWith(prefix))) continue
      const typeName = entry.name.slice(0, -'.java'.length)
      const fqcn = `${pkg}.${typeName}`
      if (fqcn.includes('$')) continue
      const members = []
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!/^(?:public|protected)/.test(trimmed)) continue
        if (!trimmed.endsWith(';') && !trimmed.endsWith('{')) continue
        if (/\b(class|interface|enum|record)\b/.test(trimmed) && !trimmed.includes('(')) continue
        members.push(trimmed.replace(/\s+/g, ' ').replace(/\s*\{$/, ';'))
      }
      if (members.length > 0) out.set(fqcn, members)
    }
  }
  walk(sourceDir)
  return out
}

/**
 * Decide which name mapping a class file actually uses.
 *
 * Forge/NeoForge jars up to 1.20.4 are reobfuscated to SRG, and Fabric jars
 * reference Minecraft types through intermediary; in both cases an index would
 * show `func_12345_` / `class_1234` where a human expects `getX` / `ItemStack`.
 * We report that instead of pretending the names are readable.
 * @param {Iterable<string>} lines - all member lines of the index.
 * @returns {'official' | 'srg' | 'intermediary'} detected mapping.
 */
export function detectMapping(lines) {
  let srg = 0
  let intermediary = 0
  let total = 0
  for (const line of lines) {
    total += 1
    if (/\bfunc_\d+_|(?:^|[\s.(])field_\d+_|(?:^|[\s.(])method_\d+_/.test(line)) srg += 1
    if (/\bclass_\d+\b|(?:^|[\s.(])method_\d+\b|(?:^|[\s.(])field_\d+\b/.test(line)) intermediary += 1
  }
  if (total === 0) return 'official'
  if (srg / total > 0.02) return 'srg'
  if (intermediary / total > 0.02) return 'intermediary'
  return 'official'
}

/**
 * Render one index file.
 * @param {object} options - index content.
 * @param {string} options.platform - e.g. `paper`.
 * @param {string} options.line - e.g. `26.3`.
 * @param {string} options.artifact - coordinate string, e.g. `io.papermc.paper:paper-api:26.3.build.237-stable`.
 * @param {string} options.sha1 - digest of the input artefact.
 * @param {string} options.origin - `gradle-cache <path>` or `download <url>`.
 * @param {string} options.fetchedAt - ISO date (YYYY-MM-DD).
 * @param {string} options.jdk - JDK level used, e.g. `25`.
 * @param {string} options.backend - `javap` or `sources`.
 * @param {Map<string, string[]>} options.classes - class → member lines.
 * @param {boolean} options.truncated - whether the cap cut content.
 * @param {number} options.totalClasses - classes available before the cap.
 * @param {string[]} [options.notes] - extra provenance notes.
 * @param {string} [options.generator] - script that produced the file.
 * @returns {string} the file body.
 */
export function renderIndex(options) {
  const { platform, line, artifact, sha1, origin, fetchedAt, jdk, backend, classes, truncated, totalClasses, notes = [], generator = 'scripts/fetch-mc-api-index.mjs' } = options
  const allLines = [...classes.values()].flat()
  const mapping = detectMapping(allLines)
  const header = [
    '<!-- PROVENANCE',
    `     platform=${platform}`,
    `     line=${line}`,
    `     artifact=${artifact}`,
    `     sha1=${sha1}`,
    `     fetched=${fetchedAt}`,
    `     jdk=${jdk}`,
    `     backend=${backend}`,
    `     mapping=${mapping}`,
    `     origin=${origin}`,
    `     classes=${classes.size}/${totalClasses}${truncated ? ' (TRUNCATED)' : ''}`,
    ...notes.map(note => `     note=${note}`),
    '-->',
  ]
  const body = [
    `# ${platform} ${line} API 签名索引`,
    '',
    `> **检索辅助，不是权威。** 由 \`${generator}\` 从 ${
      backend === 'javap' ? '`javap -public`' : '源码正则'
    } 生成，只含公开成员签名，不含行为说明。` +
      (truncated ? `本文件已截断（保留 ${classes.size}/${totalClasses} 个类）。` : '') +
      (mapping === 'official'
        ? ''
        : `⚠️ 该工件使用 \`${mapping}\` 命名（MC 类型可能显示为 \`func_/class_\` 形式），签名里的类型名不可直接照抄。`) +
      '拿不准或索引未覆盖时，退回 `references/api/` 与官方文档，**禁止凭记忆写签名**。',
    '',
    ...(truncated ? [`TRUNCATED: kept ${classes.size}/${totalClasses} classes`, ''] : []),
  ]
  for (const [className, members] of [...classes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    body.push(`## ${className}`, '')
    for (const member of members.slice(0, MEMBERS_PER_CLASS_CAP)) body.push(`- ${member}`)
    if (members.length > MEMBERS_PER_CLASS_CAP) body.push(`- … (+${members.length - MEMBERS_PER_CLASS_CAP} more)`)
    body.push('')
  }
  return `${header.join('\n')}\n\n${body.join('\n')}`
}

/**
 * Order classes for truncation so no package is starved.
 *
 * Pure alphabetical order cuts whole packages off the tail once the byte cap
 * applies (a NeoForge index lost `event.entity.player.*` that way). Instead:
 * classes the skills already mention come first, then the rest are interleaved
 * round-robin across packages, so every package keeps a representative slice.
 * @param {Map<string, string[]>} classes - full class map.
 * @param {Set<string>} priority - simple class names mentioned by skills or core symbols.
 * @param {string[]} [packagePriority] - package prefixes to promote ahead of the rest.
 * @returns {[string, string[]][]} ordered entries.
 */
export function orderClasses(classes, priority, packagePriority = []) {
  const packages = new Map()
  const preferred = []
  for (const [name, members] of classes) {
    if (priority.has(name.split('.').pop())) {
      preferred.push([name, members])
      continue
    }
    const pkg = name.split('.').slice(0, -1).join('.')
    if (!packages.has(pkg)) packages.set(pkg, [])
    packages.get(pkg).push([name, members])
  }
  preferred.sort(([a], [b]) => a.localeCompare(b))
  // API-facing packages first, client/GUI noise last, the rest alphabetically.
  const rank = pkg => {
    if (packagePriority.some(prefix => pkg === prefix || pkg.startsWith(prefix + '.'))) return 0
    if (/\.(client|gui|render|rendering|model|screen)(\.|$)/.test(pkg)) return 2
    return 1
  }
  const queues = [...packages.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([, entries]) => entries.sort(([a], [b]) => a.localeCompare(b)))
  const ordered = [...preferred]
  let drained = false
  while (!drained) {
    drained = true
    for (const queue of queues) {
      const next = queue.shift()
      if (next) {
        ordered.push(next)
        drained = false
      }
    }
  }
  return ordered
}

/**
 * Render as many classes as fit under the byte cap, by binary search.
 *
 * An estimate per member is unreliable (generic signatures vary widely), so we
 * render and measure. Offline generation is the only caller, so the extra
 * renders are affordable.
 * @param {object} base - everything {@link renderIndex} needs except `classes`.
 * @param {[string, string[]][]} ordered - classes in truncation priority order.
 * @param {number} [cap] - byte ceiling.
 * @returns {{ body: string, kept: number, total: number }} the fitted index body.
 */
export function fitIndex(base, ordered, cap = INDEX_BYTES_CAP) {
  const total = ordered.length
  const render = (count) => renderIndex({
    ...base,
    classes: new Map(ordered.slice(0, count)),
    truncated: count < total,
    totalClasses: total,
  })
  const full = render(total)
  if (Buffer.byteLength(full) <= cap) return { body: full, kept: total, total }
  let low = 1
  let high = total - 1
  let best = { body: render(1), kept: 1 }
  while (low <= high) {
    const mid = (low + high) >> 1
    const body = render(mid)
    if (Buffer.byteLength(body) <= cap) {
      best = { body, kept: mid }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return { body: best.body, kept: best.kept, total }
}

/**
 * Core symbols that must survive truncation even when no skill backticks them.
 *
 * The width tier keeps ~100-200 classes per line; without this list a package
 * like `net.minecraftforge.fml.common` loses `Mod` to its alphabetically earlier
 * neighbours, which is exactly the class a Forge beginner looks up first.
 */
const CORE_SYMBOLS = new Set([
  'Mod', 'ModInitializer', 'ClientModInitializer', 'DedicatedServerModInitializer', 'ServerLifecycleEvents',
  'Event', 'EventBusSubscriber', 'DeferredRegister', 'RegistryObject', 'Registry', 'BuiltInRegistries', 'ResourceKey',
  'Item', 'Block', 'ItemStack', 'BlockEntity', 'Player', 'PlayerEntity', 'ServerPlayer', 'Server', 'Level',
  'JavaPlugin', 'Bukkit', 'Listener', 'Plugin', 'Command', 'CommandSender', 'Component', 'Scheduler',
  'MinecraftForge', 'NeoForge', 'FMLCommonSetupEvent', 'ServerStartingEvent', 'IEventBus', 'ItemGroup',
])

/**
 * Simple class names mentioned anywhere under `assets/skills/**`.
 * Used to decide which classes survive truncation.
 * @returns {Set<string>} simple names, e.g. `Bukkit`.
 */
export function skillMentionedClasses() {
  const mentioned = new Set()
  const skillsRoot = join(REPO, 'assets', 'skills')
  if (!existsSync(skillsRoot)) return mentioned
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(md|yml|js)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      for (const match of text.matchAll(/`([A-Z][A-Za-z0-9_]{2,})(?:#[a-zA-Z0-9_]+)?`/g)) mentioned.add(match[1])
      for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})(?:Event|Registry|Block|Item)\b/g)) mentioned.add(match[1])
    }
  }
  walk(skillsRoot)
  for (const name of CORE_SYMBOLS) mentioned.add(name)
  return mentioned
}

/**
 * Cache directory for downloaded artefacts.
 * @param {...string} parts - path components below `.cache/mc-api/`.
 * @returns {string} absolute path (directory created).
 */
export function cachePath(...parts) {
  const path = join(CACHE, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * Download a URL to `dest` with a timeout and two retries.
 * @param {string} url - source URL.
 * @param {string} dest - destination file path.
 * @param {number} [timeoutMs] - per-attempt timeout.
 * @returns {Promise<boolean>} whether the file landed.
 */
export async function download(url, dest, timeoutMs = 120_000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (response.status !== 200) continue
      writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
      if (statSync(dest).size > 0) return true
    } catch {
      /* retry */
    }
  }
  rmSync(dest, { force: true })
  return false
}

/** Today as `YYYY-MM-DD`, for provenance headers. */
export function today() {
  return new Date().toISOString().slice(0, 10)
}

export { CACHE, REPO }
