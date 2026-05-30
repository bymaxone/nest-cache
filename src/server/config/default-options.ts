/**
 * Option validation and defaulting.
 *
 * Layer: server. `validateOptions` enforces bootstrap invariants (fail fast at
 * `forRoot`, not at first command); `applyDefaults` merges consumer options with
 * library defaults and shallow-freezes the result so the resolved top-level
 * fields cannot be reassigned once registered. See
 * `docs/technical_specification.md` §4.6.
 */
import type { ResolvedOptions } from './resolved-options'
import { DEFAULT_KEY_SEPARATOR, DEFAULT_NAMESPACE } from '../constants/default-namespace'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { parseRedisUrl } from '../utils/parse-redis-url'

/**
 * Validates consumer options at module bootstrap, throwing actionable
 * {@link CacheException}s when an invariant is violated.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `SENTINEL_MISCONFIGURED`, `CLUSTER_MISCONFIGURED`,
 *   `CONNECTION_FAILED`, or `INVALID_NAMESPACE` depending on the violation.
 */
export function validateOptions(options: BymaxCacheModuleOptions): void {
  const mode = options.mode ?? 'standalone'

  if (mode === 'sentinel') {
    if (!options.sentinel || !options.sentinel.sentinels?.length || !options.sentinel.name) {
      throw new CacheException(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'cluster') {
    if (!options.cluster || !options.cluster.nodes?.length) {
      throw new CacheException(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'standalone') {
    const connection = options.connection
    if (!connection || (!connection.url && !connection.host)) {
      throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
        reason: 'missing connection.url or connection.host'
      })
    }
    if (connection.url) {
      try {
        parseRedisUrl(connection.url)
      } catch {
        // Surface a malformed URL as the library's structured error at bootstrap
        // rather than a raw Error during connection-manager construction. The URL
        // is omitted from `details` since it may embed credentials (CLAUDE.md §4).
        throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
          reason: 'invalid connection.url'
        })
      }
    }
  }

  const namespace = options.namespace ?? DEFAULT_NAMESPACE
  const separator = options.keySeparator ?? DEFAULT_KEY_SEPARATOR
  if (!namespace || namespace.trim() === '') {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, { namespace })
  }
  if (namespace.includes(separator)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'namespace contains key separator',
      namespace,
      separator
    })
  }

  const shutdown = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  if (shutdown < MIN_SHUTDOWN_TIMEOUT_MS) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'shutdownTimeoutMs too low',
      value: shutdown,
      min: MIN_SHUTDOWN_TIMEOUT_MS
    })
  }

  const connectTimeout = options.connection?.connectTimeout
  if (connectTimeout !== undefined && connectTimeout < MIN_CONNECT_TIMEOUT_MS) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'connectTimeout too low',
      value: connectTimeout,
      min: MIN_CONNECT_TIMEOUT_MS
    })
  }
}

/**
 * Merges consumer options with library defaults and shallow-freezes the result.
 *
 * The top-level resolved object is frozen so its fields cannot be reassigned
 * after registration. Nested blocks (`connection`, `serializer`, `events`,
 * `sentinel`, `cluster`, `scripts`) are kept by reference and intentionally NOT
 * deep-frozen — they may be consumer-owned instances (e.g. a serializer) that
 * freezing in place could break.
 *
 * @param options - The raw consumer options.
 * @returns A shallow-frozen {@link ResolvedOptions} carrying every defaulted field.
 */
export function applyDefaults(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions> {
  const resolved: ResolvedOptions = {
    mode: options.mode ?? 'standalone',
    connection: options.connection,
    sentinel: options.sentinel,
    cluster: options.cluster,
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    keySeparator: options.keySeparator ?? DEFAULT_KEY_SEPARATOR,
    serializer: options.serializer,
    events: options.events,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    allowFlushInProduction: options.allowFlushInProduction ?? false,
    isGlobal: options.isGlobal ?? true,
    scripts: options.scripts
  }
  return Object.freeze(resolved)
}
