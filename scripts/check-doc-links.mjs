#!/usr/bin/env node
// check-doc-links.mjs — minecraft-dev v0.4 半自动文档链接核对脚本（V04_PLAN §2）
//
// 纯 Node 标准库 + 内置 fetch（无第三方依赖）。扫描 assets/**/*.md：
//   - curseforge 项目页链接 / curse.maven 坐标 / 裸 projectId → api.cfwidget.com 校验
//     （本环境 CF 直连 403，cfwidget 是唯一可靠源；cfwidget 支持数字 ID 查询）
//   - 其余 http(s) 链接 → HEAD（405/501 或非 2xx/3xx 时回退 GET，Range: bytes=0-0）
// 失败分级：BROKEN（确定性失效：404/410/5xx、JSON id 不匹配）→ exit 1；
//           UNVERIFIABLE（超时/403 限流/网络错误等无法定论）→ 不导致失败退出。
// 退出码：0 = 无 BROKEN；1 = 存在 BROKEN；2 = 参数错误或网络整体不可用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.4.0'
const CFWIDGET_BASE = 'https://api.cfwidget.com/minecraft/mc-mods/'
const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')

export const USAGE = `check-doc-links v${VERSION} — 扫描 markdown 文档，核对 http(s) 链接与 curse.maven projectId（经 api.cfwidget.com）

用法: node scripts/check-doc-links.mjs [选项]

扫描范围: <dir>/**/*.md（默认 ${path.relative(process.cwd(), DEFAULT_DIR) || DEFAULT_DIR}，即仓库 assets/）

选项:
  --dir <path>        扫描根目录（默认仓库 assets/）
  --jobs <n>          普通 URL 并发数（默认 8）
  --jobs-cf <n>       cfwidget 请求并发数（默认 1，串行）
  --cf-delay <ms>     cfwidget 请求间节流毫秒（默认 0）
  --timeout <ms>      单请求超时毫秒（默认 10000）
  --skip-host <host>  跳过特定域名（可重复；github 限流时用）
  --no-curseforge     跳过 projectId / curseforge / cfwidget 类校验
  --offline           不联网，只打印待检清单（供 CI 离线预览）
  --json              输出机器可读 JSON（stdout 仅 JSON）
  --help              显示本帮助

退出码: 0 = 无 BROKEN（UNVERIFIABLE 可存在）; 1 = 存在 BROKEN; 2 = 参数错误或网络整体不可用`

// ---------------- 提取（纯函数，供单测） ----------------

// 全角字符与全角括号必须进终止符（本仓库实测踩坑：`https://.../thaumcraft（projectId`
// 这类全角括号紧跟 URL 的场景，普通半角排除集会把全角内容吞进 URL）
// 占位符模板（如 `https://api.cfwidget.com/minecraft/mc-mods/<slug>`）在提取后整条跳过：
// `<` 不成对出现时（终止符含 `>` 但不含 `<`）正好能被 include('<') 捕获
const URL_RE = /https?:\/\/[^\s（(）)\]}>\x27"\x60，。；：、【】「」]+/g
const CURSE_MAVEN_RE = /curse\.maven:([a-z0-9-]+)-(\d+):(\d+)/g
const PROJECT_ID_RE = /projectId[\s:：*]*(\d+)/g

function splitLines(text) {
  return String(text).split(/\r?\n/)
}

/** 提取全部 http(s) URL，返回 [{ value, line }]（1 起始行号；统一做尾部裁剪 [.,;:)]+$） */
export function extractLinks(text) {
  const out = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    URL_RE.lastIndex = 0
    let m
    while ((m = URL_RE.exec(lines[i])) !== null) {
      let value = m[0].replace(/[.,;:)]+$/, '')
      if (value.includes('<')) continue // 占位符模板（<slug> 等）不是真实链接
      if (value) out.push({ value, line: i + 1 })
    }
  }
  return out
}

/** 提取 curse.maven 坐标，返回 [{ slug, projectId, fileId, text, line }]（fileId 不校验，仅统计） */
export function extractCurseMavenRefs(text) {
  const out = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    CURSE_MAVEN_RE.lastIndex = 0
    let m
    while ((m = CURSE_MAVEN_RE.exec(lines[i])) !== null) {
      out.push({ slug: m[1], projectId: m[2], fileId: m[3], text: m[0], line: i + 1 })
    }
  }
  return out
}

