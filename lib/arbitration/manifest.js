// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 sikadi233 (https://github.com/sikadi233-hub/minecraft-dev)

/**
 * Stage 2 of the sharded pipeline: the **registration manifest**.
 *
 * A shard worker writes code, but it does not touch the main class, the build
 * script or the plugin metadata. Everything the project must do for that shard
 * — dependencies, lifecycle statements, listeners, commands, permissions,
 * config defaults — is declared in `RegistrationManifest.json` and applied once,
 * deterministically, by the merge step. That split is what makes parallel shards
 * safe: two workers can never edit the same shared file.
 *
 * This module owns the schema and the cross-shard conflict rules. It is pure
 * (no filesystem): the merge step reads the files and hands the parsed objects
 * here, which keeps the rules unit-testable.
 *
 * @module minecraft-dev/lib/arbitration/manifest
 */

/** File name every shard must produce. */
export const MANIFEST_NAME = 'RegistrationManifest.json'

/** Schema version for the manifest itself. */
export const MANIFEST_VERSION = 1

/** Dependency scopes a shard may declare. */
export const DEPENDENCY_SCOPES = ['compile', 'runtime', 'compileOnly', 'test']

/** Permission defaults Bukkit accepts. */
export const PERMISSION_DEFAULTS = ['true', 'false', 'op', 'not op']

/** Files a shard may never own, matched on the basename. */
const DENIED_BASENAMES = [
  /^plugin\.yml$/i,
  /^build\.gradle(\.kts)?$/i,
  /^settings\.gradle(\.kts)?$/i,
  /^gradle\.properties$/i,
  /^fabric\.mod\.json$/i,
  /^mods\.toml$/i,
  /^neoforge\.mods\.toml$/i,
  /^mcmod\.info$/i,
  /^pack\.mcmeta$/i,
]

const KEBAB = /^[a-z][a-z0-9-]*$/
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
// Package segments are lowercase; class segments are CamelCase by convention.
const FQCN = /^[a-z][a-z0-9_]*(\.[A-Za-z_$][\w$]*)+$/
const COMMAND_NAME = /^[a-z0-9][a-z0-9-]*$/
const PERMISSION_NODE = /^[a-z0-9][a-z0-9._-]*$/
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*:\/\/)[A-Za-z0-9._\-/]+\.[A-Za-z0-9]+$/

/**
 * A blank manifest for a shard, useful for fixtures and for `brief` output.
 * @param {string} shardId - kebab-case shard id.
 * @returns {object} empty manifest skeleton.
 */
export function emptyManifest(shardId) {
  return {
    version: MANIFEST_VERSION,
    shardId,
    packageScope: '',
    ownedFiles: [],
    mavenDependencies: [],
    lifecycleHooks: { onEnablePriority: 50, initStatements: [], onDisableStatements: [] },
    bukkitRegistrations: { listeners: [], commands: [], permissions: [] },
    configDefaults: {},
    modMetadata: {},
    mainClassFields: [],
  }
}

/** Whether a path is one of the shared files a shard must not own. */
export function isDeniedFile(relativePath) {
  const base = String(relativePath).split('/').pop() ?? ''
  return DENIED_BASENAMES.some(pattern => pattern.test(base))
}

/**
 * Validate one parsed manifest.
 *
 * Collects every problem instead of throwing on the first one: a worker that
 * violated two rules should hear about both in the same audit round.
 * @param {unknown} raw - parsed JSON.
 * @param {object} [options] - `contract` (to check the shard id and package) and `strict`.
 * @returns {{ ok: boolean, errors: { path: string, message: string }[], value: object|null }} verdict.
 */
