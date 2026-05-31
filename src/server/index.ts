/**
 * Public API of the `@bymax-one/nest-cache` (server) subpath.
 *
 * The NestJS-facing surface through Phase 2: the dynamic module, the connection
 * manager, the key builder, the typed cache service, the default serializer, the
 * public contracts, DI tokens, and errors. The pub-sub / script services land in
 * Phase 3 per `docs/development_plan.md`.
 */

// Module
export { BymaxCacheModule } from './bymax-cache.module'

// Services / managers (Phase 1)
export { ConnectionManager } from './connection/connection.manager'
export { KeyBuilder } from './utils/key-builder'

// Cache service + default serializer (Phase 2)
export { CacheService } from './services/cache.service'
export { JsonSerializer } from './utils/json-serializer'

// Interfaces / contracts
export type {
  BymaxCacheClusterConnection,
  BymaxCacheModuleAsyncOptions,
  BymaxCacheModuleOptions,
  BymaxCacheSentinelConnection,
  BymaxCacheStandaloneConnection,
  ClusterNode,
  ClusterOptions,
  RedisOptions,
  SentinelAddress
} from './interfaces/cache-module-options.interface'
export type { ICacheEvents } from './interfaces/cache-events.interface'
export type { ISerializer } from './interfaces/serializer.interface'
export type { IScriptDefinition } from './interfaces/script-definition.interface'
export type { IPubSubHandler, IPubSubPatternHandler } from './interfaces/pubsub-handler.interface'

// Injection tokens (Symbol)
export {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'

// Errors
export { CacheException } from './errors/cache.exception'
export { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES } from './errors/cache-error-codes'
export type { CacheErrorCode } from './errors/cache-error-codes'

// Re-export ioredis core types for consumer convenience
export type { Redis, RedisKey } from 'ioredis'

// Shared re-exports (convenience — also available from `@bymax-one/nest-cache/shared`)
export { CACHE_EVENT_NAMES } from '../shared'
export type {
  CacheConnectionStatus,
  CacheEventName,
  CacheKeyPrefix,
  CacheNamespace,
  SerializableValue
} from '../shared'