/** 提取裸 projectId 提及（"projectId 223628"、"projectId **223628**" 等），返回 [{ projectId, line }] */
export function extractProjectIds(text) {
  const out = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    PROJECT_ID_RE.lastIndex = 0
    let m
    while ((m = PROJECT_ID_RE.exec(lines[i])) !== null) {
      out.push({ projectId: m[1], line: i + 1 })
    }
  }
  return out
}

// ---------------- 分级 ----------------

/** HTTP 状态 → ok / broken / unverifiable。404/410/5xx=确定性失效；401/403/408/429=无法定论 */
export function classify(status) {
  if (typeof status === 'number' && status >= 200 && status < 400) return 'ok'
  if (status === 401 || status === 403 || status === 408 || status === 429) return 'unverifiable'
  return 'broken'
}

/** cfwidget 结果套 id 断言：expectedId 提供时校验 JSON.id === expectedId（slug↔id 双向核对） */
export function classifyCfResult(result, expectedId) {
  if (expectedId !== undefined && expectedId !== null && result.status === 'ok') {
    const actual = Number(result.id)
    if (!Number.isFinite(actual) || actual !== Number(expectedId)) {
      return {
        ...result,
        status: 'broken',
        httpStatus: 200,
        label: 'id mismatch',
        reason: `cfwidget id=${result.id} != ${expectedId}`,
      }
    }
  }
  return result
}

// ---------------- 请求 ----------------

function errMsg(e) {
  if (!e) return 'unknown'
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout'
  const code = e.cause && e.cause.code ? e.cause.code : ''
  return code ? `${e.name || 'Error'}: ${code}` : (e.message || String(e))
}

async function httpRequest(url, { method = 'GET', headers = {}, timeout = 10000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchImpl(url, { method, headers, signal: controller.signal })
    let body = null
    try { body = await res.text() } catch { /* HEAD 等无 body 场景 */ }
    return { status: res.status, statusText: res.statusText || '', body }
  } catch (e) {
    return { error: e }
  } finally {
    clearTimeout(timer)
  }
}

// Modrinth Maven 仓库根：根路径不提供目录页（404 是预期行为，非失效）。
// 2026-08-16 实测：artifact 路径 `…/maven/modrinth/<slug>/<ver>/<slug>-<ver>.jar` 返回 307 正常解析，
// 仓库功能完好；只有根 `/maven` 无列表页。此类仓库根（build.gradle `url` 字面量）不应误报 BROKEN。
const MODRINTH_MAVEN_ROOT = 'https://api.modrinth.com/maven'

/** 幂等请求失败（网络错误或 5xx）重试 1 次 */
async function withRetry(fn) {
  let r = await fn()
  for (let i = 0; i < 1 && (r.error || r.status >= 500); i++) r = await fn()
  return r
}

/** 普通 URL 校验：HEAD；非 2xx/3xx（含 405/501 拒绝）回退 GET（Range: bytes=0-0）复核 */
export async function checkUrl(url, timeout = 10000, fetchImpl = globalThis.fetch) {
  if (url.replace(/\/$/, '') === MODRINTH_MAVEN_ROOT) {
    return { status: 'ok', httpStatus: null, reason: 'Modrinth Maven 仓库根不提供目录页（artifact 路径实测可解析，根 404 为预期）' }
  }
  const req = (method, headers = {}) => withRetry(() => httpRequest(url, { method, headers, timeout, fetchImpl }))
  let r = await req('HEAD')
  if (!r.error && r.status >= 200 && r.status < 400) {
    return { status: 'ok', httpStatus: r.status, reason: r.statusText || `HTTP ${r.status}` }
  }
  // HEAD 失败（非成功或网络错误）→ GET 复核（maven 目录页 404、405/501 拒 HEAD 等场景）
  const g = await req('GET', { Range: 'bytes=0-0' })
  if (!g.error) {
    const c = classify(g.status)
    return { status: c, httpStatus: g.status, reason: g.statusText || `HTTP ${g.status}` }
  }
  if (r.error) return { status: 'unverifiable', httpStatus: null, reason: `网络错误: ${errMsg(r.error)}` }
  // HEAD 有 HTTP 状态但非成功、GET 网络错 → 按 HEAD 状态定级（404 等确定性失效）
  const c = classify(r.status)
  return { status: c, httpStatus: r.status, reason: r.statusText || `HTTP ${r.status}` }
}

