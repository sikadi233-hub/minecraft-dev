// Verify the published 0.12.12 artefact end to end: registry metadata, byte
// identity with the local tarball, and the contents the release claims.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VERSION = '0.12.12'
const BASE = 'https://registry.npmjs.org/minecraft-dev'
const log = line => console.log(`  ${line}`)

const get = async url => {
  for (let i = 0; i < 20; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (response.status === 200) return response
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  return null
}

let manifest = null
for (let i = 0; i < 40 && !manifest; i += 1) {
  const response = await get(`${BASE}/${VERSION}`)
  if (response) manifest = await response.json()
  else log('not visible yet')
}
if (!manifest) { log('NEVER APPEARED'); process.exit(3) }

const doc = await (await get(BASE)).json()
log(`version=${manifest.version} shasum=${manifest.dist.shasum} files=${manifest.dist.fileCount} latest=${doc['dist-tags'].latest}`)
log(`unpacked=${(manifest.dist.unpackedSize / 1048576).toFixed(1)} MB  license=${manifest.license}`)

const local = readFileSync('minecraft-dev-0.12.12.tgz')
const localSha = createHash('sha1').update(local).digest('hex')
log(`local sha1=${localSha}  match=${localSha === manifest.dist.shasum}`)

const response = await get(manifest.dist.tarball)
if (!response) { log('tarball download failed'); process.exit(4) }
const buffer = Buffer.from(await response.arrayBuffer())
const dir = mkdtempSync(join(tmpdir(), 'pub-01212-'))
writeFileSync(join(dir, 'p.tgz'), buffer)
await new Promise((resolve, reject) => {
  const child = spawn('tar', ['-xzf', join(dir, 'p.tgz'), '-C', dir], { stdio: 'ignore' })
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(`tar ${code}`))))
})
const root = join(dir, 'package')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
log(`published version=${pkg.version} license=${pkg.license} author=${pkg.author}`)

const read = path => readFileSync(join(root, path), 'utf8')
const license = read('LICENSE')
const notice = read('NOTICE')
log(`LICENSE ${statSync(join(root, 'LICENSE')).size}B apache=${/Apache License/.test(license) && /Version 2\.0, January 2004/.test(license)}`)
log(`NOTICE 4(d)=${/Section 4\(d\) of the Apache License/.test(notice)} sharded=${/Sharded Execution/.test(notice)}`)

const modules = readdirSync(join(root, 'lib', 'arbitration')).filter(name => name.endsWith('.js'))
const audit = read('lib/arbitration/audit.js')
const ruleIds = [...audit.matchAll(/\{ id: '([a-z0-9-]+)', severity:/g)].map(match => match[1])
const cross = ruleIds.filter(id => ['listener-declared-twice', 'duplicate-enable-priority', 'init-order-violation', 'command-permission-unregistered', 'field-type-unresolved'].includes(id))
log(`arbitration modules=${modules.length}  rules=${ruleIds.length}  cross=${cross.length}`)

const tools = read('tools.js')
log(`mc_arbitrate registered=${/name: 'mc_arbitrate'/.test(tools)}  extraAllowlist=${/extraAllowlist/.test(tools)}`)

let indexes = 0
const walk = (path) => {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`
    if (entry.isDirectory()) walk(child)
    else if (/api-index\/\d.*\.md$/.test(child)) indexes += 1
  }
}
walk('assets/skills')
log(`api-index files=${indexes}`)
log(`swarm skill=${readdirSync(join(root, 'assets', 'skills')).includes('minecraft-swarm')}`)

const ok = pkg.version === VERSION
  && localSha === manifest.dist.shasum
  && /Apache License/.test(license)
  && /Section 4\(d\) of the Apache License/.test(notice)
  && ruleIds.length === 21
  && cross.length === 5
  && modules.length === 13
  && /name: 'mc_arbitrate'/.test(tools)
  && indexes >= 18
rmSync(dir, { recursive: true, force: true })
log(ok ? 'PUBLISHED 0.12.12 VERIFIED' : 'PROBLEM FOUND')
process.exit(ok ? 0 : 5)
