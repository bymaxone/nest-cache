/**
 * Default namespace and key-separator values.
 *
 * Layer: server. Applied by `applyDefaults` when the consumer omits the
 * corresponding option. Kept separate from timeout defaults so each concern has
 * a single, greppable home.
 */

/** Default global namespace when the consumer does not override it. */
export const DEFAULT_NAMESPACE = 'app' as const

/** Default separator between namespace/prefix/id segments. */
export const DEFAULT_KEY_SEPARATOR = ':' as const