/** cfwidget 校验：query 为完整 URL（api.cfwidget.com 直链）或 slug/数字 ID */
export async function checkCfwidget(query, timeout = 10000, fetchImpl = globalThis.fetch) {
  const url = /^https?:/i.test(String(query))
    ? String(query)
    : `${CFWIDGET_BASE}${encodeURIComponent(String(query))}`
  const r = await withRetry(() => httpRequest(url, { method: 'GET', timeout, fetchImpl }))
  if (r.error) return { status: 'unverifiable', httpStatus: null, reason: `网络错误: ${errMsg(r.error)}` }
  if (r.status === 403 || r.status === 429) {
    return { status: 'unverifiable', httpStatus: r.status, reason: `cfwidget 限流（${r.statusText || r.status}）` }
  }
  if (r.status === 404) return { status: 'broken', httpStatus: 404, reason: 'cfwidget 无此项目（404）' }
  if (r.status !== 200) {
    return { status: 'unverifiable', httpStatus: r.status, reason: `cfwidget HTTP ${r.statusText || r.status}` }
  }
  let json = null
  try { json = JSON.parse(r.body || '') } catch { /* fallthrough */ }
  if (!json || typeof json !== 'object' || !('id' in json)) {
    return { status: 'broken', httpStatus: 200, reason: 'cfwidget 响应无 id 字段' }
  }
  return { status: 'ok', httpStatus: 200, id: json.id, title: json.title ?? '', url: json.url ?? url }
}

// ---------------- 扫描与核对单元 ----------------

function scanMarkdown(dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch (e) {
      throw new Error(`读取目录失败 ${cur}: ${e.message}`)
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const ent of entries) {
      const p = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p)
    }
  }
  return out.sort()
}

