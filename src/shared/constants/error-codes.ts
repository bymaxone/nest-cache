/**
 * Canonical cache error codes for `@bymax-one/nest-cache`.
 *
 * Layer: shared — zero-dependency, importable in any runtime (browser, edge,
 * Node). The server subpath's `CacheException` maps these codes to messages and
 * HTTP statuses.
 */

/**
 * String error codes thrown by the cache library, namespaced under `cache.`.
 *
 * Append-only: new codes may be added, but existing values must never be
 * renamed or removed without a major version bump — consumers switch on them.
 */
export const CACHE_ERROR_CODES = {
  CONNECTION_FAILED: 'cache.connection_failed',
  COMMAND_TIMEOUT: 'cache.command_timeout',
  CONNECTION_LOST: 'cache.connection_lost',
  SERIALIZATION_FAILED: 'cache.serialization_failed',
  DESERIALIZATION_FAILED: 'cache.deserialization_failed',
  INVALID_NAMESPACE: 'cache.invalid_namespace',
  INVALID_KEY: 'cache.invalid_key',
  SCRIPT_NOT_REGISTERED: 'cache.script_not_registered',
  SCRIPT_EXECUTION_FAILED: 'cache.script_execution_failed',
  SCRIPT_REGISTRY_MISSING: 'cache.script_registry_missing',
  FLUSH_DISABLED_IN_PRODUCTION: 'cache.flush_disabled_in_production',
  CLUSTER_MISCONFIGURED: 'cache.cluster_misconfigured',
  SENTINEL_MISCONFIGURED: 'cache.sentinel_misconfigured',
  SHUTDOWN_TIMEOUT: 'cache.shutdown_timeout',
  UNSUPPORTED_IN_CLUSTER: 'cache.unsupported_in_cluster'
} as const

/** Union of every cache error code string value. */
export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[keyof typeof CACHE_ERROR_CODES]
