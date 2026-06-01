/**
 * Public configuration contracts for `BymaxCacheModule`.
 *
 * Layer: server. Describes every option a consumer passes to `forRoot` /
 * `forRootAsync`, plus the mode-specific connection blocks. ioredis types are
 * re-exported for consumer convenience. See `docs/technical_specification.md`
 * §4 for full semantics.
 */
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'

import type {
  DynamicModule,
  ForwardReference,
  InjectionToken,
  OptionalFactoryDependency,
  Type
} from '@nestjs/common'
import type { ClusterNode, ClusterOptions, NatMap, RedisOptions, SentinelAddress } from 'ioredis'

import type { ICacheEvents } from './cache-events.interface'
import type { IScriptDefinition } from './script-definition.interface'
import type { ISerializer } from './serializer.interface'

/**
 * Standalone (single-node) connection settings.
 *
 * Either `url` OR `host` is required. When both are present, `url` wins —
 * discrete fields act as fallback (spec §11.3).
 */
export interface BymaxCacheStandaloneConnection {
  /** `redis://` or `rediss://` (TLS) URL — overrides discrete fields. */
  url?: string
  /** Hostname. Default: `localhost` when neither `url` nor `host` is set is rejected at validation. */
  host?: string
  /** TCP port. Default: 6379. */
  port?: number
  /** Auth password. Never logged or echoed in events. */
  password?: string
  /** Logical database index. */
  db?: number
  /** Auth username (Redis 6 ACLs). */
  username?: string
  /** TLS options for `rediss://` or explicit TLS. */
  tls?: TlsConnectionOptions
  /** Default: false (connects on `OnModuleInit`). */
  lazyConnect?: boolean
  /** Default: 10_000 ms. */
  connectTimeout?: number
  /** Default: 5_000 ms. */
  commandTimeout?: number
  /** Default: 3. Do NOT pass `null` here — that value is BullMQ-specific. */
  maxRetriesPerRequest?: number
  /** Default: true. */
  enableReadyCheck?: boolean
  /** Default: false — fail fast instead of queueing. */
  enableOfflineQueue?: boolean
  /** Default: `(times) => Math.min(times * 50, 2000)`. */
  retryStrategy?: (times: number) => number | null | void
  /** Default: reconnects only on `READONLY` (replica failover). */
  reconnectOnError?: (err: Error) => boolean | 1 | 2
  /** TCP keep-alive in ms. */
  keepAlive?: number
  /** Disable Nagle's algorithm. */
  noDelay?: boolean
  /** IP stack family. */
  family?: 4 | 6
}

/** Sentinel-mode connection settings. Required when `mode === 'sentinel'`. */
export interface BymaxCacheSentinelConnection {
  /** Sentinel addresses to query for the current master. */
  sentinels: SentinelAddress[]
  /** Master group name configured in the sentinels. */
  name: string
  /** Password for the sentinel nodes themselves. */
  sentinelPassword?: string
  /** Password for the data nodes. */
  password?: string
  /**
   * Connect to the master or a replica.
   * @remarks `'replica'` is the current Redis 7 terminology; `'slave'` is still
   * accepted by ioredis 5 at the wire level for backwards compatibility but
   * should be avoided in new code. Both values are accepted here and normalised
   * to the ioredis wire value internally.
   */
  role?: 'master' | 'replica' | 'slave'
  /**
   * Rewrites the master/replica addresses the sentinels announce. Needed when the
   * sentinels report addresses that are not reachable as-is from the client —
   * e.g. a NAT'd Docker/Kubernetes network where the announced internal IP must
   * be translated to a published host. Maps `'<announced-host>:<port>'` to the
   * reachable `{ host, port }`.
   */
  natMap?: NatMap
}

/** Cluster-mode connection settings. Required when `mode === 'cluster'`. */
export interface BymaxCacheClusterConnection {
  /** Seed nodes for cluster discovery. */
  nodes: ClusterNode[]
  /** ioredis cluster options. */
  options?: ClusterOptions
}

/**
 * Synchronous configuration for `BymaxCacheModule.forRoot()`.
 *
 * @see `docs/technical_specification.md` §4 for full semantics.
 */
export interface BymaxCacheModuleOptions {
  /** Connection mode. Default: `'standalone'`. */
  mode?: 'standalone' | 'sentinel' | 'cluster'
  /** Standalone connection block (used when `mode === 'standalone'`). */
  connection?: BymaxCacheStandaloneConnection
  /** Sentinel connection block (used when `mode === 'sentinel'`). */
  sentinel?: BymaxCacheSentinelConnection
  /** Cluster connection block (used when `mode === 'cluster'`). */
  cluster?: BymaxCacheClusterConnection
  /** Global namespace prefix applied to every key. Default: `'app'`. */
  namespace?: string
  /** Separator between namespace/prefix/id segments. Default: `':'`. */
  keySeparator?: string
  /** Custom serializer. Default: `JsonSerializer`. */
  serializer?: ISerializer
  /** Connection lifecycle event hooks — plug a logger or metrics sink here. */
  events?: ICacheEvents
  /** Graceful shutdown timeout in ms. Default: 5000. */
  shutdownTimeoutMs?: number
  /**
   * Allows `flushNamespace()` to run even when `NODE_ENV === 'production'`.
   * Default: false. SAFETY: leave false in real production environments.
   */
  allowFlushInProduction?: boolean
  /**
   * Register the module as global. Default: true.
   *
   * @remarks Read by {@link BymaxCacheModule.forRoot}. For `forRootAsync` the
   * `global` flag is decided synchronously — before the async factory resolves —
   * so pass `isGlobal` at the `forRootAsync({ isGlobal, ... })` call site; an
   * `isGlobal` returned from inside the async `useFactory` has no effect.
   */
  isGlobal?: boolean
  /** Lua scripts pre-registered at module init. */
  scripts?: readonly IScriptDefinition[]
}

/**
 * Async configuration for `BymaxCacheModule.forRootAsync()`.
 * Standard NestJS dynamic-module async options shape.
 *
 * @remarks The recommended async-registration contract: a `useFactory` returning
 * the module options. `forRootAsync`'s parameter is the builder-generated
 * async-options type — a superset that also accepts NestJS's `useClass` /
 * `useExisting` provider strategies — so this curated interface documents the
 * common `useFactory` path most consumers use rather than redefining it.
 */
export interface BymaxCacheModuleAsyncOptions {
  /** Modules to import so the factory can inject their providers. */
  imports?: Array<Type | DynamicModule | ForwardReference>
  /** Providers to inject into `useFactory`. */
  inject?: Array<InjectionToken | OptionalFactoryDependency>
  /** Factory returning the resolved module options. */
  useFactory: (...args: unknown[]) => Promise<BymaxCacheModuleOptions> | BymaxCacheModuleOptions
  /** Register the module as global. Default: true. */
  isGlobal?: boolean
}

/** Re-export ioredis types for consumer convenience. */
export type { ClusterNode, ClusterOptions, RedisOptions, SentinelAddress }
