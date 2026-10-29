# @bymax-one/nest-cache — Complete Technical Specification

> **Version:** 1.2.3
> **Last updated:** 2026-10-29 (reflects v1.2.3; the §0 overrides remain normative)
> **Status:** Implemented (v1.2.3)
> **Type:** Public npm package (`@bymax-one/nest-cache`)

---

## 0. Alignment with the Bymax Lib Standard (2026-05-30)

> This specification predates the cross-lib standards audit. The points below are
> **NORMATIVE OVERRIDES** — where a detailed section conflicts with one of these, the
> override wins. Sources: the Obsidian vault notes `Bymax-Lib-Standards` and
> `NestJS/Bymax-Conventions`.

1. **Dynamic module uses `ConfigurableModuleBuilder`** + `forRoot()` / `forRootAsync()`
   (NestJS 11 convention; map the `isGlobal` extra to `DynamicModule.global` via `setExtras`,
   not a manual `@Global()`). The manual `forRoot` code in §4/§11 is illustrative — implement
   on top of the builder and augment the produced `DynamicModule` with the conditional
   providers/exports (the pattern proven in `@bymax-one/nest-logger`).
2. **Peer dependencies are NOT optional** (§14.2 corrected below). `@nestjs/common`,
   `@nestjs/core`, `ioredis`, and `reflect-metadata` are required peers. Marking the NestJS
   peers optional breaks resolution of the server subpath in consumers (package managers do
   not auto-install optional peers) — proven empirically by the dogfood smoke test.
3. **Six DI tokens** (§4.4 corrected below): the original four plus `BYMAX_CACHE_SERIALIZER`
   and `BYMAX_CACHE_KEY_BUILDER`, so the serializer and key builder are injectable/overridable.
4. **Bundle-size budgets** are expressed in **KiB brotli** (matching `scripts/check-size.mjs`),
   not "25 KB gzip". Provisional at scaffold time; recalibrate to the real artifact.
5. **No `.gitkeep`** files anywhere — scaffold real files; never commit `.gitkeep` markers
   (this overrides the folder-structure tasks that mention them).

---

## Table of Contents

