/**
 * Public API of the `@bymax-one/nest-cache/admin` subpath.
 *
 * A privileged, read-only administration surface: health, `INFO` statistics,
 * resolved configuration, keyspace listing, key inspection and value reveal —
 * all under an allowlist the *application* declares and this library validates.
 *
 * **Kept out of the main entry on purpose.** Importing this subpath is a
 * greppable, reviewable act, which is what a privileged read surface should be;
 * a consumer that never wires it cannot resolve a reveal service from DI by
 * accident, and never pays for it in the main bundle.
 *
 * The library owns the mechanism. Which keyspaces exist, the `origin` prose that
 * explains them, the routes, and the guards that protect them all belong to the
 * application — a cache library cannot know that another library writes at Redis
 * root through `CacheService.getClient()`, and must not depend on that library
 * to learn it.
 */

// Module
export { BymaxCacheAdminModule } from './bymax-cache-admin.module'
export type { BymaxCacheAdminModuleAsyncOptions } from './bymax-cache-admin.module'

// Services
export { CacheStatusService } from './services/cache-status.service'
export type { ICacheProbe } from './services/cache-status.service'
export { CacheAdminService } from './services/cache-admin.service'
export type { ListKeysOptions } from './services/cache-admin.service'

// Scope model + helpers
export type { CacheScope } from './interfaces/cache-scope.interface'
export { findScope, isKeyInScope, readScopePattern, validateScopes } from './config/validate-scopes'
export { resolveAdminOptions } from './config/resolved-admin-options'
export type { ResolvedAdminOptions } from './config/resolved-admin-options'
export type { BymaxCacheAdminModuleOptions } from './interfaces/admin-module-options.interface'

// Reader contracts (a consumer standing in its own client, or asserting read-only)
export type {
  IRedisPipeline,
  IRedisReader,
  IRedisReaderSource,
  PipelineReply
} from './interfaces/redis-reader.interface'

// Health / config types
export type {
  CacheConfig,
  CacheHealth,
  CacheMode,
  CacheProbe,
  CacheProbeDegraded,
  CacheProbeDown,
  CacheProbeFailure,
  CacheProbeUp
} from './types/cache-health.types'

// INFO reading
export { parseInfoFields, readRedisStats } from './utils/parse-info'
export type {
  BgsaveStatus,
  MaxMemory,
  RedisStats,
  ReplicationRole
} from './types/redis-stats.types'

// Keyspace types + reply narrowing
export { readKeyTtl, readKeyType, readSizeBytes } from './utils/read-replies'
export type {
  KeyDetail,
  KeyEntry,
  KeyTtl,
  KeyspacePage,
  RedisKeyType,
  RevealResult,
  RevealedValue
} from './types/keyspace.types'

// Injection token
export { BYMAX_CACHE_ADMIN_OPTIONS } from './bymax-cache-admin.constants'

// Defaults, exported so a consumer can document what it did not override
export {
  DEFAULT_COMMAND_BATCH_LIMIT,
  DEFAULT_DEGRADED_ABOVE_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_REVEAL_LIMIT,
  DEFAULT_REVEAL_STRING_LIMIT,
  DEFAULT_SCAN_LIMIT
} from './constants/admin-defaults'
