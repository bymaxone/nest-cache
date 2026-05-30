/**
 * Server-side error code re-exports and human-readable messages.
 *
 * Layer: server. The canonical codes live in the zero-dependency shared subpath;
 * this module re-exports them for server-side consumers and attaches the default
 * English message catalog. A `Map` (not an index signature) backs the lookup so
 * a runtime `code` value can never trigger object-injection.
 */
import { CACHE_ERROR_CODES, type CacheErrorCode } from '../../shared/constants/error-codes'

export { CACHE_ERROR_CODES }
export type { CacheErrorCode }

/**
 * Default end-user-facing messages per error code (English; consumers localize
 * upstream). Covers every code in {@link CACHE_ERROR_CODES}; unknown codes fall
 * back to a generic message at the `CacheException` throw site.
 *
 * Exposed as a {@link ReadonlyMap} so a consumer cannot mutate the shared
 * catalog — `.set`/`.delete`/`.clear` are compile errors. A `Map` (not an index
 * signature) still backs it so a runtime `code` can never trigger object-injection.
 */
export const CACHE_ERROR_MESSAGES: ReadonlyMap<CacheErrorCode, string> = new Map<
  CacheErrorCode,
  string
>([
  [CACHE_ERROR_CODES.CONNECTION_FAILED, 'Could not connect to Redis after retries.'],
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT, 'Redis command timed out.'],
  [CACHE_ERROR_CODES.CONNECTION_LOST, 'Redis connection was lost during the operation.'],
  [CACHE_ERROR_CODES.SERIALIZATION_FAILED, 'Failed to serialize the value.'],
  [CACHE_ERROR_CODES.DESERIALIZATION_FAILED, 'Failed to deserialize the cached value.'],
  [CACHE_ERROR_CODES.INVALID_NAMESPACE, 'Namespace is empty or contains the reserved separator.'],
  [CACHE_ERROR_CODES.INVALID_KEY, 'Cache key prefix or id is empty.'],
  [CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, 'Tried to execute an unregistered Lua script.'],
  [CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, 'Lua script returned a Redis error.'],
  [CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING, 'eval called without registering any scripts.'],
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, 'flushNamespace is disabled in production.'],
  [CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, 'Cluster mode requires cluster.nodes.'],
  [
    CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED,
    'Sentinel mode requires sentinel.sentinels and sentinel.name.'
  ],
  [CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT, 'Graceful shutdown exceeded the timeout.']
])