export function validateManifest(raw, options = {}) {
  const errors = []
  const fail = (path, message) => errors.push({ path, message })
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

  if (!isObject(raw)) return { ok: false, errors: [{ path: '', message: 'manifest must be a JSON object' }], value: null }

  const known = new Set(Object.keys(emptyManifest('x')))
  if (options.strict !== false) {
    for (const key of Object.keys(raw)) if (!known.has(key)) fail(key, `unknown manifest key ${JSON.stringify(key)}`)
  }

  const shardId = raw.shardId
  if (typeof shardId !== 'string' || !KEBAB.test(shardId)) fail('shardId', 'shardId must be kebab-case, e.g. storage-shard')
  else if (options.contract && !(options.contract.modules ?? []).some(module => module.id === shardId)) {
    fail('shardId', `shard ${shardId} is not part of the frozen contract`)
  }

  const packageScope = raw.packageScope
  if (typeof packageScope !== 'string' || !PACKAGE.test(packageScope)) fail('packageScope', 'packageScope must be a dotted java package, e.g. com.example.plugin.shard.storage')

  const ownedFiles = Array.isArray(raw.ownedFiles) ? raw.ownedFiles : null
  if (!ownedFiles) fail('ownedFiles', 'ownedFiles must be an array of project-relative paths')
  else {
    if (ownedFiles.length === 0) fail('ownedFiles', 'a shard must own at least one file')
    const scopePath = typeof packageScope === 'string' && PACKAGE.test(packageScope) ? packageScope.split('.').join('/') : null
    const seen = new Set()
    for (const [index, file] of ownedFiles.entries()) {
      const at = `ownedFiles[${index}]`
      if (typeof file !== 'string' || !RELATIVE_PATH.test(file)) { fail(at, 'must be a project-relative path (no leading slash, no .., no URL)'); continue }
      if (seen.has(file)) fail(at, `duplicate owned file ${file}`)
      seen.add(file)
      if (isDeniedFile(file)) fail(at, `shards must not own shared file ${file}; declare it in the manifest instead`)
      if (scopePath && !file.includes(scopePath)) fail(at, `owned file ${file} is outside packageScope ${packageScope}`)
    }
  }

  const deps = Array.isArray(raw.mavenDependencies) ? raw.mavenDependencies : null
  if (!deps) fail('mavenDependencies', 'mavenDependencies must be an array (use [] when none)')
  else {
    for (const [index, dep] of deps.entries()) {
      const at = `mavenDependencies[${index}]`
      if (!isObject(dep)) { fail(at, 'dependency must be an object'); continue }
      for (const key of ['group', 'name', 'version']) {
        if (typeof dep[key] !== 'string' || dep[key].trim() === '') fail(`${at}.${key}`, `${key} must be a non-empty string`)
      }
      if (dep.scope !== undefined && !DEPENDENCY_SCOPES.includes(dep.scope)) fail(`${at}.scope`, `scope must be one of ${DEPENDENCY_SCOPES.join(', ')}`)
      for (const key of Object.keys(dep)) if (!['group', 'name', 'version', 'scope'].includes(key)) fail(`${at}.${key}`, 'unknown dependency field')
    }
  }

  const hooks = isObject(raw.lifecycleHooks) ? raw.lifecycleHooks : null
  if (!hooks) fail('lifecycleHooks', 'lifecycleHooks must be an object')
  else {
    const priority = hooks.onEnablePriority
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 100)) {
      fail('lifecycleHooks.onEnablePriority', 'onEnablePriority must be an integer between 0 and 100')
    }
    for (const key of ['initStatements', 'onDisableStatements']) {
      const list = hooks[key]
      if (list === undefined) continue
      if (!Array.isArray(list)) { fail(`lifecycleHooks.${key}`, 'must be an array of single-line statements'); continue }
      for (const [index, statement] of list.entries()) {
        const at = `lifecycleHooks.${key}[${index}]`
        if (typeof statement !== 'string' || statement.trim() === '') fail(at, 'statement must be a non-empty string')
        else if (/[\r\n]/.test(statement)) fail(at, 'statement must stay on one line; the merge indents it into the main class')
      }
    }
  }

  const registrations = isObject(raw.bukkitRegistrations) ? raw.bukkitRegistrations : null
  if (!registrations) fail('bukkitRegistrations', 'bukkitRegistrations must be an object')
  else {
    const listeners = registrations.listeners ?? []
    if (!Array.isArray(listeners)) fail('bukkitRegistrations.listeners', 'must be an array of class names')
    else for (const [index, listener] of listeners.entries()) {
      if (typeof listener !== 'string' || !FQCN.test(listener)) fail(`bukkitRegistrations.listeners[${index}]`, 'listener must be a fully-qualified class name')
    }
    const commands = registrations.commands ?? []
    if (!Array.isArray(commands)) fail('bukkitRegistrations.commands', 'must be an array')
    else for (const [index, command] of commands.entries()) {
      const at = `bukkitRegistrations.commands[${index}]`
      if (!isObject(command)) { fail(at, 'command must be an object'); continue }
      if (typeof command.name !== 'string' || !COMMAND_NAME.test(command.name)) fail(`${at}.name`, 'command name must be lowercase kebab-case')
      if (typeof command.class !== 'string' || !FQCN.test(command.class)) fail(`${at}.class`, 'command class must be a fully-qualified class name')
      if (command.permission !== undefined && (typeof command.permission !== 'string' || !PERMISSION_NODE.test(command.permission))) {
        fail(`${at}.permission`, 'permission must be a dotted lowercase node')
      }
    }
    const permissions = registrations.permissions ?? []
    if (!Array.isArray(permissions)) fail('bukkitRegistrations.permissions', 'must be an array')
    else for (const [index, permission] of permissions.entries()) {
      const at = `bukkitRegistrations.permissions[${index}]`
      if (!isObject(permission)) { fail(at, 'permission must be an object'); continue }
      if (typeof permission.node !== 'string' || !PERMISSION_NODE.test(permission.node)) fail(`${at}.node`, 'permission node must be dotted lowercase')
      if (permission.default !== undefined && !PERMISSION_DEFAULTS.includes(String(permission.default).toLowerCase())) {
        fail(`${at}.default`, `default must be one of ${PERMISSION_DEFAULTS.join(', ')}`)
      }
    }
  }

  const fields = raw.mainClassFields
  if (fields !== undefined) {
    if (!Array.isArray(fields)) fail('mainClassFields', 'must be an array of { type, name }')
    else {
      const seen = new Set()
      for (const [index, field] of fields.entries()) {
        const at = `mainClassFields[${index}]`
        if (!isObject(field)) { fail(at, 'field must be an object'); continue }
        if (typeof field.type !== 'string' || !/^[A-Za-z_$][\w$.<>\[\], ?]*$/.test(field.type)) fail(`${at}.type`, 'type must be a Java type')
        if (typeof field.name !== 'string' || !/^[a-z][A-Za-z0-9_]*$/.test(field.name)) fail(`${at}.name`, 'name must be a lower camelCase identifier')
        else if (seen.has(field.name)) fail(`${at}.name`, `duplicate field ${field.name}`)
        else seen.add(field.name)
      }
    }
  }

  const modMetadata = raw.modMetadata
  if (modMetadata !== undefined && (modMetadata === null || typeof modMetadata !== 'object' || Array.isArray(modMetadata))) {
    fail('modMetadata', 'must be an object merged into fabric.mod.json / mcmod.info')
  }

  const configDefaults = raw.configDefaults
  if (configDefaults !== undefined) {
    if (!isObject(configDefaults)) fail('configDefaults', 'must be an object')
    else for (const [key, value] of Object.entries(configDefaults)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) fail(`configDefaults.${key}`, 'value must be a string, number, or boolean')
    }
  }

  return { ok: errors.length === 0, errors, value: errors.length === 0 ? normalizeManifest(raw) : null }
}

