import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkCfwidget,
  checkUrl,
  classify,
  classifyCfResult,
  extractCurseMavenRefs,
  extractLinks,
  extractProjectIds,
  main,
} from '../scripts/check-doc-links.mjs'

// v0.4: check-doc-links 半自动核对脚本（V04_PLAN §2.5）。全部用例走注入 fake fetch，
// 不联网（真实网络核对只在人工/手动 `npm run check-links` 时发生）。

// fake fetch：routes 为 Map，key = `${METHOD} ${URL}`；值为响应对象或响应数组（顺序取，用于重试场景）
function makeFetch(routes) {
  const counts = new Map()
  return async (url, opts = {}) => {
    const key = `${(opts.method || 'GET').toUpperCase()} ${url}`
    let route = routes.get(key)
    if (Array.isArray(route)) {
      const c = counts.get(key) || 0
      counts.set(key, c + 1)
      route = route[Math.min(c, route.length - 1)]
    }
    if (!route) throw new Error(`fake fetch: 未配置 ${key}`)
    if (route.error) throw route.error
    return {
      status: route.status ?? 200,
      statusText: route.statusText ?? '',
      text: async () => route.body ?? '',
    }
  }
}

function makeFixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-doc-links-'))
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
  return dir
}

test('extractLinks: 全角括号与全角标点必须终止 URL（仓库实测踩坑用例）', () => {
  const text = [
    'CurseForge：https://www.curseforge.com/minecraft/mc-mods/thaumcraft（projectId 223628）',
    '来源 https://api.cfwidget.com/minecraft/mc-mods/thaumcraft',
    '[链接](https://maven.blamejared.com) 与代码 `https://cursemaven.com`',
  ].join('\n')
  const links = extractLinks(text)
  assert.deepEqual(links.map((l) => l.value), [
    'https://www.curseforge.com/minecraft/mc-mods/thaumcraft',
    'https://api.cfwidget.com/minecraft/mc-mods/thaumcraft',
    'https://maven.blamejared.com',
    'https://cursemaven.com',
  ])
  assert.deepEqual(links.map((l) => l.line), [1, 2, 3, 3])
})

test('extractLinks: <slug> 占位符模板不是真实链接（跳过）', () => {
  const text = '到 CurseForge 项目 Files 页（https://www.curseforge.com/minecraft/mc-mods/<slug>/files）\n' +
    '来源 https://api.cfwidget.com/minecraft/mc-mods/<slug> 返回 JSON 的 id 字段'
  const links = extractLinks(text)
  assert.equal(links.length, 0)
})

test('extractLinks: 尾部半角标点裁剪', () => {
  const text = 'a https://example.com/x. 和 https://example.com/y:。以及 https://example.com/z)。'
  const links = extractLinks(text)
  assert.deepEqual(links.map((l) => l.value), [
    'https://example.com/x',
    'https://example.com/y',
    'https://example.com/z',
  ])
})

test('extractCurseMavenRefs: slug/projectId/fileId 分组，<fileId> 占位不匹配', () => {
  const text = [
    'compileOnly "curse.maven:applied-energistics-2-223794:2747063"',
    'compileOnly "curse.maven:thaumcraft-223628:<fileId>"',
    'curse.maven:mekanism-268560:1',
  ].join('\n')
  const refs = extractCurseMavenRefs(text)
  assert.deepEqual(refs, [
    { slug: 'applied-energistics-2', projectId: '223794', fileId: '2747063', text: 'curse.maven:applied-energistics-2-223794:2747063', line: 1 },
    { slug: 'mekanism', projectId: '268560', fileId: '1', text: 'curse.maven:mekanism-268560:1', line: 3 },
  ])
})

test('extractCurseMavenRefs: slug 本身含数字时分词仍正确', () => {
  const [ref] = extractCurseMavenRefs('curse.maven:foo-123-789:456')
  assert.equal(ref.slug, 'foo-123')
  assert.equal(ref.projectId, '789')
  assert.equal(ref.fileId, '456')
})

