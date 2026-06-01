/**
 * NestJS injection tokens for `@bymax-one/nest-cache`.
 *
 * Layer: server. All tokens are `Symbol`-based to guarantee uniqueness across
 * the NestJS DI graph — two consumers cannot collide on the same token by
 * accident, and a string typo cannot resolve a foreign provider. Mirrors the
 * pattern established by `@bymax-one/nest-auth` and `@bymax-one/nest-logger`.
 */

/** Resolved module options (connection, namespace, events, scripts). */
export const BYMAX_CACHE_OPTIONS = Symbol('BYMAX_CACHE_OPTIONS')

/**
 * The connection manager holding the singleton ioredis client. Consumers can
 * call `.getClient()` on the injected value to access the raw client. Wired as
 * `useExisting: ConnectionManager` so it resolves to the same instance.
 */
export const BYMAX_CACHE_CONNECTION = Symbol('BYMAX_CACHE_CONNECTION')

/** Registry of preloaded Lua scripts (name → SHA). */
export const BYMAX_CACHE_SCRIPT_REGISTRY = Symbol('BYMAX_CACHE_SCRIPT_REGISTRY')

/** Optional consumer-supplied connection-event callback bag (`ICacheEvents`). */
export const BYMAX_CACHE_EVENTS = Symbol('BYMAX_CACHE_EVENTS')

/** The value serializer (`ISerializer`; defaults to `JsonSerializer`). Injectable so consumers can override it. */
export const BYMAX_CACHE_SERIALIZER = Symbol('BYMAX_CACHE_SERIALIZER')

/** The key builder that composes `{namespace}{sep}{prefix}{sep}{id}`. */
export const BYMAX_CACHE_KEY_BUILDER = Symbol('BYMAX_CACHE_KEY_BUILDER')