/** Apply defaults to a validated manifest. */
export function normalizeManifest(raw) {
  return {
    version: MANIFEST_VERSION,
    shardId: raw.shardId,
    packageScope: raw.packageScope,
    ownedFiles: [...raw.ownedFiles],
    mavenDependencies: (raw.mavenDependencies ?? []).map(dep => ({
      group: dep.group.trim(),
      name: dep.name.trim(),
      version: dep.version.trim(),
      scope: dep.scope ?? 'compile',
    })),
    lifecycleHooks: {
      onEnablePriority: raw.lifecycleHooks?.onEnablePriority ?? 50,
      initStatements: [...(raw.lifecycleHooks?.initStatements ?? [])],
      onDisableStatements: [...(raw.lifecycleHooks?.onDisableStatements ?? [])],
    },
    bukkitRegistrations: {
      listeners: [...(raw.bukkitRegistrations?.listeners ?? [])],
      commands: (raw.bukkitRegistrations?.commands ?? []).map(command => ({ ...command })),
      permissions: (raw.bukkitRegistrations?.permissions ?? []).map(permission => ({ ...permission })),
    },
    configDefaults: { ...(raw.configDefaults ?? {}) },
    modMetadata: { ...(raw.modMetadata ?? {}) },
    mainClassFields: (raw.mainClassFields ?? []).map(field => ({ type: field.type.trim(), name: field.name })),
  }
}

/**
 * Cross-shard conflicts the merge must report instead of silently resolving.
 *
 * Ownership overlap is a hard error (two shards editing one file is exactly what
 * the protocol forbids); a duplicated command name is a conflict the host must
 * resolve, because either could be the intended owner.
 * @param {{ shardId: string, manifest: object }[]} entries - validated manifests.
 * @returns {{ ownedFiles: object[], commands: object[], permissions: object[], dependencies: object[] }} conflicts.
 */
export function crossValidate(entries) {
  const ownedBy = new Map()
  const commandBy = new Map()
  const permissionBy = new Map()
  const conflicts = { ownedFiles: [], commands: [], permissions: [], dependencies: [] }

  for (const { shardId, manifest } of entries) {
    for (const file of manifest.ownedFiles) {
      if (ownedBy.has(file)) conflicts.ownedFiles.push({ file, shards: [ownedBy.get(file), shardId] })
      else ownedBy.set(file, shardId)
    }
    for (const command of manifest.bukkitRegistrations.commands) {
      if (commandBy.has(command.name)) {
        conflicts.commands.push({ name: command.name, shards: [commandBy.get(command.name), shardId], kept: commandBy.get(command.name) })
      } else commandBy.set(command.name, shardId)
    }
    for (const permission of manifest.bukkitRegistrations.permissions) {
      const previous = permissionBy.get(permission.node)
      if (previous && String(previous.default ?? 'op').toLowerCase() !== String(permission.default ?? 'op').toLowerCase()) {
        conflicts.permissions.push({ node: permission.node, shards: [previous.shard, shardId], defaults: [previous.default, permission.default] })
      } else if (!previous) {
        permissionBy.set(permission.node, { shard: shardId, default: permission.default })
      }
    }
  }
  return conflicts
}