test('extractProjectIds: 空格/星号/半角冒号/全角冒号写法', () => {
  const text = [
    '（projectId 223628，核实 2026-08-16',
    'projectId **74072**',
    'projectId：225643',
    'projectId: 268560',
    'projectId **241596**',
  ].join('\n')
  const ids = extractProjectIds(text)
  assert.deepEqual(ids.map((i) => i.projectId), ['223628', '74072', '225643', '268560', '241596'])
  assert.deepEqual(ids.map((i) => i.line), [1, 2, 3, 4, 5])
})

test('classify: HTTP 状态分级（ok/broken/unverifiable）', () => {
  assert.equal(classify(200), 'ok')
  assert.equal(classify(204), 'ok')
  assert.equal(classify(302), 'ok')
  assert.equal(classify(404), 'broken')
  assert.equal(classify(410), 'broken')
  assert.equal(classify(400), 'broken')
  assert.equal(classify(500), 'broken')
  assert.equal(classify(502), 'broken')
  assert.equal(classify(401), 'unverifiable')
  assert.equal(classify(403), 'unverifiable')
  assert.equal(classify(429), 'unverifiable')
})

test('checkUrl: HEAD 200 → ok', async () => {
  const fetch = makeFetch(new Map([['HEAD https://example.com/ok', { status: 200 }]]))
  const r = await checkUrl('https://example.com/ok', 5000, fetch)
  assert.equal(r.status, 'ok')
  assert.equal(r.httpStatus, 200)
})

test('checkUrl: Modrinth Maven 仓库根不请求即 ok（根无目录页，404 是预期行为）', async () => {
  const fetch = makeFetch(new Map()) // 任何请求都会 throw —— 证明没有发网络请求
  const r = await checkUrl('https://api.modrinth.com/maven', 5000, fetch)
  assert.equal(r.status, 'ok')
  assert.equal(r.reason.includes('仓库根不提供目录页'), true)
  const r2 = await checkUrl('https://api.modrinth.com/maven/', 5000, fetch)
  assert.equal(r2.status, 'ok')
})

test('checkUrl: HEAD 404 → GET 复核 200 → ok（maven 目录页/拒 HEAD 场景）', async () => {
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/dir', { status: 404 }],
    ['GET https://example.com/dir', { status: 200 }],
  ]))
  const r = await checkUrl('https://example.com/dir', 5000, fetch)
  assert.equal(r.status, 'ok')
})

test('checkUrl: HEAD 405 拒绝 → GET 200 → ok', async () => {
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/x', { status: 405 }],
    ['GET https://example.com/x', { status: 200 }],
  ]))
  const r = await checkUrl('https://example.com/x', 5000, fetch)
  assert.equal(r.status, 'ok')
})

test('checkUrl: HEAD/GET 均 404 → broken', async () => {
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/gone', { status: 404, statusText: 'Not Found' }],
    ['GET https://example.com/gone', { status: 404, statusText: 'Not Found' }],
  ]))
  const r = await checkUrl('https://example.com/gone', 5000, fetch)
  assert.equal(r.status, 'broken')
  assert.equal(r.httpStatus, 404)
  assert.equal(r.reason, 'Not Found')
})

test('checkUrl: 403 → unverifiable（github 反爬限流不误报）', async () => {
  const fetch = makeFetch(new Map([
    ['HEAD https://github.com/a/b', { status: 403, statusText: 'Forbidden' }],
    ['GET https://github.com/a/b', { status: 403, statusText: 'Forbidden' }],
  ]))
  const r = await checkUrl('https://github.com/a/b', 5000, fetch)
  assert.equal(r.status, 'unverifiable')
})

test('checkUrl: 网络错误/超时 → unverifiable（无 httpStatus）', async () => {
  const err = new Error('fetch failed')
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/down', { error: err }],
    ['GET https://example.com/down', { error: err }],
  ]))
  const r = await checkUrl('https://example.com/down', 5000, fetch)
  assert.equal(r.status, 'unverifiable')
  assert.equal(r.httpStatus, null)
})

test('checkUrl: 5xx（重试后仍 5xx）→ broken', async () => {
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/boom', { status: 502 }],
    ['GET https://example.com/boom', { status: 502 }],
  ]))
  const r = await checkUrl('https://example.com/boom', 5000, fetch)
  assert.equal(r.status, 'broken')
})

