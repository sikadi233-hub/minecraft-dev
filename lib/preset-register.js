/**
 * Which preset form the running dsh understands.
 *
 * dsh 0.1.5/0.1.6 discovers presets as directories under the harness home;
 * dsh 0.1.7 replaced that with `@deepseek-ai/dsh-agent-preset` declarations
 * handed to the `agentPresets` service's `register()` method. A plugin has to
 * pick the right form at runtime, because one npm package serves both lines.
 *
 * The discriminator is `register` itself, not the service: 0.1.5 also publishes
 * a preset service (a different class with mount/list/authoring methods), so
 * "the service exists" answers the wrong question.
 *
 * This module is deliberately free of dsh imports so it can be unit-tested
 * outside a profile.
 * @module minecraft-dev/lib/preset-register
 */

/**
 * Whether a registry object can declare a preset programmatically.
 * @param {unknown} registry - the value read from `ctx.get('agentPresets')`.
 * @returns {boolean} true when `register(definition)` is available.
 */
export function hasPresetRegistry(registry) {
  return registry !== null
    && typeof registry === 'object'
    && typeof (/** @type {{ register?: unknown }} */ (registry)).register === 'function'
}

/**
 * Declare every preset through the registry, if the host has one.
 *
 * `register()` returns a promise of a disposer, and Cordis accepts exactly that
 * as an effect body, so each declaration shares the plugin fiber's lifetime:
 * unloading the plugin withdraws both presets.
 *
 * A failure is logged, never thrown: one unusable preset must not stop the
 * other, and none of them may take the boot down.
 * @param {object} options
 * @param {unknown} options.registry - the value read from `ctx.get('agentPresets')`.
 * @param {Array<{ id: string, plugins: unknown[] }>} options.definitions - presets to declare.
 * @param {(body: () => unknown) => unknown} options.effect - `ctx.effect`.
 * @param {{ info: Function, warn: Function }} options.logger - log sink.
 * @returns {boolean} true when the registry path was taken (so the caller must
 *   not fall back to the directory install).
 */
export function registerPresetDefinitions({ registry, definitions, effect, logger }) {
  if (!hasPresetRegistry(registry)) return false
  for (const definition of definitions) {
    try {
      effect(() => (/** @type {{ register: Function }} */ (registry)).register(definition))
      logger.info(`minecraft-preset: registered agent preset '${definition.id}' (${definition.plugins.length} rows)`)
    } catch (error) {
      logger.warn(`minecraft-preset: could not register agent preset '${definition.id}': ${error.message}`)
    }
  }
  return true
}