1. [Vision and Value Proposition](#1-vision-and-value-proposition)
2. [Architecture](#2-architecture)
3. [Package Structure](#3-package-structure)
4. [Configuration API](#4-configuration-api)
5. [Main Service — `CacheService`](#5-main-service--cacheservice)
6. [Typed Helpers and Serialization](#6-typed-helpers-and-serialization)
7. [Namespace Strategy](#7-namespace-strategy)
8. [Pub/Sub](#8-pubsub)
9. [Lua Scripts and `ScriptManager`](#9-lua-scripts-and-scriptmanager)
10. [Health Check](#10-health-check)
11. [Connection Strategy](#11-connection-strategy)
12. [Error Code Catalog](#12-error-code-catalog)
13. [What is NOT in the package](#13-what-is-not-in-the-package)
14. [Dependencies](#14-dependencies)
15. [Implementation Phases](#15-implementation-phases)
16. [Known Limitations](#16-known-limitations)
17. [Example Integration](#17-example-integration)
18. [The `./admin` Subpath](#18-the-admin-subpath)

---

## 1. Vision and Value Proposition

### 1.1 What it is

`@bymax-one/nest-cache` is a public npm package that provides an idiomatic NestJS layer over `ioredis`. It encapsulates the Redis connection lifecycle (singleton, automatic reconnection, graceful shutdown), exposes typed helpers (`get<T>`, `set<T>`, `incr`, `decr`, `del`, `expire`, `exists`, `ttl`, `mget`, `mset`, etc.), manages key namespaces, offers Pub/Sub, and supports Lua scripts for atomic operations — all via dependency injection.

It is the evolution of the `_commons_/cache/` module from the `bymax-fitness-ai` project (~317 LoC), rewritten as an independent library with a clear public surface and zero direct dependencies — only `ioredis` as a peer dependency.

### 1.2 Why it exists

In a multi-tenant SaaS architecture, Redis appears as the foundation of nearly all infrastructure: cache, rate limiting, sessions, refresh tokens, Pub/Sub, BullMQ, distributed locks, counters. Without a shared layer, each service reimplements connection, retry, reconnection, and shutdown boilerplate; keys become scattered string concatenation; Lua scripts are duplicated across libs.

`@bymax-one/nest-cache` centralizes those responsibilities in a single audited package, allowing other libs (`nest-auth`, `nest-queue`, `nest-notification`, `nest-realtime`) to consume Redis in a standardized way or share the same instance via namespaces.

### 1.3 Who uses it

- **NestJS applications** that need Redis for cache, counters, locks, or Pub/Sub
- **`@bymax-one/nest-*` libraries** that depend on Redis
- **Background workers/services** consuming messages via Pub/Sub
- Any Node.js 24+ project with NestJS 11+ that wants a stable, typed layer over `ioredis`

### 1.4 Distribution Model

| Aspect               | Detail                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| Registry             | Public npm (`@bymax-one/nest-cache`)                                     |
| License              | MIT                                                                      |
| Runtime              | Node.js 24+                                                              |
| Framework            | NestJS 11+                                                               |
| Subpaths             | `.` (server) + `./admin` (administration) + `./shared` (types/constants) |
| Main peer dependency | `ioredis ^6`                                                             |

### 1.5 Design Principles

1. **Configuration over convention.** Everything goes through `forRoot`/`forRootAsync`. Sensible defaults when applicable.
2. **Zero opinion on environment.** The lib reads no configuration from `process.env` — the app injects the options. The single read is `NODE_ENV` in `flushNamespace`, the production guard (§5.5).
3. **Singleton by default.** One command connection, plus an on-demand subscriber.
4. **Correct lifecycle.** `OnModuleInit` to connect, `OnModuleDestroy` for graceful `quit()` with timeout.
5. **Typed helpers.** Generic `<T>` API with default JSON serialization and a hook for custom serializers.
6. **Strict namespace.** Every key passes through `KeyBuilder(prefix, id)` — raw strings are discouraged.
7. **Lua-first for atomicity.** Other libs register scripts via `ScriptManager.register(name, lua)` and invoke them by name.
8. **Explicit observability.** Connection events exposed via the `events.onEvent` callback — no embedded logger.
9. **Zero external deps.** Only `ioredis` as a peer.

### 1.6 Differences vs `_commons_/cache/`

| Aspect        | Current source                        | This lib                                          |
| ------------- | ------------------------------------- | ------------------------------------------------- |
| Configuration | Reads `ConfigBase.REDIS_URL` directly | Receives `BymaxCacheModuleOptions` via DI         |
| Logger        | Imports the project's `LoggerService` | Optional `events.onEvent` callback                |
| BullMQ client | Separate `getClientForQueue()`        | Removed — `nest-queue` creates its own connection |
| Namespace     | None                                  | Configurable via `namespace`                      |
| Typed helpers | None                                  | `get<T>`, `set<T>`, `mget<T>`, `incr`, etc.       |
| Pub/Sub       | Not exposed                           | `PubSubService`                                   |
| Lua scripts   | Not available                         | `ScriptManager` with `register`/`eval`            |

---

## 2. Architecture

### 2.1 NestJS Dynamic Module Pattern

`@bymax-one/nest-cache` is a global dynamic module (`isGlobal: true` by default). The app imports it once in `AppModule` and `CacheService` becomes available in any feature module without re-importing.

```
┌──────────────────────────────────────────────────────────┐
│                Host Application (NestJS)                 │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │           @bymax-one/nest-cache module             │  │
│  │                                                    │  │
│  │   CacheService  ───►  ConnectionManager            │  │
│  │       │                       │                    │  │
│  │   KeyBuilder              ioredis Redis()          │  │
│  │   Serializer              (singleton)              │  │
│  │       │                                            │  │
│  │   PubSubService ──► subscriber client (lazy)       │  │
│  │   ScriptManager ──► EVALSHA cache                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Connection Lifecycle

1. **`forRoot` / `forRootAsync`** — the consumer passes `BymaxCacheModuleOptions`; the module registers providers.
2. **`OnModuleInit`** — `ConnectionManager` creates `Redis()` and, unless `lazyConnect` is set, waits for `'ready'`. Registered Lua scripts are preloaded at `OnApplicationBootstrap` (skipped when `lazyConnect` is set).
3. **Normal operation** — `CacheService` delegates to `ConnectionManager.getClient()`.
4. **Events** (`connect`, `ready`, `error`, `close`, `reconnecting`, `end`) propagated to the `events.onEvent` callback.
5. **`OnModuleDestroy`** — `quit()` with `shutdownTimeoutMs`; if it exceeds, force `disconnect()`.

### 2.3 Client Multiplexing

`ioredis` requires separate connections for some scenarios:

| Case                                         | Client               | Justification                                                                  |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| Normal commands (`get`, `set`, `incr`, etc.) | `client` (singleton) | One TCP connection serves thousands of pipelined commands                      |
| Subscriber (`subscribe`, `psubscribe`)       | `subscriber` (lazy)  | Connection in subscriber mode cannot execute other commands                    |
| Publisher (`publish`)                        | `client` (singleton) | `publish` is a normal command                                                  |
| BullMQ                                       | **NOT exposed**      | Requires `maxRetriesPerRequest: null`; `nest-queue` creates its own connection |

The `subscriber` is created on the first call to `subscribe`/`psubscribe`, built from the same options as the main client, except that its offline queue is enabled, so a subscribe issued before the socket is ready is queued instead of failing. In cluster mode the override is ignored and the subscriber uses the configured cluster options.

---

## 3. Package Structure

### 3.1 Directory Tree

```
@bymax-one/nest-cache/
├── package.json
├── tsconfig*.json
├── tsup.config.ts
├── eslint.config.mjs
├── jest*.config.ts
├── stryker.config.json
├── README.md / CHANGELOG.md / LICENSE / SECURITY.md / CLAUDE.md / AGENTS.md
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md
│   ├── development_tasks.md
│   ├── mutation_testing_plan.md
│   └── mutation_testing_results.md
├── scripts/
│   └── check-size.mjs
├── src/
│   ├── server/                             # Subpath '.'
│   │   ├── index.ts                        # Barrel export
│   │   ├── bymax-cache.module.ts           # Dynamic module
│   │   ├── bymax-cache.constants.ts        # Injection tokens (Symbol)
│   │   ├── interfaces/
│   │   │   ├── cache-module-options.interface.ts
│   │   │   ├── cache-events.interface.ts
│   │   │   ├── serializer.interface.ts
│   │   │   ├── script-definition.interface.ts
│   │   │   └── pubsub-handler.interface.ts
│   │   ├── config/
│   │   │   ├── default-options.ts
│   │   │   └── resolved-options.ts
│   │   ├── connection/
│   │   │   └── connection.manager.ts       # Singleton + lifecycle
│   │   ├── services/
│   │   │   ├── cache.service.ts            # Main API
│   │   │   ├── pubsub.service.ts           # publish / subscribe
│   │   │   └── script-manager.service.ts   # Lua loader/runner
│   │   ├── utils/
│   │   │   ├── key-builder.ts
│   │   │   ├── json-serializer.ts
│   │   │   └── parse-redis-url.ts
│   │   ├── errors/
│   │   │   ├── cache-error-codes.ts
│   │   │   └── cache.exception.ts
│   │   └── constants/
│   │       ├── default-namespace.ts
│   │       └── default-timeouts.ts
│   ├── admin/                              # Subpath './admin' (read-only administration)
│   │   ├── index.ts
│   │   ├── bymax-cache-admin.module.ts     # BymaxCacheAdminModule
│   │   ├── bymax-cache-admin.constants.ts  # BYMAX_CACHE_ADMIN_OPTIONS
│   │   ├── config/                         # validate-scopes, resolved-admin-options
│   │   ├── constants/                      # admin-defaults
│   │   ├── interfaces/                     # options, scope, redis-reader contracts
│   │   ├── services/                       # cache-status.service, cache-admin.service
│   │   ├── types/                          # health, stats, keyspace types
│   │   └── utils/                          # parse-info, read-replies
│   └── shared/                             # Subpath './shared' (zero deps)
│       ├── index.ts
│       ├── types/
│       │   ├── cache-config.types.ts
│       │   ├── cache-event.types.ts
│       │   └── serializable-value.types.ts
│       └── constants/
│           ├── error-codes.ts
│           └── event-names.ts
└── test/                                   # E2E tests (Testcontainers)
    └── e2e/                                # *.e2e-spec.ts suites
```

### 3.2 Subpath Exports

| Subpath      | Entry point             | Description                      | Peer deps                              |
| ------------ | ----------------------- | -------------------------------- | -------------------------------------- |
| `.` (server) | `dist/server/index.mjs` | Dynamic module, services         | `@nestjs/common`, `ioredis`            |
| `./admin`    | `dist/admin/index.mjs`  | Read-only administration surface | `@nestjs/common`, `ioredis`, `.` entry |
| `./shared`   | `dist/shared/index.mjs` | Types, constants, error codes    | None                                   |

`./admin` treats `@bymax-one/nest-cache` as **external** in its tsup entry and imports it by
package specifier. Bundling the server modules into it would give the admin bundle its own
copies of `CacheService` and the Symbol DI tokens, so `@Inject(CacheService)` in an admin
provider would name a different class object than `BymaxCacheModule` registered — a
dual-package hazard that fails only in the published artifact, never in the test run.

```json
{
  "exports": {
    ".": {
      "import": { "types": "./dist/server/index.d.ts", "default": "./dist/server/index.mjs" },
      "require": { "types": "./dist/server/index.d.cts", "default": "./dist/server/index.cjs" }
    },
    "./admin": {
      "import": { "types": "./dist/admin/index.d.ts", "default": "./dist/admin/index.mjs" },
      "require": { "types": "./dist/admin/index.d.cts", "default": "./dist/admin/index.cjs" }
    },
    "./shared": {
      "import": { "types": "./dist/shared/index.d.ts", "default": "./dist/shared/index.mjs" },
      "require": { "types": "./dist/shared/index.d.cts", "default": "./dist/shared/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/server/index.cjs",
  "module": "./dist/server/index.mjs",
  "types": "./dist/server/index.d.cts",
  "typesVersions": {
    "*": {
      "shared": ["./dist/shared/index.d.cts"],
      "admin": ["./dist/admin/index.d.cts"]
    }
  }
}
```

### 3.3 Public API

**Server (`@bymax-one/nest-cache`):**

```typescript
export { BymaxCacheModule } from './bymax-cache.module'
export { ConnectionManager } from './connection/connection.manager'
export { KeyBuilder } from './utils/key-builder'
export { CacheService } from './services/cache.service'
export { JsonSerializer } from './utils/json-serializer'
export { PubSubService } from './services/pubsub.service'
export type { Unsubscribe } from './services/pubsub.service'
export { ScriptManagerService } from './services/script-manager.service'
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
export {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'
export type { ResolvedOptions } from './config/resolved-options'
export {
  DEFAULT_KEY_SEPARATOR,
  DEFAULT_NAMESPACE,
  DEFAULT_REDIS_PORT
} from './constants/default-namespace'
export { CacheException } from './errors/cache.exception'
export { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES } from './errors/cache-error-codes'
export type { CacheErrorCode } from './errors/cache-error-codes'
export type { Redis, RedisKey } from 'ioredis'
// Re-exported from the shared subpath for convenience:
export { CACHE_EVENT_NAMES } from '../shared'
export type {
  CacheConnectionStatus,
  CacheEventName,
  CacheKeyPrefix,
  CacheNamespace,
  SerializableValue
} from '../shared'
```

**Shared (`@bymax-one/nest-cache/shared`):**

```typescript
export type { CacheConnectionStatus, CacheEventName } from './types/cache-event.types'
export type { CacheKeyPrefix, CacheNamespace } from './types/cache-config.types'
export type { SerializableValue } from './types/serializable-value.types'
export { CACHE_ERROR_CODES } from './constants/error-codes'
export type { CacheErrorCode } from './constants/error-codes'
export { CACHE_EVENT_NAMES } from './constants/event-names'
```

> **Public vs internal.** Only what appears in `src/server/index.ts`, `src/shared/index.ts` and `src/admin/index.ts` is public. The `./admin` surface is described in §18.

---

## 4. Configuration API

### 4.1 `BymaxCacheModuleOptions` interface

```typescript
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import type { ClusterNode, ClusterOptions, NatMap, SentinelAddress } from 'ioredis'

/** Either `url` OR `host` is required (standalone). When both are present, `url` wins. */
export interface BymaxCacheStandaloneConnection {
  url?: string // redis:// or rediss://
  host?: string
  port?: number
  password?: string
  db?: number
  username?: string
  tls?: TlsConnectionOptions
  /** Default: false (connects on OnModuleInit) */
  lazyConnect?: boolean
  /** Default: 10000 ms */
  connectTimeout?: number
  /** Default: 5000 ms */
  commandTimeout?: number
  /** Default: 3. DO NOT use null here — that value is specific to BullMQ */
  maxRetriesPerRequest?: number
  /** Default: true */
  enableReadyCheck?: boolean
  /** Default: false — we prefer to fail fast rather than accumulate commands */
  enableOfflineQueue?: boolean
  /** Default: exponential backoff `Math.min(times * 50, 2000)` */
  retryStrategy?: (times: number) => number | null | void
  /** Default: reconnects only on 'READONLY' (replica failover) */
  reconnectOnError?: (err: Error) => boolean | 1 | 2
  keepAlive?: number // Default: 0
  noDelay?: boolean // Default: true
  family?: 4 | 6 // Default: 4
}

/** Required when mode === 'sentinel'. */
export interface BymaxCacheSentinelConnection {
  sentinels: SentinelAddress[]
  name: string
  sentinelPassword?: string
  password?: string
  /** 'replica' is normalised to the ioredis wire value 'slave' internally. */
  role?: 'master' | 'replica' | 'slave'
  /** Rewrites the addresses the sentinels announce (NAT'd networks). */
  natMap?: NatMap
}

/** Required when mode === 'cluster'. */
export interface BymaxCacheClusterConnection {
  nodes: ClusterNode[]
  options?: ClusterOptions
}

export interface BymaxCacheModuleOptions {
  /** Connection mode. Default: 'standalone' */
  mode?: 'standalone' | 'sentinel' | 'cluster'
  connection?: BymaxCacheStandaloneConnection
  sentinel?: BymaxCacheSentinelConnection
  cluster?: BymaxCacheClusterConnection

  /**
   * Global namespace. All keys receive prefix `{namespace}{separator}`.
   * Default: 'app'
   */
  namespace?: string

  /** Default: ':' (universal Redis convention) */
  keySeparator?: string

  /** Custom serializer. Default: JsonSerializer */
  serializer?: ISerializer

  /** Connection event hooks (logger plug-in) */
  events?: ICacheEvents

  /** Timeout for graceful shutdown in ms. Default: 5000 */
  shutdownTimeoutMs?: number

  /**
   * Allows `flushNamespace()` when NODE_ENV === 'production'. Default: false.
   * Leave false in real production environments.
   */
  allowFlushInProduction?: boolean

  /**
   * Default: true. For `forRootAsync` the flag is decided before the factory
   * resolves: pass `isGlobal` at the `forRootAsync({ isGlobal, ... })` call site;
   * a value returned from inside `useFactory` has no effect.
   */
  isGlobal?: boolean

  /** Lua scripts pre-registered at initialization */
  scripts?: readonly IScriptDefinition[]
}
```

### 4.2 `BymaxCacheModuleAsyncOptions` interface

```typescript
export interface BymaxCacheModuleAsyncOptions {
  imports?: Array<Type | DynamicModule | ForwardReference>
  inject?: Array<InjectionToken | OptionalFactoryDependency>
  useFactory: (...args: unknown[]) => Promise<BymaxCacheModuleOptions> | BymaxCacheModuleOptions
  isGlobal?: boolean
}
```

`forRootAsync` accepts the builder-generated async-options type, a superset of the interface above that also admits the NestJS `useClass` / `useExisting` provider strategies. `BymaxCacheModuleAsyncOptions` documents the common `useFactory` path.

### 4.3 Options table with defaults

| Option                            | Type                                      | Required | Default                  |
| --------------------------------- | ----------------------------------------- | -------- | ------------------------ |
| `mode`                            | `'standalone' \| 'sentinel' \| 'cluster'` | No       | `'standalone'`           |
| `connection.url`                  | `string`                                  | \*       | —                        |
| `connection.host`                 | `string`                                  | \*       | —                        |
| `connection.port`                 | `number`                                  | No       | — (ioredis: `6379`)      |
| `connection.password`             | `string`                                  | No       | —                        |
| `connection.db`                   | `number`                                  | No       | — (ioredis: `0`)         |
| `connection.username`             | `string`                                  | No       | —                        |
| `connection.tls`                  | `ConnectionOptions`                       | No       | —                        |
| `connection.lazyConnect`          | `boolean`                                 | No       | `false`                  |
| `connection.connectTimeout`       | `number`                                  | No       | `10000`                  |
| `connection.commandTimeout`       | `number`                                  | No       | `5000`                   |
| `connection.maxRetriesPerRequest` | `number`                                  | No       | `3`                      |
| `connection.enableReadyCheck`     | `boolean`                                 | No       | `true`                   |
| `connection.enableOfflineQueue`   | `boolean`                                 | No       | `false`                  |
| `connection.retryStrategy`        | `function`                                | No       | exp. backoff             |
| `connection.reconnectOnError`     | `function`                                | No       | reconnects on `READONLY` |
| `connection.keepAlive`            | `number`                                  | No       | `0`                      |
| `connection.noDelay`              | `boolean`                                 | No       | `true`                   |
| `connection.family`               | `4 \| 6`                                  | No       | `4`                      |
| `sentinel.sentinels`              | `SentinelAddress[]`                       | \*\*     | —                        |
| `sentinel.name`                   | `string`                                  | \*\*     | —                        |
| `sentinel.sentinelPassword`       | `string`                                  | No       | —                        |
| `sentinel.password`               | `string`                                  | No       | —                        |
| `sentinel.role`                   | `'master' \| 'replica' \| 'slave'`        | No       | ioredis default (master) |
| `sentinel.natMap`                 | `NatMap`                                  | No       | —                        |
| `cluster.nodes`                   | `ClusterNode[]`                           | \*\*\*   | —                        |
| `cluster.options`                 | `ClusterOptions`                          | No       | —                        |
| `namespace`                       | `string`                                  | No       | `'app'`                  |
| `keySeparator`                    | `string`                                  | No       | `':'`                    |
| `serializer`                      | `ISerializer`                             | No       | JSON                     |
| `events.onEvent`                  | `function`                                | No       | —                        |
| `shutdownTimeoutMs`               | `number`                                  | No       | `5000`                   |
| `allowFlushInProduction`          | `boolean`                                 | No       | `false`                  |
| `isGlobal`                        | `boolean`                                 | No       | `true`                   |
| `scripts`                         | `readonly IScriptDefinition[]`            | No       | none                     |

\* `connection.url` OR `connection.host` when `mode === 'standalone'`.
\*\* When `mode === 'sentinel'`.
\*\*\* When `mode === 'cluster'`.

### 4.4 Injection Tokens

```typescript
// bymax-cache.constants.ts
export const BYMAX_CACHE_OPTIONS = Symbol('BYMAX_CACHE_OPTIONS')
export const BYMAX_CACHE_CONNECTION = Symbol('BYMAX_CACHE_CONNECTION')
export const BYMAX_CACHE_SCRIPT_REGISTRY = Symbol('BYMAX_CACHE_SCRIPT_REGISTRY')
export const BYMAX_CACHE_EVENTS = Symbol('BYMAX_CACHE_EVENTS')
// Added 2026-05-30 (§0): serializer + key builder are injectable so consumers can override them.
export const BYMAX_CACHE_SERIALIZER = Symbol('BYMAX_CACHE_SERIALIZER')
export const BYMAX_CACHE_KEY_BUILDER = Symbol('BYMAX_CACHE_KEY_BUILDER')
```

### 4.5 Registration Example

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot(),
    BymaxCacheModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        mode: 'standalone',
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
          lazyConnect: false,
          tls: config.get('REDIS_TLS') === 'true' ? {} : undefined
        },
        namespace: config.get<string>('CACHE_NAMESPACE') ?? 'app',
        events: {
          onEvent: (event, data) => {
            // Plug in @bymax-one/nest-logger here
          }
        },
        scripts: [
          {
            name: 'compareAndSet',
            lua: `
              if redis.call('GET', KEYS[1]) == ARGV[1] then
                redis.call('SET', KEYS[1], ARGV[2])
                return 1
              end
              return 0
            `
          }
        ]
      }),
      isGlobal: true
    })
  ]
})
export class AppModule {}
```

### 4.6 Validation at Initialization

`validateOptions` runs when the module is registered (`forRoot`, or when the `forRootAsync` factory resolves), before any connection is made. It throws `CacheException` if:

- `mode === 'sentinel'` without `sentinel.sentinels` or `sentinel.name` (`SENTINEL_MISCONFIGURED`)
- `mode === 'cluster'` without `cluster.nodes` (`CLUSTER_MISCONFIGURED`)
- `mode === 'standalone'` without `connection.url` or `connection.host` (`CONNECTION_FAILED`)
- `connection.url` is not a parseable Redis URL (`CONNECTION_FAILED`, `reason: 'invalid connection.url'`; the URL is omitted from `details`)
- `namespace` is empty or whitespace-only, contains `keySeparator`, or contains a Redis glob metacharacter (`*`, `?`, `[`, `\`); `]` is accepted (`INVALID_NAMESPACE`)
- `keySeparator` is empty (`INVALID_NAMESPACE`)
- `shutdownTimeoutMs < 100` (`CONNECTION_FAILED`)
- `connection.connectTimeout < 100` (`CONNECTION_FAILED`)

---

## 5. Main Service — `CacheService`

### 5.1 Responsibility

`CacheService` is the public facade for typed Redis operations. Each method:

1. Composes the end key via `KeyBuilder` (applies namespace)
2. Delegates to `ConnectionManager.getClient()` (singleton)
3. Serializes/deserializes via `Serializer` when applicable
4. Catches `ioredis` errors and propagates them as `CacheException` when semantic

### 5.2 Method Table

| Method           | Signature                                                                                          | Description                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `get<T>`         | `(prefix: string, id: string) => Promise<T \| null>`                                               | Read + deserialize                                                 |
| `getRaw`         | `(prefix: string, id: string) => Promise<string \| null>`                                          | Read string without deserializing                                  |
| `set<T>`         | `(prefix, id, value: T, ttlSeconds?: number) => Promise<void>`                                     | Serialize + write with optional TTL                                |
| `setRaw`         | `(prefix, id, value: string, ttlSeconds?: number) => Promise<void>`                                | Write string without serializing                                   |
| `setNx<T>`       | `(prefix, id, value: T, ttlSeconds?: number) => Promise<boolean>`                                  | SET NX — true if written                                           |
| `del`            | `(prefix, id) => Promise<number>`                                                                  | DEL                                                                |
| `delMany`        | `(prefix, ids: readonly string[]) => Promise<number>`                                              | DEL in batch                                                       |
| `exists`         | `(prefix, id) => Promise<boolean>`                                                                 | EXISTS                                                             |
| `incr`           | `(prefix, id, by = 1) => Promise<number>`                                                          | INCR / INCRBY                                                      |
| `decr`           | `(prefix, id, by = 1) => Promise<number>`                                                          | DECR / DECRBY                                                      |
| `expire`         | `(prefix, id, ttlSeconds: number) => Promise<boolean>`                                             | EXPIRE                                                             |
| `ttl`            | `(prefix, id) => Promise<number>`                                                                  | TTL (`-2` does not exist, `-1` no expiration)                      |
| `persist`        | `(prefix, id) => Promise<boolean>`                                                                 | PERSIST                                                            |
| `mget<T>`        | `(prefix, ids: readonly string[]) => Promise<Array<T \| null>>`                                    | MGET (empty `ids` returns `[]` without a Redis call)               |
| `mset<T>`        | `(prefix, entries: ReadonlyArray<readonly [string, T]>) => Promise<void>`                          | MSET (no TTL — use pipeline); empty `entries` is a no-op           |
| `keys`           | `(prefix, pattern: string) => Promise<string[]>`                                                   | KEYS — restricted use (see §5.4)                                   |
| `scan`           | `(prefix, pattern, count = 100) => AsyncIterable<string>`                                          | SCAN cursor-based — preferred in production; not in cluster mode   |
| `hget<T>`        | `(prefix, id, field: string) => Promise<T \| null>`                                                | HGET                                                               |
| `hset<T>`        | `(prefix, id, field: string, value: T) => Promise<number>`                                         | HSET                                                               |
| `hgetall<T>`     | `(prefix, id) => Promise<Record<string, T>>`                                                       | HGETALL                                                            |
| `hdel`           | `(prefix, id, ...fields: readonly string[]) => Promise<number>`                                    | HDEL                                                               |
| `sadd` / `srem`  | `(prefix, id, ...members: readonly string[]) => Promise<number>`                                   | SADD / SREM                                                        |
| `smembers`       | `(prefix, id) => Promise<string[]>`                                                                | SMEMBERS                                                           |
| `sismember`      | `(prefix, id, member: string) => Promise<boolean>`                                                 | SISMEMBER                                                          |
| `scard`          | `(prefix, id) => Promise<number>`                                                                  | SCARD                                                              |
| `pipeline`       | `() => ChainableCommander`                                                                         | Raw pipeline (consumer composes keys)                              |
| `eval`           | `(scriptName, keys: readonly string[], args: ReadonlyArray<string \| number>) => Promise<unknown>` | Executes registered Lua; `keys` are namespaced                     |
| `getClient`      | `() => Redis`                                                                                      | Escape hatch — keys are NOT auto-namespaced; not in cluster mode   |
| `isHealthy`      | `() => Promise<boolean>`                                                                           | PING; never throws                                                 |
| `ping`           | `() => Promise<string>`                                                                            | Raw PING; propagates connection failures                           |
| `info`           | `(section?: string) => Promise<string>`                                                            | INFO                                                               |
| `flushNamespace` | `() => Promise<number>`                                                                            | Deletes everything in the namespace — blocked in production (§5.5) |

In cluster mode `scan`, `getClient` and `flushNamespace` throw `CacheException` `UNSUPPORTED_IN_CLUSTER`.

### 5.3 Critical Signatures

```typescript
@Injectable()
export class CacheService {
  private readonly serializer: ISerializer // options.serializer, else the injected token, else JsonSerializer

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Inject(ConnectionManager) private readonly connection: ConnectionManager,
    @Inject(KeyBuilder) private readonly keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
    @Optional() @Inject(ScriptManagerService) private readonly scriptRegistry?: ScriptManagerService
  ) {
    this.serializer = resolveSerializer(options, injectedSerializer)
  }

  /**
   * Reads a value and deserializes via configured serializer.
   * @returns Deserialized value or null if key does not exist
   * @throws CacheException on connection or deserialization failure
   */
  async get<T>(prefix: string, id: string): Promise<T | null> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = await this.connection.getClient().get(key)
    if (raw === null) return null
    return this.serializer.deserialize<T>(raw)
  }

  /**
   * Writes a value with optional TTL.
   * @param ttlSeconds Omit for no expiration
   */
  async set<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<void> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    if (ttlSeconds !== undefined) {
      await this.connection.getClient().set(key, raw, 'EX', ttlSeconds)
    } else {
      await this.connection.getClient().set(key, raw)
    }
  }

  /**
   * SET if Not eXists. Atomic.
   * @returns true if value was stored, false if key already existed
   */
  async setNx<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    const result =
      ttlSeconds !== undefined
        ? await this.connection.getClient().set(key, raw, 'EX', ttlSeconds, 'NX')
        : await this.connection.getClient().set(key, raw, 'NX')
    return result === 'OK'
  }

  /**
   * Executes a Lua script registered via ScriptManager.
   * Keys are auto-prefixed with namespace.
   */
  async eval(
    scriptName: string,
    keys: readonly string[],
    args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    if (!this.scriptRegistry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
    }
    const prefixedKeys = keys.map((k) => this.keyBuilder.applyNamespace(k))
    return this.scriptRegistry.eval(scriptName, prefixedKeys, args)
  }

  /**
   * Cursor-based key iteration. Prefer over keys() in production.
   */
  async *scan(prefix: string, pattern: string, count = SCAN_COUNT): AsyncIterable<string> {
    const fullPattern = this.keyBuilder.build(prefix, pattern)
    const client = this.connection.getClient()
    if (!isScannableClient(client)) {
      throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, { operation: 'scan' })
    }
    const stream = client.scanStream({ match: fullPattern, count })
    for await (const chunk of stream) {
      for (const key of chunk as string[]) yield key
    }
  }
}
```

### 5.4 KEYS vs SCAN

`KEYS pattern` is O(N) and **blocks** Redis. Use `scan` in production. `keys()` exists for convenience in tests — JSDoc warns explicitly.

### 5.5 `flushNamespace` is Destructive

```typescript
/**
 * Deletes ALL keys under the configured namespace via SCAN + UNLINK pipeline.
 *
 * SAFETY: throws CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION unless
 * options.allowFlushInProduction === true OR NODE_ENV !== 'production'.
 *
 * Use ONLY in tests/tooling. In production, prefer del/delMany.
 * Throws CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER in cluster mode.
 */
async flushNamespace(): Promise<number>
```

### 5.6 Usage Example

```typescript
@Injectable()
export class UserCacheRepository {
  private readonly PREFIX = 'users'

  constructor(private readonly cache: CacheService) {}

  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.cache.get<UserProfile>(this.PREFIX, userId)
  }

  async setProfile(userId: string, profile: UserProfile): Promise<void> {
    await this.cache.set(this.PREFIX, userId, profile, 3600)
  }

  async invalidateProfile(userId: string): Promise<void> {
    await this.cache.del(this.PREFIX, userId)
  }
}
```

---

## 6. Typed Helpers and Serialization

### 6.1 `ISerializer` interface

```typescript
export interface ISerializer {
  /** Converts value to string. Must be deterministic. */
  serialize<T>(value: T): string
  /** Reverses serialize. Must throw on malformed input. */
  deserialize<T>(raw: string): T
}
```

### 6.2 Default serializer — JSON

```typescript
export class JsonSerializer implements ISerializer {
  serialize<T>(value: T): string {
    // A top-level undefined, function or symbol is rejected (JSON.stringify would
    // return undefined instead of a string); a JSON.stringify throw is wrapped too.
    // Both throw CacheException(SERIALIZATION_FAILED, { error }).
    return JSON.stringify(value)
  }
  deserialize<T>(raw: string): T {
    // A JSON.parse throw becomes
    // CacheException(DESERIALIZATION_FAILED, { error, length }): a fixed text and
    // the length of `raw`, never any part of its content.
    return JSON.parse(raw) as T
  }
}
```

**JSON limitations:**

- `Date` → ISO string (the consumer rehydrates if needed)
- `Map`, `Set`, `BigInt`, `undefined` are not preserved
- `Buffer` becomes a bulky JSON object

### 6.3 Custom Serializer

Those who need MsgPack/CBOR/protobuf implement `ISerializer`:

```typescript
import { encode, decode } from '@msgpack/msgpack'

export class MsgPackSerializer implements ISerializer {
  serialize<T>(value: T): string {
    return Buffer.from(encode(value)).toString('base64')
  }
  deserialize<T>(raw: string): T {
    return decode(Buffer.from(raw, 'base64')) as T
  }
}

// Usage
BymaxCacheModule.forRoot({
  connection: { url: 'redis://localhost' },
  serializer: new MsgPackSerializer()
})
```

### 6.4 `SerializableValue` type

```typescript
// shared/types/serializable-value.types.ts
export type SerializableValue =
  string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue }
```

`get<T>`/`set<T>` does not constrain `T` to `SerializableValue` to retain flexibility with custom serializers. The constraint exists as an optional alias.

### 6.5 Error Handling

When `JSON.parse` throws, `JsonSerializer.deserialize` throws `CacheException` with code `DESERIALIZATION_FAILED` and `details: { error: 'stored value is not valid JSON', length }` (a fixed text and the length of the stored value; no part of its content, no preview and not the parser's own message, which quotes the start of the input; the key is not included). `CacheService` lets it propagate. It never returns a partial value.

---

## 7. Namespace Strategy

### 7.1 Composition Rule

All Redis keys follow:

```
{namespace}{separator}{prefix}{separator}{id}
```

With defaults `namespace = 'app'` and `separator = ':'`:

```
app:users:550e8400-e29b-41d4-a716-446655440000
```

The namespace and the separator are validated at registration (§4.6). `prefix` and `id` are not validated beyond being non-empty (§7.5).

### 7.2 Implementation — `KeyBuilder`

```typescript
@Injectable()
export class KeyBuilder {
  constructor(@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions) {}

  /** Composes {namespace}{sep}{prefix}{sep}{id}. Throws INVALID_KEY when prefix or id is empty. */
  build(prefix: string, id: string): string

  /** Applies only the namespace (used for Pub/Sub channels and Lua keys). Throws INVALID_KEY when empty. */
  applyNamespace(keyWithoutNamespace: string): string

  /** Returns `{namespace}{sep}` (e.g. 'app:'), the base of flushNamespace's SCAN pattern. */
  getNamespacePrefix(): string
}
```

### 7.3 Why Namespace is Mandatory

1. **Multiple libs on the same Redis instance** — `nest-auth` uses `auth:rt:{hash}` and the domain uses `fitness:workouts:{id}`. Without namespace, collisions on simple keys.
2. **Multiple environments** — `app-staging:` vs `app-prod:`.
3. **Physical multi-tenant** — when the tenant has an isolated instance, namespace still avoids accidents with side workloads.
4. **Safe `flushNamespace`** — it only erases what belongs to this module.

### 7.4 Recommended Conventions

| Prefix         | Use                 |
| -------------- | ------------------- |
| `users:`       | Entity cache        |
| `sessions:`    | Per-user session    |
| `rl:`          | Rate limit counter  |
| `lock:`        | Distributed lock    |
| `feature:`     | Feature flag        |
| `idempotency:` | Request idempotency |

### 7.5 Anti-patterns

- ❌ `getClient().set('raw_key', value)` — bypasses the namespace
- ❌ `cache.get('users', `${userId}:profile`)` — separator character inside `id`
- ❌ Composing the key manually at the call site
- ❌ A `prefix` or `id` that contains the key separator. The library does **not** enforce this: it validates the separator in the namespace only, and `KeyBuilder.build` rejects only an empty `prefix` or `id`. Keys collide silently: `build('a', 'b:c') === build('a:b', 'c') === 'app:a:b:c'`.
- ❌ A `prefix` that contains Redis glob metacharacters (`*`, `?`, `[`, `]`, `\`). The library does **not** enforce this either, and `keys()` and `scan()` compose the `prefix` into their match pattern, so the pattern widens, escapes or matches nothing.
- ✅ Encode each field before building the key: `cache.get(encodeURIComponent(prefix), encodeURIComponent(id))`. Keys are unambiguous only for a single-character `keySeparator` that appears in neither field; per-field `encodeURIComponent` provides that only for a separator it escapes and never emits (the default `':'`; not `%` or `- _ . ! ~ * ' ( )`), otherwise the separator must be rejected, and a multi-character separator can straddle a field boundary (with `'aa'`, `('ba', 'c')` and `('b', 'ac')` build the same key). Glob characters in `prefix` must be rejected.

---

## 8. Pub/Sub

### 8.1 `PubSubService`

```typescript
export type Unsubscribe = () => Promise<void>
export type IPubSubHandler<T> = (message: T, channel: string) => void | Promise<void>
export type IPubSubPatternHandler<T> = (message: T, channel: string, pattern: string) => void | Promise<void>

@Injectable()
export class PubSubService implements OnModuleDestroy {
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions,
    @Inject(ConnectionManager) connection: ConnectionManager,
    @Inject(KeyBuilder) keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) events?: ICacheEvents
  )

  /** Publishes to a namespaced channel on the main client. Returns the number of receivers. */
  publish<T>(channel: string, message: T): Promise<number>

  /** Subscribes to a namespaced channel; the dedicated subscriber connection is created lazily. */
  subscribe<T>(channel: string, handler: IPubSubHandler<T>): Promise<Unsubscribe>

  /** Pattern-subscribes (e.g. 'users:*', namespaced before subscribing). */
  psubscribe<T>(pattern: string, handler: IPubSubPatternHandler<T>): Promise<Unsubscribe>

  /** Quits the subscriber connection; forces disconnect() if quit fails. */
  onModuleDestroy(): Promise<void>
}
```

- Channels and patterns are namespaced through `KeyBuilder.applyNamespace`; handlers receive the **full namespaced** channel (and pattern).
- Listeners are reference-counted per channel and per pattern: `UNSUBSCRIBE` / `PUNSUBSCRIBE` is sent only when the last listener is removed. Each `Unsubscribe` is idempotent.
- A handler that throws (or rejects), and a payload that fails to deserialize, never tears down the subscriber. The failure is swallowed and forwarded to `events.onEvent('error', { role: 'subscriber', reason: 'handler_error', channel, error })`; a throw from `onEvent` itself is also swallowed.
- The subscriber connection has its offline queue enabled in standalone and sentinel modes (§2.3).

### 8.2 Example

```typescript
@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => Promise<void>

  constructor(private readonly pubsub: PubSubService) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.pubsub.subscribe<NotificationEvent>(
      'notifications',
      async (event) => this.handle(event)
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribe?.()
  }

  async emit(event: NotificationEvent): Promise<void> {
    await this.pubsub.publish('notifications', event)
  }

  private async handle(event: NotificationEvent): Promise<void> {
    /* ... */
  }
}
```

### 8.3 Guarantees and Limitations

Redis Pub/Sub is **fire-and-forget**: no persistence, replay, or ack. For delivery guarantees, use Streams or a queue (`@bymax-one/nest-queue`). After the subscriber reconnects, `ioredis` re-subscribes channels automatically — but messages published during the offline window are **lost**. Handler failures are not retried; they are reported through `events.onEvent` (§8.1).

---

## 9. Lua Scripts and `ScriptManager`

### 9.1 Motivation

Composite operations need to be atomic. Classic case: refresh token rotation (`nest-auth`) — two concurrent requests with the same token cannot create two sessions. Without Lua, both would pass through the `GET` before the `DEL`.

Lua scripts execute atomically on the server. `ScriptManager` loads via `SCRIPT LOAD`, caches the SHA1, and uses `EVALSHA` on subsequent invocations — cheaper than sending the full script. In cluster mode it uses plain `EVAL` instead (§9.3).

### 9.2 `IScriptDefinition` interface

```typescript
export interface IScriptDefinition {
  /** Logical name used in CacheService.eval(name, ...) */
  name: string
  /** Lua source. Keys in KEYS[1..n], args in ARGV[1..n]. */
  lua: string
}
```

### 9.3 `ScriptManagerService`

```typescript
@Injectable()
export class ScriptManagerService implements OnApplicationBootstrap {
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions,
    @Inject(ConnectionManager) connection: ConnectionManager
  ) // seeds the registry from options.scripts

  /** Preloads every registered script with SCRIPT LOAD (skipped when connection.lazyConnect is set). */
  onApplicationBootstrap(): Promise<void>

  register(name: string, lua: string): void

  /** SCRIPT LOAD + SHA1 cache. Throws SCRIPT_NOT_REGISTERED for an unknown name. */
  load(name: string): Promise<string>

  /**
   * Executes the script. Does NOT namespace `keys` — the caller does (CacheService.eval does).
   * - standalone / sentinel: EVALSHA; on NOSCRIPT, reloads once and retries.
   * - cluster: plain EVAL; at least one key is required for slot routing.
   * A failure of the call, of the reload or of the retry surfaces as
   * CacheException(SCRIPT_EXECUTION_FAILED, { name, originalError }); a cluster call with
   * no keys throws the same code with { name, reason } before any command is sent; an
   * unknown name throws SCRIPT_NOT_REGISTERED.
   */
  eval(name: string, keys: readonly string[], args: ReadonlyArray<string | number>): Promise<unknown>
}
```

### 9.4 Example — Rate Limit Token Bucket

```typescript
BymaxCacheModule.forRoot({
  connection: { url: 'redis://localhost' },
  scripts: [
    {
      name: 'rateLimitTokenBucket',
      lua: `
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refillRate = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local cost = tonumber(ARGV[4])
        local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
        local tokens = tonumber(data[1]) or capacity
        local lastRefill = tonumber(data[2]) or now
        local elapsed = math.max(0, now - lastRefill)
        tokens = math.min(capacity, tokens + (elapsed * refillRate))
        if tokens < cost then
          redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
          redis.call('EXPIRE', key, 3600)
          return { 0, tokens }
        end
        tokens = tokens - cost
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        redis.call('EXPIRE', key, 3600)
        return { 1, tokens }
      `
    }
  ]
})

// Usage
const [allowed, remaining] = (await this.cache.eval(
  'rateLimitTokenBucket',
  [`rl:${userId}`],
  [100, 1, Date.now(), 1]
)) as [number, number]
```

### 9.5 Sharing Between Libs

The `@bymax-one/nest-auth` lib exports the Lua string as a constant (e.g., `AUTH_REFRESH_ROTATE_LUA`) that the consumer registers in `BymaxCacheModule.forRoot`. Internally the lib calls `CacheService.eval('authRefreshRotate', keys, args)`.

---

## 10. Health Check

### 10.1 Methods

```typescript
/** PING + returns true if PONG. Never throws — captures errors internally. */
async isHealthy(): Promise<boolean>

/** Raw PING. Throws on failure. */
async ping(): Promise<string>

/** Redis INFO (memory, clients, replication, etc.). */
async info(section?: string): Promise<string>
```

### 10.2 Integration with `@nestjs/terminus`

```typescript
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly cache: CacheService) {
    super()
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const healthy = await this.cache.isHealthy()
    const result = this.getStatus(key, healthy, { redis: healthy ? 'up' : 'down' })
    if (!healthy) throw new HealthCheckError('Redis down', result)
    return result
  }
}
```

### 10.3 Signals via Events

`events.onEvent` can feed Prometheus/OpenTelemetry metrics. An `'error'` event that carries `data.reason` is not a socket error: `'handler_error'` (a Pub/Sub handler failed, §8.1) and `'forced_disconnect'` (shutdown) are reported through the same event name.

```typescript
BymaxCacheModule.forRoot({
  events: {
    onEvent: (event, data) => {
      if (event === 'ready') metrics.gauge('redis_status').set(1)
      if (event === 'close' || (event === 'error' && data.reason === undefined)) {
        metrics.gauge('redis_status').set(0)
      }
    }
  }
})
```

---

## 11. Connection Strategy

### 11.1 `ConnectionManager`

```typescript
@Injectable()
export class ConnectionManager implements OnModuleInit, OnModuleDestroy {
  #client: Redis | Cluster | null = null // private (#): an ioredis instance carries options.password as a field

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) events?: ICacheEvents
  )

  /** Creates the client; unless lazyConnect is set, waits for 'ready'. An 'error' before ready rejects with CONNECTION_FAILED. */
  onModuleInit(): Promise<void>

  /** Returns the singleton client (created on first use). Redis in standalone/sentinel, Cluster in cluster mode. */
  getClient(): Redis | Cluster

  /** Creates a NEW dedicated connection for subscriber mode (offline queue enabled outside cluster mode). Caller owns the lifecycle. */
  createSubscriberClient(): Redis | Cluster

  /**
   * quit() raced against shutdownTimeoutMs (a SHUTDOWN_TIMEOUT CacheException rejects the race).
   * On timeout or failure: emits onEvent('error', { role: 'main', reason: 'forced_disconnect', shutdownTimeoutMs })
   * and calls disconnect().
   */
  onModuleDestroy(): Promise<void>
}
```

Client construction by mode:

- `standalone` — `new Redis(options)`; discrete fields are applied first and the parsed `connection.url` overrides them.
- `sentinel` — `new Redis({ ...options, sentinels, name, sentinelPassword, password, role, natMap })`; `role: 'replica'` is passed to ioredis as `'slave'`.
- `cluster` — `new Cluster(cluster.nodes, cluster.options)` (ioredis `Cluster`).

Every client emits `connect`, `ready`, `error`, `close`, `reconnecting` and `end` to `events.onEvent` with a `role` of `'main'` or `'subscriber'`. A throw from the callback is swallowed.

### 11.2 `ICacheEvents` interface

```typescript
export type CacheEventName = 'connect' | 'ready' | 'error' | 'close' | 'reconnecting' | 'end'

export interface ICacheEvents {
  /**
   * Synchronous callback for connection events.
   * Must be fast — stack log/metric. Never throw — exceptions are swallowed.
   */
  onEvent?: (event: CacheEventName, data: Record<string, unknown>) => void
}
```

`data` never carries connection credentials and always carries `role: 'main' | 'subscriber'` for connection events. The `CacheEventName` union has no dedicated member for failures that are not socket errors, so `'error'` also carries:

| `data.reason`         | Source                                                          | Other fields                             |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| _(absent)_            | ioredis socket error                                            | `error` (message)                        |
| `'handler_error'`     | A Pub/Sub handler threw or a payload failed to deserialize (§8) | `role: 'subscriber'`, `channel`, `error` |
| `'forced_disconnect'` | Graceful `quit()` exceeded `shutdownTimeoutMs` (shutdown)       | `role: 'main'`, `shutdownTimeoutMs`      |

### 11.3 `parseRedisUrl`

Parses `redis://`, `rediss://` (TLS) URLs with user, password, port, and database. Returns `Partial<RedisOptions>` — discrete options serve as fallback.

### 11.4 Retry / Reconnection Behavior

| Scenario                             | Default behavior                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Initial connection fails             | `retryStrategy` = `Math.min(times * 50, 2000)` (50ms, 100ms, …, 2s). No total limit. |
| Individual command fails             | Retried up to `maxRetriesPerRequest` (3) before propagating                          |
| Server returns `READONLY` (failover) | `reconnectOnError` returns `true` — forces reconnection                              |
| Other errors                         | `reconnectOnError` returns `false` — error propagates                                |
| `client.quit()` on shutdown          | Waits up to `shutdownTimeoutMs`; if exceeded, forces `disconnect()`                  |

### 11.5 Offline Queue Disabled

`enableOfflineQueue: false` by default — when the connection drops, new commands fail immediately instead of queueing. We prefer to fail fast rather than OOM from silent buffering. Consumers that need buffering enable it explicitly. The dedicated subscriber connection is the exception in standalone and sentinel modes: its offline queue is enabled so a `subscribe` issued before the socket is ready is queued. In cluster mode the subscriber uses the configured cluster options.

---

## 12. Error Code Catalog

### 12.1 `CacheException`

```typescript
export class CacheException extends HttpException {
  readonly code: CacheErrorCode
  readonly details: Record<string, unknown> | null

  constructor(code: CacheErrorCode, details?: Record<string, unknown>, statusCode?: HttpStatus) {
    super(
      {
        error: {
          code,
          message: CACHE_ERROR_MESSAGES.get(code) ?? 'Cache error',
          details: details ?? null
        }
      },
      statusCode ?? CACHE_ERROR_STATUS.get(code) ?? HttpStatus.INTERNAL_SERVER_ERROR
    )
    this.code = code
    this.details = details ?? null
  }
}
```

`details` is serialized verbatim into the response body, so it never carries any part of a stored value. When `statusCode` is omitted the status comes from §12.2.

`KEY_NOT_IN_SCOPE` keeps the `key` in `details`: it is the key the caller itself sent to `./admin`, not stored content. RFC 9457 §3.1.4 says a problem detail ought to focus on helping the client correct the problem (<https://www.rfc-editor.org/rfc/rfc9457.html>), and the OWASP Error Handling Cheat Sheet is about implementation details (<https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html>), which a caller's own key is not. Its status is 500, like every code §12.2 gives no other status.

### 12.2 Code Table

| Code                                 | HTTP | When                                                                                                                                |
| ------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `cache.connection_failed`            | 500  | Invalid or missing `connection.url` / `connection.host`; `shutdownTimeoutMs` or `connectTimeout` below 100; an error before `ready` |
| `cache.command_timeout`              | 504  | Reserved: the status is mapped, the library does not throw it (ioredis reports `commandTimeout` itself)                             |
| `cache.connection_lost`              | 503  | Reserved: the status is mapped, the library does not throw it                                                                       |
| `cache.serialization_failed`         | 500  | `JsonSerializer.serialize` threw (also a top-level `undefined`, function or symbol); a custom `ISerializer` must throw it itself    |
| `cache.deserialization_failed`       | 500  | `JsonSerializer.deserialize` threw; a custom `ISerializer` must throw it itself                                                     |
| `cache.invalid_namespace`            | 500  | Namespace empty or whitespace-only, contains the separator or a glob metacharacter (`* ? [ \`), or the separator is empty           |
| `cache.invalid_key`                  | 400  | `prefix` or `id` empty (`applyNamespace`: key empty)                                                                                |
| `cache.script_not_registered`        | 500  | Tried to execute unknown script                                                                                                     |
| `cache.script_execution_failed`      | 500  | Script returned a Redis error; cluster `eval` without a key                                                                         |
| `cache.script_registry_missing`      | 500  | `CacheService.eval` called without a `ScriptManagerService`                                                                         |
| `cache.flush_disabled_in_production` | 403  | `flushNamespace` in prod without `allowFlushInProduction`                                                                           |
| `cache.cluster_misconfigured`        | 500  | `mode === 'cluster'` without `cluster.nodes`                                                                                        |
| `cache.sentinel_misconfigured`       | 500  | `mode === 'sentinel'` without `sentinel.sentinels` or `sentinel.name`                                                               |
| `cache.shutdown_timeout`             | 500  | `quit()` exceeded `shutdownTimeoutMs`; handled internally by forcing `disconnect()`                                                 |
| `cache.unsupported_in_cluster`       | 500  | `scan`, `getClient` or `flushNamespace` called in cluster mode                                                                      |
| `cache.invalid_scope`                | 500  | `./admin`: a scope or threshold is malformed (§18)                                                                                  |
| `cache.scope_not_found`              | 500  | `./admin`: no scope is declared under the given id                                                                                  |
| `cache.scope_not_readable`           | 500  | Reserved: the library does not throw it; `revealValue` returns `status: 'withheld'` instead                                         |
| `cache.key_not_in_scope`             | 500  | `./admin`: the key does not belong to the named scope                                                                               |

### 12.3 Exported Constants

```typescript
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
  UNSUPPORTED_IN_CLUSTER: 'cache.unsupported_in_cluster',
  INVALID_SCOPE: 'cache.invalid_scope',
  SCOPE_NOT_FOUND: 'cache.scope_not_found',
  SCOPE_NOT_READABLE: 'cache.scope_not_readable',
  KEY_NOT_IN_SCOPE: 'cache.key_not_in_scope'
} as const satisfies Record<string, `cache.${string}`>

export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[keyof typeof CACHE_ERROR_CODES]
```

The server entry also exports `CACHE_ERROR_MESSAGES`, a `ReadonlyMap<CacheErrorCode, string>` of default English messages.

---

## 13. What is NOT in the package

| Feature                                       | Why                                                                | Where it lives                                                        |
| --------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Rate limiting (token bucket, sliding window)  | Domain policy — varies by endpoint, tenant, feature                | Future `nest-rate-limit` lib OR app via `cache.eval(scriptName, ...)` |
| Distributed locks (Redlock, single-instance)  | Policy varies (TTL, retry, fairness)                               | Future `nest-lock` lib OR app via Lua + `cache.setNx`                 |
| BullMQ client                                 | Requires `maxRetriesPerRequest: null` — different from the default | `@bymax-one/nest-queue` creates its own connection                    |
| Cache aside / read-through / write-through    | Opinionated patterns                                               | App implements them in repositories                                   |
| Embedded logger                               | Does not decide the logging stack                                  | Consumer injects via `events.onEvent` (plug in `nest-logger`)         |
| Metrics (Prometheus, OpenTelemetry)           | Does not bring observability peer deps                             | Wrapper via `events.onEvent` or interceptor                           |
| Cache invalidation patterns (tag-based, deps) | High complexity, domain policy                                     | App OR future `nest-cache-tags` lib                                   |
| Compression (gzip, lz4)                       | Costs vary by workload                                             | Custom `ISerializer`                                                  |
| At-rest encryption of values                  | Sensitive data should be encrypted before reaching the cache       | App via `node:crypto` or custom serializer                            |
| Schema validation (Zod) on values             | The lib does not know the schema                                   | App validates before `cache.set`                                      |
| Redis Streams (XADD, XREAD, XGROUP)           | Queue semantics — deserve their own lib                            | Access via `cache.getClient().xadd(...)` or future `nest-stream` lib  |

**General rule:** `@bymax-one/nest-cache` provides reliable atomic primitives. Compositions and policies stay outside.

---

## 14. Dependencies

### 14.1 `dependencies` — Empty

```json
{ "dependencies": {} }
```

Zero transitive deps; everything is peer.

### 14.2 `peerDependencies`

```json
{
  "peerDependencies": {
    "@nestjs/common": "^11.0.16",
    "@nestjs/core": "^11.1.18",
    "ioredis": "^6.0.0",
    "reflect-metadata": "^0.2.0"
  }
}
```

> **Corrected 2026-05-30 (§0):** peers are **NOT** optional — the previous
> `peerDependenciesMeta.optional` block was removed. Marking the NestJS peers optional
> broke server-subpath resolution in consumers (proven by the dogfood smoke test).

| Peer               | Version    | Why                                                                      |
| ------------------ | ---------- | ------------------------------------------------------------------------ |
| `@nestjs/common`   | `^11.0.16` | Decorators (`@Injectable`, `@Inject`, `@Optional`, `@Global`), lifecycle |
| `@nestjs/core`     | `^11.1.18` | NestJS runtime peer; not imported directly by library sources            |
| `ioredis`          | `^6.0.0`   | Redis client with TLS, sentinel, cluster support                         |
| `reflect-metadata` | `^0.2.0`   | NestJS decorators                                                        |

`ioredis` is the only functional dep; the rest is standard for any NestJS project.

### 14.3 `devDependencies`

- `ioredis-mock ^8` — unit tests without real Redis
- `testcontainers ^12` — e2e tests with real Redis

### 14.4 `engines` and `packageManager`

```json
{
  "packageManager": "pnpm@11.20.0",
  "engines": { "node": ">=24.0.0" }
}
```

---

## 15. Implementation Phases

### 15.1 Phase 1 — Connection + Base Module

**Goal:** functional skeleton with singleton and lifecycle.

1. Repo setup (copy configs from `nest-auth`: tsconfig, tsup, jest, eslint, prettier, stryker)
2. `package.json` with peer deps and subpath exports
3. `BymaxCacheModule` with `forRoot`/`forRootAsync`
4. `BymaxCacheModuleOptions` and `BymaxCacheModuleAsyncOptions`
5. Injection tokens (`Symbol`)
6. `ConnectionManager` (creation, `OnModuleInit`/`OnModuleDestroy`, listeners)
7. `parseRedisUrl` utility
8. `ICacheEvents` interface
9. `CacheException` + `CACHE_ERROR_CODES`
10. Unit tests with `ioredis-mock`

**Exit criterion:** `pnpm build` produces `dist/`, `pnpm test` passes, module connects to local Redis.

### 15.2 Phase 2 — Typed Helpers

**Goal:** main public surface.

1. `KeyBuilder` (namespace + prefix + id, configurable `keySeparator`)
2. `JsonSerializer` + `ISerializer` interface
3. `CacheService` basic methods: `get/set/setNx/del/delMany/exists`
4. Numeric: `incr/decr/expire/ttl/persist`
5. Batch: `mget/mset`
6. Hash: `hget/hset/hgetall/hdel`
7. Set: `sadd/srem/smembers/sismember/scard`
8. Iteration: `keys`, `scan` (async iterator)
9. Raw `pipeline()` + `getClient()` escape hatch
10. Options validation in `forRoot`
11. Unit tests with ≥ 95% coverage on `CacheService`

**Exit criterion:** API with complete JSDoc, coverage ≥ 80%, initial e2e test with Testcontainers.

### 15.3 Phase 3 — Pub/Sub + Lua Scripts

**Goal:** advanced features.

1. `PubSubService` (`publish/subscribe/psubscribe`)
2. Lazy subscriber via `ConnectionManager.createSubscriberClient`
3. Automatic reconnection of the subscriber
4. `IPubSubHandler` interface
5. `ScriptManagerService` (`register/load/eval`)
6. Support for pre-registered scripts via `options.scripts`
7. Fallback `EVALSHA → EVAL` on `NOSCRIPT`
8. `CacheService.eval` delegating to `ScriptManagerService`
9. Health check (`isHealthy/ping/info`)
10. Unit + e2e tests for Pub/Sub and scripts

**Exit criterion:** Coverage ≥ 80%, complete e2e suite against real Redis.

### 15.4 Phase 4 — Quality and Release

**Goal:** Definition of Done from the `EXTRACTION_ROADMAP`.

1. Coverage ≥ 80% (≥ 95% on `connection/` and `services/`)
2. E2E suite with Testcontainers covering connection, get/set, Pub/Sub, scripts, reconnection
3. Mutation testing via Stryker — score ≥ 85%
4. `scripts/check-size.mjs` (per-subpath budgets in **KiB brotli**, calibrated to the real artifact — see the script; provisional while scaffolding, per §0)
5. GitHub Actions workflows (ci, codeql, release, scorecard)
6. Complete `README.md`
7. `CHANGELOG.md` with `0.1.0`
8. `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`
9. `docs/development_plan.md` and `docs/development_tasks.md`
10. Smoke test on a real consumer (replace `_commons_/cache/` in `bymax-fitness-ai` via npm link)
11. Tag `v0.1.0`, `release.yml` with `--provenance`
12. Validation on npmjs.com

**Exit criterion:** Package published, OpenSSF Scorecard ≥ 7.0, active provenance badge.

### 15.5 Suggested Schedule

| Phase     | Estimate       | Dependency |
| --------- | -------------- | ---------- |
| Phase 1   | 2-3 days       | —          |
| Phase 2   | 3-4 days       | Phase 1    |
| Phase 3   | 3-4 days       | Phase 2    |
| Phase 4   | 2-3 days       | Phase 3    |
| **Total** | **10-14 days** | —          |

Strategic pause after Phase 2 — validate the API with a real consumer before adding Pub/Sub and Lua.

---

## 16. Known Limitations

1. **No Redis Streams in this version.** `XADD`/`XREAD`/`XGROUP` are deferred to a future `nest-stream`. Access via `cache.getClient().xadd(...)` remains available.
2. **Cluster mode is experimental.** Works via `ioredis.Cluster` passthrough, but multi-key commands require all keys to be in the same slot — `KeyBuilder` does not enforce this. `scan`, `getClient` and `flushNamespace` throw `UNSUPPORTED_IN_CLUSTER`.
3. **No hot-reload of configuration.** Changing `namespace`, `serializer`, or `connection.url` requires a restart.
4. **Pub/Sub does not persist messages.** Limitation of Redis Pub/Sub, not of the lib.
5. **`KEYS` may block the server.** `cache.keys()` exists but JSDoc discourages it in production.
6. **No smart retry per command.** After `maxRetriesPerRequest`, the error propagates; the consumer implements a circuit breaker at a higher layer if needed.
7. **JSON loses types.** `Date`, `Map`, `Set`, `BigInt`, `undefined` do not roundtrip — use a custom serializer.
8. **No value size limit.** Redis accepts up to 512MB; the lib imposes no limit. Values > 1MB should be rethought (chunking, external storage).

---

## 17. Example Integration

### 17.1 Typed Cache Wrapper

Scenario: the `bymax-fitness` app wants to cache `WorkoutSession` with a 1h TTL, invalidation on update, and hit/miss counters.

```typescript
// workout-session.cache.ts
import { Injectable } from '@nestjs/common'
import { CacheService } from '@bymax-one/nest-cache'

export interface WorkoutSession {
  id: string
  userId: string
  startedAt: string
  durationSeconds: number
}

@Injectable()
export class WorkoutSessionCache {
  private readonly PREFIX = 'workouts:session'
  private readonly TTL = 3600

  constructor(private readonly cache: CacheService) {}

  async get(sessionId: string): Promise<WorkoutSession | null> {
    const session = await this.cache.get<WorkoutSession>(this.PREFIX, sessionId)
    await this.cache.incr('workouts:metrics', session ? 'cache_hits' : 'cache_misses')
    return session
  }

  async set(session: WorkoutSession): Promise<void> {
    await this.cache.set(this.PREFIX, session.id, session, this.TTL)
  }

  async invalidate(sessionId: string): Promise<void> {
    await this.cache.del(this.PREFIX, sessionId)
  }

  async getMetrics(): Promise<{ hits: number; misses: number }> {
    const [hits, misses] = await this.cache.mget<number>('workouts:metrics', [
      'cache_hits',
      'cache_misses'
    ])
    return { hits: hits ?? 0, misses: misses ?? 0 }
  }
}
```

### 17.2 Wiring in `AppModule`

```typescript
@Module({
  imports: [
    ConfigModule.forRoot(),
    BymaxCacheModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        mode: 'standalone',
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
          lazyConnect: false,
          tls: config.get('NODE_ENV') === 'production' ? {} : undefined
        },
        namespace: 'fitness',
        events: {
          onEvent: (event, data) => {
            /* plug logger here */
          }
        }
      }),
      isGlobal: true
    })
  ],
  providers: [WorkoutSessionCache],
  exports: [WorkoutSessionCache]
})
export class AppModule {}
```

### 17.3 Use in a Domain Service

```typescript
@Injectable()
export class WorkoutSessionService {
  constructor(
    private readonly db: WorkoutRepository,
    private readonly cache: WorkoutSessionCache
  ) {}

  async findById(sessionId: string): Promise<WorkoutSession | null> {
    const cached = await this.cache.get(sessionId)
    if (cached) return cached
    const fromDb = await this.db.findById(sessionId)
    if (fromDb) await this.cache.set(fromDb)
    return fromDb
  }

  async update(sessionId: string, dto: UpdateDto): Promise<WorkoutSession> {
    const updated = await this.db.update(sessionId, dto)
    await this.cache.invalidate(sessionId)
    return updated
  }
}
```

### 17.4 Scenario 2 — Distributed Invalidation via Pub/Sub

Multiple API instances consume the same Redis. When one instance updates a workout, all the others need to invalidate their in-memory L1 cache.

```typescript
@Injectable()
export class DistributedCacheInvalidator implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => Promise<void>

  constructor(
    private readonly pubsub: PubSubService,
    private readonly localCache: LocalMemoryCache
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.pubsub.subscribe<{ entity: string; id: string }>(
      'invalidate',
      async ({ entity, id }) => {
        this.localCache.delete(`${entity}:${id}`)
      }
    )
  }

  async broadcast(entity: string, id: string): Promise<void> {
    await this.pubsub.publish('invalidate', { entity, id })
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribe?.()
  }
}
```

### 17.5 Scenario 3 — Lua Shared Between Libs

```typescript
import { AUTH_REFRESH_ROTATE_LUA } from '@bymax-one/nest-auth/shared'

BymaxCacheModule.forRoot({
  connection: { url: 'redis://...' },
  namespace: 'app',
  scripts: [
    { name: 'compareAndSet', lua: '...' },
    { name: 'authRefreshRotate', lua: AUTH_REFRESH_ROTATE_LUA }
  ]
})
```

The `@bymax-one/nest-auth` lib exports the Lua string as a constant and calls `CacheService.eval('authRefreshRotate', keys, args)` internally.

### 17.6 Scenario 4 — Health Endpoint

```typescript
@Controller('health')
export class HealthController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  async check(): Promise<{ status: 'ok' | 'degraded'; redis: boolean }> {
    const redis = await this.cache.isHealthy()
    return { status: redis ? 'ok' : 'degraded', redis }
  }
}
```

---

## 18. The `./admin` Subpath

`@bymax-one/nest-cache/admin` is a privileged, **read-only** administration surface over an already configured `BymaxCacheModule`. It is kept out of the main entry on purpose (see §3.2 for the import rule). The application declares which keyspaces exist; the library validates the declaration and reads only inside it.

### 18.1 `BymaxCacheAdminModule`

`BymaxCacheAdminModule.forRoot(options)` / `forRootAsync({ imports, inject, useFactory, isGlobal })` provide `CacheStatusService`, `CacheAdminService` and the `BYMAX_CACHE_ADMIN_OPTIONS` token. It is **not global by default** (`isGlobal: false`; for `forRootAsync` the flag is a top-level field, decided before the factory resolves). `BymaxCacheModule` must be resolvable from the importing module. Options are validated at wiring and throw `INVALID_SCOPE` when malformed.

| Option              | Type                    | Default | Meaning                                                                                                           |
| ------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `scopes`            | `readonly CacheScope[]` | —       | Required, non-empty. The keyspaces this deployment exposes                                                        |
| `degradedAboveMs`   | `number`                | `250`   | Round trip above which health reports `degraded`                                                                  |
| `probeTimeoutMs`    | `number`                | `2000`  | How long a health probe waits before reporting `down`                                                             |
| `scanLimit`         | `number`                | `500`   | Most keys one listing reads before reporting the page incomplete                                                  |
| `commandBatchLimit` | `number`                | `100`   | Most commands one pipeline flush sends; a flush always carries at least one key, so a lower limit may be exceeded |
| `revealLimit`       | `number`                | `200`   | Most members or hash fields one reveal returns                                                                    |
| `revealStringLimit` | `number`                | `4096`  | Most characters one revealed string carries                                                                       |
| `isGlobal`          | `boolean`               | `false` | Register the module globally                                                                                      |

Each threshold must be a positive integer.

### 18.2 Scopes

```typescript
interface CacheScope {
  readonly id: string // unique; a caller names a scope by id and never supplies a pattern
  readonly label: string
  readonly pattern: string // SCAN match: a literal prefix, optionally followed by one trailing '*'
  readonly isReadable: boolean // false: values are withheld; listing, types, TTLs and sizes stay available
  readonly origin: string // why the keyspace exists, rendered verbatim as plain text
}
```

- `pattern` must match `^[^*?[\\]+\*?$`: at least one literal character, no glob metacharacter (`* ? [ \`) except a single trailing `*`. Key membership is therefore exact by construction (`isKeyInScope`); do not relax it, because a matcher more permissive than the server's is a silent cross-scope leak.
- An empty scope list, an empty field, a duplicate `id` or a malformed `pattern` throws `INVALID_SCOPE`. An unknown id throws `SCOPE_NOT_FOUND`; a key outside the named scope throws `KEY_NOT_IN_SCOPE`.
- Scopes are frozen at wiring.

### 18.3 Services

**`CacheStatusService`**

| Method     | Returns                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `health()` | `PING` probe: `up`, `degraded` (latency above `degradedAboveMs`) or `down` (error, timeout or a reply other than `PONG`), plus `mode`, `isScanSupported` (false in cluster mode) and `degradedAboveMs` |
| `stats()`  | Parsed Redis `INFO` (`RedisStats`)                                                                                                                                                                     |
| `config()` | Resolved configuration with credentials withheld; script **names** only (never Lua bodies)                                                                                                             |

**`CacheAdminService`**

| Method                                         | Returns                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listScopes()`                                 | The declared scopes                                                                                                                                                                                                                                               |
| `listKeys(scopeId, { cursor?, includeSize? })` | `KeyspacePage`: `scopeId`, entries (key, type, TTL, optional size), `sampledCount`, `sampledBytes`, `isComplete`, `scanLimit`, `cursor`. The scan stops after `scanLimit` keys; the final batch may overshoot by up to one batch. Size (`MEMORY USAGE`) is opt-in |
| `describeKey(scopeId, key)`                    | `KeyDetail`: type, TTL and `isReadable`                                                                                                                                                                                                                           |
| `revealValue(scopeId, key)`                    | `RevealResult`: `revealed`, `withheld` or `missing`                                                                                                                                                                                                               |

A scope with `isReadable: false` is refused **before** any read, so the value never enters the process; the result carries the scope's `origin` instead. A revealed value is `string` (truncated to `revealStringLimit`), `hash` (`{ field, value }` entries), `members` (set or list), `scored` (sorted set) or `unsupported`; collections are truncated to `revealLimit` and `isComplete` reports whether truncation happened.

### 18.4 Read-only guarantee

The subpath issues no mutating Redis command. `pnpm check:admin-readonly` (`scripts/check-admin-readonly.mjs`, part of `prepublishOnly`) enforces it:

1. No file under `src/admin` may declare a method named after a mutating command. The reader contracts (`IRedisReader`, `IRedisPipeline`), through which `CacheAdminService` reads, are where such a declaration would appear.
2. Every command name passed to the `call(...)` escape hatch must be on a read-only allowlist.
3. The subpath must not import `ioredis` as a value, so it cannot construct its own client.

`CacheStatusService` reaches Redis through the server's `CacheService.ping()` and `info()`, which are read-only.

---

## Appendix A — Glossary

| Term                   | Meaning                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| **DI**                 | Dependency Injection                                               |
| **DIP**                | Dependency Inversion Principle                                     |
| **Singleton**          | A single instance managed by the DI container                      |
| **Lazy connect**       | Connection created only on the first command                       |
| **Pipeline (ioredis)** | Batch of commands in a single round trip                           |
| **EVALSHA**            | Executes a pre-loaded Lua script via SHA1                          |
| **NOSCRIPT**           | Redis error indicating that the script is not cached on the server |
| **SCAN**               | Cursor-based iteration over keys without blocking                  |
| **Sentinel**           | Redis high availability with automatic failover                    |
| **Cluster**            | Sharded mode with hash slot routing                                |
| **Subscriber**         | Client in dedicated mode for SUBSCRIBE/PSUBSCRIBE                  |

---

## Appendix B — Architectural Decisions (ADRs)

| ADR | Decision                                                       | Justification                                                          |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 001 | `ioredis` as the only functional peer, instead of `node-redis` | Native support for sentinel/cluster/pipelines and better performance   |
| 002 | Mandatory namespace (default `'app'`)                          | Isolation on shared Redis instances                                    |
| 003 | Default JSON serializer, open interface                        | JSON covers 90% of cases; those who need msgpack plug their own        |
| 004 | No BullMQ client                                               | Conflicting configuration; `nest-queue` creates its own connection     |
| 005 | Pub/Sub in the same package                                    | Pub/Sub is Redis 101; separating would create friction with no benefit |
| 006 | `EVALSHA` + reload and retry on `NOSCRIPT` (`EVAL` in cluster) | Standard production optimization, transparent                          |
| 007 | `flushNamespace` blocked in prod by default                    | Destructive operation; better to fail visibly                          |
| 008 | Events callback instead of embedded logger                     | Keeps zero deps; consumer plugs the logger                             |
| 009 | Lazy subscriber                                                | Apps that only use cache do not pay the cost of a 2nd TCP connection   |
| 010 | Graceful shutdown with configurable timeout                    | `quit` can hang; timeout guarantees deterministic shutdown             |
