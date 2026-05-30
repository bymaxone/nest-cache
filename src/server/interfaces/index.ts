/**
 * Barrel for the server interface contracts.
 *
 * Type-only re-exports — no runtime code crosses this boundary.
 */
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
} from './cache-module-options.interface'
export type { ICacheEvents } from './cache-events.interface'
export type { ISerializer } from './serializer.interface'
export type { IScriptDefinition } from './script-definition.interface'
export type { IPubSubHandler, IPubSubPatternHandler } from './pubsub-handler.interface'
