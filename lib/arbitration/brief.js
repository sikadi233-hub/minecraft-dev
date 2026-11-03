/**
 * Stage 2 detail: **the shard brief**.
 *
 * Every worker gets the same first two blocks and its own third block:
 *
 * 1. the global rules (what a Minecraft worker may and may not do);
 * 2. the frozen contract, serialized canonically;
 * 3. this shard's task.
 *
 * The first two blocks are byte-identical across shards, which is what makes the
 * prompts prefix-cache friendly at the provider and what {@link prefixHash}
 * proves. That is the only part of the original "80% shared prefix" idea that a
 * plugin can actually control — cache hit rates live on the provider side.
 *
 * @module minecraft-dev/lib/arbitration/brief
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arbitrationPaths, ensureDir } from './paths.js'
import { canonicalJson, hashOf } from './contract.js'

/** Block 1: the global rules every shard worker receives verbatim. */
export const GLOBAL_RULES = `You are a shard worker on a Minecraft project. Work only inside the files listed for your shard.

Rules (non-negotiable):
1. Never edit the main class, plugin.yml / fabric.mod.json / mods.toml, build.gradle(.kts) or any file another shard owns. Declare what you need in RegistrationManifest.json instead.
2. Implement the frozen interfaces; do not change their signatures, package names or DTO shapes. If the contract is wrong, stop and report it — do not patch around it.
3. Signatures must come from the bundled API index for this exact line (references/api-index/<version>.md) or the official documentation. Never write an API signature from memory.
4. Keep the event-handler thread rules: no blocking I/O in handlers, no Bukkit API inside async tasks, do not cancel at MONITOR.
5. Stay on the platform's Java level; do not use syntax newer than the project's toolchain.
6. At the end, write RegistrationManifest.json with every dependency, listener, command, permission, lifecycle statement and config default your code needs.`

/**
 * Build the canonical contract block.
 *
 * Only contract-owned data goes in, never shard data: two shards must hash the
 * same value.
 * @param {object} contract - frozen contract.
 * @returns {string} canonical JSON text.
 */
export function contractBlock(contract) {
  return canonicalJson({
    version: contract.version,
    platform: contract.platform,
    minecraftVersion: contract.minecraftVersion,
    javaVersion: contract.javaVersion,
    packageName: contract.packageName,
    modules: contract.modules,
    symbols: contract.symbols,
    constants: contract.constants,
    eventPriority: contract.eventPriority,
    apiAllowlist: contract.apiAllowlist,
  })
}

/** sha256 of the shared prefix (block 1 + block 2). */
export function prefixHash(block1, block2) {
  return hashOf(`${block1}\n\n${block2}`)
}

/**
 * Render the third block: this shard's task.
 * @param {object} options - contract, shard id, module.
 * @returns {string} markdown task text.
 */
export function shardTaskBlock({ contract, shard, module }) {
  const short = shard.replace(/-shard$/, '')
  const scope = `${contract.packageName}.shard.${short.replace(/-/g, '')}`
  const typeName = `${short.split(/[-_]/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('')}Service`
  const lines = [
    `## Your shard: ${shard}`,
    '',
    `Package scope: \`${scope}\` — put every file under \`src/main/java/${scope.split('.').join('/')}/\`.`,
    '',
    'Implement the frozen interface:',
  ]
  if (module?.interface) lines.push(`- \`${module.interface}\` (${typeName})`)
  if (module?.methods?.length) {
    lines.push('', 'Frozen methods:', '')
    for (const method of module.methods) lines.push(`- \`${method}\``)
  }
  if (module?.dto?.length) {
    lines.push('', 'DTOs already frozen for this module:', '')
    for (const dto of module.dto) lines.push(`- \`${dto}\``)
  }
  lines.push(
    '',
    'Deliverables:',
    `1. The implementation class(es) in \`${scope}\`.`,
    '2. RegistrationManifest.json in this shard directory, with every registration your code needs.',
    '3. Nothing under any shared path (main class, metadata, build script, other shards\' packages).',
    '',
    'Acceptance: the merge applies your manifest without conflicts, the audited rules pass, and the project compiles.',
  )
  return lines.join('\n')
}

/**
 * Build a shard brief.
 * @param {object} options - projectDir, shard, contract, write (default true).
 * @returns {{ shard: string, prompt: string, block1Hash: string, block2Hash: string, prefixHash: string, path?: string }} brief.
 */
export function buildBrief({ projectDir, shard, contract, write = true }) {
  const module = (contract.modules ?? []).find(entry => entry.id === shard)
  if (!module) throw new Error(`shard ${shard} is not part of the frozen contract`)
  const block1 = GLOBAL_RULES
  const block2 = contractBlock(contract)
  const block3 = shardTaskBlock({ contract, shard, module })
  const prompt = `${block1}\n\n${block2}\n\n${block3}\n`
  const brief = {
    shard,
    prompt,
    block1Hash: hashOf(block1),
    block2Hash: hashOf(block2),
    prefixHash: prefixHash(block1, block2),
    block3Hash: hashOf(block3),
  }
  if (!write) return brief
  const path = join(arbitrationPaths(projectDir).shardDir(shard), 'BRIEF.md')
  ensureDir(join(path, '..'))
  writeFileSync(path, `<!-- block1=${brief.block1Hash} block2=${brief.block2Hash} prefix=${brief.prefixHash} -->\n\n${prompt}`, 'utf8')
  return { ...brief, path }
}

/**
 * Prefix fingerprints for every shard, for the status report and the tests.
 * @param {object} options - projectDir, contract.
 * @returns {{ shards: object[], sharedPrefix: boolean }} fingerprints.
 */
export function prefixFingerprints({ projectDir, contract }) {
  const shards = (contract.modules ?? []).map(module => {
    const brief = buildBrief({ projectDir, shard: module.id, contract, write: false })
    return { shard: module.id, prefixHash: brief.prefixHash, block3Hash: brief.block3Hash }
  })
  const prefixes = new Set(shards.map(shard => shard.prefixHash))
  return { shards, sharedPrefix: prefixes.size === 1 }
}