test('checkCfwidget: slug 查询 → ok，classifyCfResult 双向核对 id', async () => {
  const fetch = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/create', { status: 200, body: JSON.stringify({ id: 328085, title: 'Create' }) }],
  ]))
  const r = await checkCfwidget('create', 5000, fetch)
  assert.equal(r.status, 'ok')
  assert.equal(r.id, 328085)
  assert.equal(classifyCfResult(r, 328085).status, 'ok')
  const mismatch = classifyCfResult(r, '999999')
  assert.equal(mismatch.status, 'broken')
  assert.equal(mismatch.label, 'id mismatch')
  assert.match(mismatch.reason, /328085 != 999999/)
})

test('checkCfwidget: 数字 ID 查询（cfwidget 支持）', async () => {
  const fetch = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/328085', { status: 200, body: JSON.stringify({ id: 328085 }) }],
  ]))
  const r = await checkCfwidget('328085', 5000, fetch)
  assert.equal(r.status, 'ok')
  assert.equal(classifyCfResult(r, 328085).status, 'ok')
})

test('checkCfwidget: 404 → broken；403 限流 → unverifiable', async () => {
  const nf = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/nonexistent', { status: 404 }],
  ]))
  assert.equal((await checkCfwidget('nonexistent', 5000, nf)).status, 'broken')
  const rl = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/x', { status: 403 }],
  ]))
  assert.equal((await checkCfwidget('x', 5000, rl)).status, 'unverifiable')
})

test('checkCfwidget: 200 但响应非 JSON 或无 id 字段 → broken', async () => {
  const html = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/bad1', { status: 200, body: '<html>gateway error</html>' }],
  ]))
  assert.equal((await checkCfwidget('bad1', 5000, html)).status, 'broken')
  const noid = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/bad2', { status: 200, body: JSON.stringify({ title: 'x' }) }],
  ]))
  assert.equal((await checkCfwidget('bad2', 5000, noid)).status, 'broken')
})

test('main: 存在 BROKEN → 退出码 1，报告含 file:line 与全角括号场景', async () => {
  const dir = makeFixtureDir({
    'a.md': [
      '# A',
      '- 项目：https://www.curseforge.com/minecraft/mc-mods/foo（projectId 328085）',
      '- 正常链接 https://example.com/ok',
      '- 失效链接 https://example.com/gone。',
      '- 坐标 curse.maven:foo-328085:11111',
    ].join('\n') + '\n',
    'sub/b.md': [
      '# B',
      '- projectId **999999**（社区流传的错值）',
    ].join('\n') + '\n',
  })
  const fetch = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/foo', { status: 200, body: JSON.stringify({ id: 328085, title: 'Foo' }) }],
    ['GET https://api.cfwidget.com/minecraft/mc-mods/328085', { status: 200, body: JSON.stringify({ id: 328085 }) }],
    ['GET https://api.cfwidget.com/minecraft/mc-mods/999999', { status: 404 }],
    ['HEAD https://example.com/ok', { status: 200 }],
    ['HEAD https://example.com/gone', { status: 404, statusText: 'Not Found' }],
    ['GET https://example.com/gone', { status: 404, statusText: 'Not Found' }],
  ]))
  const logs = []
  const code = await main(['--dir', dir], { fetch, log: (s) => logs.push(s) })
  assert.equal(code, 1)
  const out = logs.join('\n')
  assert.match(out, /扫描 2 个 \.md/)
  assert.match(out, /BROKEN（2）:/)
  assert.match(out, /example\.com\/gone/)
  assert.match(out, /999999/)
  assert.match(out, /\[404\]/)
  assert.match(out, /需人工确认 fileId（1 处）/)
  assert.match(out, /curse\.maven:foo-328085:11111/)
  rmSync(dir, { recursive: true, force: true })
})