/** 判断 URL 类型：cfpage（curseforge 项目页，走 cfwidget slug）/ cfurl（cfwidget 直链）/ plain */
function classifyUrlKind(url) {
  const m = url.match(/^https?:\/\/(?:www\.)?curseforge\.com\/minecraft\/mc-mods\/[^/?#\s]+/)
  if (m) {
    const slug = url.slice(url.indexOf('/minecraft/mc-mods/') + '/minecraft/mc-mods/'.length).split(/[/?#]/)[0]
    return { kind: 'cfpage', slug }
  }
  try {
    if (new URL(url).hostname === 'api.cfwidget.com') return { kind: 'cfurl' }
  } catch { /* fallthrough */ }
  return { kind: 'plain' }
}

function hostOf(url) {
  try { return new URL(url).hostname } catch { return '' }
}

async function runPool(items, worker, jobs) {
  if (items.length === 0) return
  let next = 0
  const n = Math.min(jobs, items.length)
  const runners = []
  for (let i = 0; i < n; i++) {
    runners.push((async () => {
      for (;;) {
        const idx = next++
        if (idx >= items.length) return
        await worker(items[idx], idx)
      }
    })())
  }
  await Promise.all(runners)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---------------- CLI ----------------

export function parseArgs(argv) {
  const opts = {
    dir: null, jobs: 8, jobsCf: 1, cfDelay: 0, timeout: 10000,
    json: false, offline: false, noCurseforge: false, help: false, skipHosts: [],
  }
  const take = (i, name, inline) => {
    if (inline !== undefined) return inline
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`选项 ${name} 缺少参数`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') { opts.help = true; continue }
    if (arg === '--json') { opts.json = true; continue }
    if (arg === '--offline') { opts.offline = true; continue }
    if (arg === '--no-curseforge') { opts.noCurseforge = true; continue }
    const eq = arg.indexOf('=')
    const name = eq >= 0 ? arg.slice(0, eq) : arg
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined
    const num = (s) => {
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) throw new Error(`选项 ${name} 需要非负数字，收到 "${s}"`)
      return n
    }
    switch (name) {
      case '--dir': { const v = take(i, name, inline); if (inline === undefined) i++; opts.dir = v; break }
      case '--jobs': { const v = take(i, name, inline); if (inline === undefined) i++; opts.jobs = Math.max(1, Math.floor(num(v))); break }
      case '--jobs-cf': { const v = take(i, name, inline); if (inline === undefined) i++; opts.jobsCf = Math.max(1, Math.floor(num(v))); break }
      case '--cf-delay': { const v = take(i, name, inline); if (inline === undefined) i++; opts.cfDelay = num(v); break }
      case '--timeout': { const v = take(i, name, inline); if (inline === undefined) i++; opts.timeout = Math.max(100, Math.floor(num(v))); break }
      case '--skip-host': { const v = take(i, name, inline); if (inline === undefined) i++; opts.skipHosts.push(v.toLowerCase()); break }
      default:
        throw new Error(`未知选项 ${arg}`)
    }
  }
  return opts
}

/**
 * 主流程：返回退出码（0 无 BROKEN / 1 有 BROKEN / 2 参数错误或网络整体不可用）。
 * ctx.fetch / ctx.log 可注入（单测用 fake fetch）。
 */
export async function main(argv, ctx = {}) {
  const fetchImpl = ctx.fetch || globalThis.fetch
  const log = ctx.log || console.log
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    log(`参数错误: ${e.message}`)
    log('')
    log(USAGE)
    return 2
  }
  if (opts.help) {
    log(USAGE)
    return 0
  }

  const root = path.resolve(opts.dir || DEFAULT_DIR)
  let files
  try {
    files = scanMarkdown(root)
  } catch (e) {
    log(`check-doc-links ${today()} — 扫描失败: ${e.message}`)
    return 2
  }
  const relPath = (p) => {
    const r = path.relative(process.cwd(), p)
    return r.startsWith('..') ? p : r
  }

  // 提取 + 汇总（去重：同一 URL/projectId 跨文件多处出现只核一次，报告列出全部位置）
  const linkOcc = [] // { file, line, value }
  const coordOcc = [] // { file, line, ...ref }
  const idOcc = [] // { file, line, projectId }
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const r = relPath(f)
    for (const l of extractLinks(text)) linkOcc.push({ file: r, line: l.line, value: l.value })
    for (const c of extractCurseMavenRefs(text)) coordOcc.push({ file: r, line: c.line, ref: c })
    for (const p of extractProjectIds(text)) idOcc.push({ file: r, line: p.line, projectId: p.projectId })
  }

  const units = new Map() // key -> { key, kind, display, query, assertId, locations }
  const addUnit = (key, kind, display, query, assertId, o) => {
    let u = units.get(key)
    if (!u) {
      u = { key, kind, display, query, assertId, locations: [] }
      units.set(key, u)
    }
    u.locations.push(o)
  }
  for (const o of linkOcc) {
    const kind = classifyUrlKind(o.value)
    if (kind.kind === 'cfpage') addUnit(`cfpage:${kind.slug}`, 'cfpage', o.value, kind.slug, undefined, o)
    else if (kind.kind === 'cfurl') addUnit(`cfurl:${o.value}`, 'cfurl', o.value, o.value, undefined, o)
    else addUnit(`url:${o.value}`, 'url', o.value, o.value, undefined, o)
  }
  for (const o of coordOcc) {
    const { slug, projectId, fileId } = o.ref
    addUnit(`cfcoord:${slug}:${projectId}`, 'cfcoord', `curse.maven:${slug}-${projectId}:${fileId}`, slug, projectId, o)
  }
  for (const o of idOcc) {
    addUnit(`cfid:${o.projectId}`, 'cfid', o.projectId, o.projectId, o.projectId, o)
  }

  const byLoc = (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  const linksTotal = linkOcc.length
  const linksUnique = new Set(linkOcc.map((o) => o.value)).size
  const idsTotal = idOcc.length
  const idsUnique = new Set(idOcc.map((o) => o.projectId)).size
  const header = `check-doc-links ${today()} — 扫描 ${files.length} 个 .md，链接 ${linksTotal} 个（去重 ${linksUnique}），projectId ${idsTotal} 个（去重 ${idsUnique}）`

  const fileIdList = coordOcc.map((o) => ({ file: o.file, line: o.line, text: o.ref.text }))
    .sort(byLoc)

  // --offline：只打印待检清单
  if (opts.offline) {
    if (opts.json) {
      log(JSON.stringify({
        date: today(), mode: 'offline',
        summary: { files: files.length, linksTotal, linksUnique, projectIdsTotal: idsTotal, projectIdsUnique: idsUnique },
        pending: [...units.values()].map((u) => ({
          kind: u.kind, url: u.display, file: u.locations[0].file, line: u.locations[0].line,
          locations: u.locations.map((o) => ({ file: o.file, line: o.line })),
        })),
        fileIdsNeedManual: fileIdList,
      }, null, 2))
    } else {
      log(header)
      log('待检清单（--offline，未联网）:')
      for (const u of units.values()) {
        for (const o of u.locations) log(`  ${o.file}:${o.line}  ${u.display}  [${u.kind}]`)
      }
      if (fileIdList.length) {
        log(`需人工确认 fileId（${fileIdList.length} 处）:`)
        for (const f of fileIdList) log(`  ${f.file}:${f.line}  ${f.text}`)
      }
    }
    return 0
  }

  // 执行核对
  const cfUnits = opts.noCurseforge ? [] : [...units.values()].filter((u) => u.kind !== 'url')
  const urlUnits = [...units.values()].filter((u) => u.kind === 'url'
    && !opts.skipHosts.includes(hostOf(u.display)))
  const results = new Map()
  const makeEntry = (u, r) => ({
    kind: u.kind, url: u.display, status: r.status,
    httpStatus: r.httpStatus ?? null, label: r.label ?? null, reason: r.reason ?? '',
    file: u.locations[0].file, line: u.locations[0].line,
    locations: u.locations.map((o) => ({ file: o.file, line: o.line })),
  })

  await runPool(cfUnits, async (u) => {
    if (opts.cfDelay) await sleep(opts.cfDelay)
    const raw = await checkCfwidget(u.query, opts.timeout, fetchImpl)
    results.set(u.key, makeEntry(u, classifyCfResult(raw, u.assertId)))
  }, opts.jobsCf)

  await runPool(urlUnits, async (u) => {
    const raw = await checkUrl(u.display, opts.timeout, fetchImpl)
    results.set(u.key, makeEntry(u, raw))
  }, opts.jobs)

  // 分级与报告
  const broken = [...results.values()].filter((e) => e.status === 'broken').sort(byLoc)
  const unverifiable = [...results.values()].filter((e) => e.status === 'unverifiable').sort(byLoc)
  const fmtEntry = (e) => {
    const tag = e.label ?? e.httpStatus ?? '--'
    const lines = [`  ${e.file}:${e.line}  ${e.url}  [${tag}]  ${e.reason}`]
    for (let i = 1; i < e.locations.length; i++) {
      lines.push(`    （同项另见 ${e.locations[i].file}:${e.locations[i].line}）`)
    }
    return lines.join('\n')
  }

  const networkFailed = [...results.values()]
    .filter((e) => e.status === 'unverifiable' && e.httpStatus === null).length
  let exitCode = 0
  if (broken.length > 0) exitCode = 1
  else if (results.size > 0 && networkFailed === results.size) exitCode = 2

  if (opts.json) {
    log(JSON.stringify({
      date: today(),
      summary: { files: files.length, linksTotal, linksUnique, projectIdsTotal: idsTotal, projectIdsUnique: idsUnique },
      checked: [...results.values()].sort(byLoc),
      ok: [...results.values()].filter((e) => e.status === 'ok').sort(byLoc),
      broken, unverifiable,
      fileIdsNeedManual: fileIdList,
      exitCode,
    }, null, 2))
    return exitCode
  }

  log(header)
  if (broken.length) {
    log(`BROKEN（${broken.length}）:`)
    for (const e of broken) log(fmtEntry(e))
  }
  if (unverifiable.length) {
    log(`UNVERIFIABLE（${unverifiable.length}）:`)
    for (const e of unverifiable) log(fmtEntry(e))
  }
  if (fileIdList.length) {
    log(`需人工确认 fileId（${fileIdList.length} 处）:`)
    for (const f of fileIdList) log(`  ${f.file}:${f.line}  ${f.text}`)
  }
  if (!broken.length && !unverifiable.length) {
    log('无 BROKEN 与 UNVERIFIABLE，全部通过')
  } else if (exitCode === 2) {
    log('全部请求无法建立连接（网络整体不可用），按 exit 2 处理，避免误报')
  }
  return exitCode
}

// 直接运行时才执行（node --test / import 时不跑）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code)
  }).catch((e) => {
    console.error(`check-doc-links 意外错误: ${e && e.stack ? e.stack : e}`)
    process.exit(2)
  })
}
