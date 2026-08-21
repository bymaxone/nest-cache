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

/**
 * The port Redis listens on when a connection URL does not name one.
 *
 * Shared by the URL parser that builds connect options and by the admin surface
 * that reports the effective endpoint, so the two cannot drift into disagreeing
 * about where this deployment actually connects.
 */
export const DEFAULT_REDIS_PORT = 6379