test('main: 全绿 → 退出码 0', async () => {
  const dir = makeFixtureDir({
    'ok.md': [
      '# OK',
      '- https://example.com/ok 与 https://maven.example.com/repo',
      '- projectId 223628',
    ].join('\n') + '\n',
  })
  const fetch = makeFetch(new Map([
    ['GET https://api.cfwidget.com/minecraft/mc-mods/223628', { status: 200, body: JSON.stringify({ id: 223628 }) }],
    ['HEAD https://example.com/ok', { status: 200 }],
    ['HEAD https://maven.example.com/repo', { status: 200 }],
  ]))
  const logs = []
  const code = await main(['--dir', dir], { fetch, log: (s) => logs.push(s) })
  assert.equal(code, 0)
  assert.match(logs.join('\n'), /全部通过/)
  rmSync(dir, { recursive: true, force: true })
})

test('main: 仅 UNVERIFIABLE（403 限流）→ 退出码 0', async () => {
  const dir = makeFixtureDir({ 'u.md': '- https://github.com/some/repo\n' })
  const fetch = makeFetch(new Map([
    ['HEAD https://github.com/some/repo', { status: 403, statusText: 'Forbidden' }],
    ['GET https://github.com/some/repo', { status: 403, statusText: 'Forbidden' }],
  ]))
  const code = await main(['--dir', dir], { fetch, log: () => {} })
  assert.equal(code, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('main: 网络整体不可用 → 退出码 2（避免误报）', async () => {
  const dir = makeFixtureDir({ 'n.md': '- https://example.com/down\n' })
  const err = new Error('fetch failed')
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/down', { error: err }],
    ['GET https://example.com/down', { error: err }],
  ]))
  const code = await main(['--dir', dir], { fetch, log: () => {} })
  assert.equal(code, 2)
  rmSync(dir, { recursive: true, force: true })
})

test('main: 参数错误 → 2；--help → 0 并打印用法', async () => {
  assert.equal(await main(['--bogus'], { fetch: makeFetch(new Map()), log: () => {} }), 2)
  const logs = []
  assert.equal(await main(['--help'], { log: (s) => logs.push(s) }), 0)
  assert.match(logs.join('\n'), /用法:/)
})

test('main: --json 去重后 checked 含全部 file:line 位置', async () => {
  const dir = makeFixtureDir({
    'x.md': '- https://example.com/dup\n',
    'y.md': '- https://example.com/dup 再见\n',
  })
  const fetch = makeFetch(new Map([
    ['HEAD https://example.com/dup', { status: 200 }],
  ]))
  const logs = []
  const code = await main(['--dir', dir, '--json'], { fetch, log: (s) => logs.push(s) })
  assert.equal(code, 0)
  const json = JSON.parse(logs.join('\n'))
  assert.equal(json.checked.length, 1)
  assert.equal(json.checked[0].locations.length, 2)
  assert.equal(json.checked[0].status, 'ok')
  assert.equal(json.exitCode, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('main: --offline 不联网只列待检清单', async () => {
  const dir = makeFixtureDir({ 'o.md': '- https://example.com/x\n- projectId 123\n' })
  const logs = []
  const code = await main(['--dir', dir, '--offline'], {
    fetch: () => { throw new Error('不应联网') },
    log: (s) => logs.push(s),
  })
  assert.equal(code, 0)
  assert.match(logs.join('\n'), /待检清单/)
  rmSync(dir, { recursive: true, force: true })
})

test('main: --skip-host 跳过指定域名（不请求）', async () => {
  const dir = makeFixtureDir({ 's.md': '- https://github.com/a/b\n' })
  const logs = []
  const code = await main(['--dir', dir, '--skip-host', 'github.com'], {
    fetch: () => { throw new Error('不应联网') },
    log: (s) => logs.push(s),
  })
  assert.equal(code, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('main: --no-curseforge 跳过 projectId 类校验', async () => {
  const dir = makeFixtureDir({ 'c.md': '- projectId 999999 与 https://www.curseforge.com/minecraft/mc-mods/whatever\n' })
  const logs = []
  const code = await main(['--dir', dir, '--no-curseforge'], {
    fetch: () => { throw new Error('不应联网') },
    log: (s) => logs.push(s),
  })
  assert.equal(code, 0)
  rmSync(dir, { recursive: true, force: true })
})
