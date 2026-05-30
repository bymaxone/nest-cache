# @bymax-one/nest-cache — Complete Technical Specification

> **Version:** 1.0.0
> **Last updated:** 2026-05-30 (aligned to the Bymax lib standard — see §0)
> **Status:** Draft for implementation
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

| Aspect               | Detail                                      |
| -------------------- | ------------------------------------------- |
| Registry             | Public npm (`@bymax-one/nest-cache`)        |
| License              | MIT                                         |
| Runtime              | Node.js 24+                                 |
| Framework            | NestJS 11+                                  |
| Subpaths             | `.` (server) + `./shared` (types/constants) |
| Main peer dependency | `ioredis ^5`                                |

### 1.5 Design Principles

1. **Configuration over convention.** Everything goes through `forRoot`/`forRootAsync`. Sensible defaults when applicable.
2. **Zero opinion on environment.** The lib does not read `process.env` — the app injects the options.
3. **Singleton by default.** One command connection, plus an on-demand subscriber.
4. **Correct lifecycle.** `OnModuleInit` to connect, `OnModuleDestroy` for graceful `quit()` with timeout.
5. **Typed helpers.** Generic `<T>` API with default JSON serialization and a hook for custom serializers.
6. **Strict namespace.** Every key passes through `KeyBuilder(prefix, id)` — raw strings are discouraged.
7. **Lua-first for atomicity.** Other libs register scripts via `ScriptManager.register(name, lua)` and invoke them by name.
8. **Explicit observability.** Connection events exposed via the `events.onEvent` callback — in the embedded logger.
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
2. **`OnModuleInit`** (if `lazyConnect = false`) — `ConnectionManager` creates `Redis()` and waits for `'ready'`.
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

The `subscriber` is created on the first call to `subscribe`/`psubscribe`, inheriting the same `RedisOptions` as the main client.

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
│   │   │   └── cache-exception.ts
│   │   └── constants/
│   │       ├── default-namespace.ts
│   │       └── default-timeouts.ts
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
    └── cache.service.e2e.spec.ts
```

### 3.2 Subpath Exports

| Subpath      | Entry point             | Description                   | Peer deps                   |
| ------------ | ----------------------- | ----------------------------- | --------------------------- |
| `.` (server) | `dist/server/index.mjs` | Dynamic module, services      | `@nestjs/common`, `ioredis` |
| `./shared`   | `dist/shared/index.mjs` | Types, constants, error codes | None                        |

```json
{
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    }
  }
}
```

### 3.3 Public API

**Server (`@bymax-one/nest-cache`):**

```typescript
export { BymaxCacheModule } from './bymax-cache.module'
export {
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_EVENTS
} from './bymax-cache.constants'
export { CacheService } from './services/cache.service'
export { PubSubService } from './services/pubsub.service'
export { ScriptManagerService } from './services/script-manager.service'
export type {
  BymaxCacheModuleOptions,
  BymaxCacheModuleAsyncOptions,
  ICacheEvents,
  ISerializer,
  IScriptDefinition,
  IPubSubHandler
} from './interfaces'
export { CacheException, CACHE_ERROR_CODES } from './errors/cache-error-codes'
export type { Redis, RedisOptions, RedisKey } from 'ioredis'
```

**Shared (`@bymax-one/nest-cache/shared`):**

```typescript
export type { CacheEventName, CacheConnectionStatus } from './types/cache-event.types'
export type { SerializableValue } from './types/serializable-value.types'
export type { CacheNamespace, CacheKeyPrefix } from './types/cache-config.types'
export { CACHE_ERROR_CODES } from './constants/error-codes'
export { CACHE_EVENT_NAMES } from './constants/event-names'
```

> **Public vs internal.** Only what appears in `src/server/index.ts` and `src/shared/index.ts` is public. Internal utilities (`key-builder.ts`, `json-serializer.ts`, `parse-redis-url.ts`) are not re-exported.

---

## 4. Configuration API

### 4.1 `BymaxCacheModuleOptions` interface

```typescript
import type { RedisOptions, SentinelAddress, ClusterNode, ClusterOptions } from 'ioredis'

export interface BymaxCacheModuleOptions {
  /** Connection mode. Default: 'standalone' */
  mode?: 'standalone' | 'sentinel' | 'cluster'

  /**
   * Connection options (standalone mode).
   * Accepts URL (`redis://`/`rediss://`) or discrete properties.
   * When both are provided, URL takes priority — discrete properties serve as fallback.
   */
  connection?: {
    url?: string
    host?: string
    port?: number
    password?: string
    db?: number
    username?: string
    tls?: import('tls').ConnectionOptions
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
    keepAlive?: number
    noDelay?: boolean
    family?: 4 | 6
  }

  /** Only when mode === 'sentinel' */
  sentinel?: {
    sentinels: SentinelAddress[]
    name: string
    sentinelPassword?: string
    password?: string
    role?: 'master' | 'slave'
  }

  /** Only when mode === 'cluster' */
  cluster?: {
    nodes: ClusterNode[]
    options?: ClusterOptions
  }

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

  /** Default: true */
  isGlobal?: boolean

  /** Lua scripts pre-registered at initialization */
  scripts?: IScriptDefinition[]
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

### 4.3 Options table with defaults

| Option                            | Type                                      | Required | Default                  |
| --------------------------------- | ----------------------------------------- | -------- | ------------------------ |
| `mode`                            | `'standalone' \| 'sentinel' \| 'cluster'` | In the   | `'standalone'`           |
| `connection.url`                  | `string`                                  | \*       | —                        |
| `connection.host`                 | `string`                                  | \*       | `'localhost'`            |
| `connection.port`                 | `number`                                  | In the   | `6379`                   |
| `connection.password`             | `string`                                  | In the   | —                        |
| `connection.db`                   | `number`                                  | In the   | `0`                      |
| `connection.username`             | `string`                                  | In the   | —                        |
| `connection.tls`                  | `ConnectionOptions`                       | In the   | —                        |
| `connection.lazyConnect`          | `boolean`                                 | In the   | `false`                  |
| `connection.connectTimeout`       | `number`                                  | In the   | `10000`                  |
| `connection.commandTimeout`       | `number`                                  | In the   | `5000`                   |
| `connection.maxRetriesPerRequest` | `number`                                  | In the   | `3`                      |
| `connection.enableReadyCheck`     | `boolean`                                 | In the   | `true`                   |
| `connection.enableOfflineQueue`   | `boolean`                                 | In the   | `false`                  |
| `connection.retryStrategy`        | `function`                                | In the   | exp. backoff             |
| `connection.reconnectOnError`     | `function`                                | In the   | reconnects on `READONLY` |
| `connection.keepAlive`            | `number`                                  | In the   | `0`                      |
| `connection.noDelay`              | `boolean`                                 | In the   | `true`                   |
| `connection.family`               | `4 \| 6`                                  | In the   | `4`                      |
| `sentinel.sentinels`              | `SentinelAddress[]`                       | \*\*     | —                        |
| `sentinel.name`                   | `string`                                  | \*\*     | —                        |
| `cluster.nodes`                   | `ClusterNode[]`                           | \*\*\*   | —                        |
| `namespace`                       | `string`                                  | In the   | `'app'`                  |
| `keySeparator`                    | `string`                                  | In the   | `':'`                    |
| `serializer`                      | `ISerializer`                             | In the   | JSON                     |
| `events.onEvent`                  | `function`                                | In the   | —                        |
| `shutdownTimeoutMs`               | `number`                                  | In the   | `5000`                   |
| `isGlobal`                        | `boolean`                                 | In the   | `true`                   |
| `scripts`                         | `IScriptDefinition[]`                     | In the   | `[]`                     |

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

The module validates on `OnModuleInit` and throws `CacheException` if:

- `mode === 'sentinel'` without `sentinel.sentinels` or `sentinel.name`
- `mode === 'cluster'` without `cluster.nodes`
- `mode === 'standalone'` without `connection.url` or `connection.host`
- `namespace` empty or contains `keySeparator`
- `shutdownTimeoutMs < 100`
- `connection.connectTimeout < 100`

---

## 5. Main Service — `CacheService`

### 5.1 Responsibility

`CacheService` is the public facade for typed Redis operations. Each method:

1. Composes the end key via `KeyBuilder` (applies namespace)
2. Delegates to `ConnectionManager.getClient()` (singleton)
3. Serializes/deserializes via `Serializer` when applicable
4. Catches `ioredis` errors and propagates them as `CacheException` when semantic

### 5.2 Method Table

| Method                                               | Signature                                                                    | Description                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `get<T>`                                             | `(prefix: string, id: string) => Promise<T \| null>`                         | Read + deserialize                                                 |
| `getRaw`                                             | `(prefix: string, id: string) => Promise<string \| null>`                    | Read string without deserializing                                  |
| `set<T>`                                             | `(prefix, id, value: T, ttlSeconds?: number) => Promise<void>`               | Serialize + write with optional TTL                                |
| `setRaw`                                             | `(prefix, id, value: string, ttlSeconds?: number) => Promise<void>`          | Write string without serializing                                   |
| `setNx<T>`                                           | `(prefix, id, value: T, ttlSeconds?: number) => Promise<boolean>`            | SET NX — true if written                                           |
| `del`                                                | `(prefix, id) => Promise<number>`                                            | DEL                                                                |
| `delMany`                                            | `(prefix, ids: string[]) => Promise<number>`                                 | DEL in batch                                                       |
| `exists`                                             | `(prefix, id) => Promise<boolean>`                                           | EXISTS                                                             |
| `incr`                                               | `(prefix, id, by?: number) => Promise<number>`                               | INCR / INCRBY                                                      |
| `decr`                                               | `(prefix, id, by?: number) => Promise<number>`                               | DECR / DECRBY                                                      |
| `expire`                                             | `(prefix, id, ttlSeconds: number) => Promise<boolean>`                       | EXPIRE                                                             |
| `ttl`                                                | `(prefix, id) => Promise<number>`                                            | TTL (`-2` does not exist, `-1` in the expiration)                  |
| `persist`                                            | `(prefix, id) => Promise<boolean>`                                           | PERSIST                                                            |
| `mget<T>`                                            | `(prefix, ids: string[]) => Promise<Array<T \| null>>`                       | MGET                                                               |
| `mset<T>`                                            | `(prefix, entries: Array<[string, T]>) => Promise<void>`                     | MSET (no TTL — use pipeline)                                       |
| `keys`                                               | `(prefix, pattern: string) => Promise<string[]>`                             | KEYS — restricted use (see §5.4)                                   |
| `scan`                                               | `(prefix, pattern, count?: number) => AsyncIterable<string>`                 | SCAN cursor-based — preferred in production                        |
| `hget<T>` / `hset<T>` / `hgetall<T>` / `hdel`        | Hash operations                                                              | HGET/HSET/HGETALL/HDEL                                             |
| `sadd` / `srem` / `smembers` / `sismember` / `scard` | Set operations                                                               | SADD/SREM/SMEMBERS/SISMEMBER/SCARD                                 |
| `pipeline`                                           | `() => ChainablePipeline`                                                    | Raw pipeline (consumer composes keys)                              |
| `eval`                                               | `(scriptName, keys: string[], args: (string\|number)[]) => Promise<unknown>` | Executes registered Lua                                            |
| `getClient`                                          | `() => Redis`                                                                | Escape hatch — keys are NOT auto-namespaced                        |
| `isHealthy` / `ping` / `info`                        | Health                                                                       | PING / INFO                                                        |
| `flushNamespace`                                     | `() => Promise<number>`                                                      | Deletes everything in the namespace — blocked in production (§5.5) |

### 5.3 Critical Signatures

```typescript
@Injectable()
export class CacheService {
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager,
    private readonly keyBuilder: KeyBuilder,
    private readonly serializer: Serializer,
    @Optional() private readonly scriptRegistry?: ScriptManagerService
  ) {}

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
   * @param ttlSeconds Omit for in the expiration
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
  async eval(scriptName: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (!this.scriptRegistry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
    }
    const prefixedKeys = keys.map((k) => this.keyBuilder.applyNamespace(k))
    return this.scriptRegistry.eval(scriptName, prefixedKeys, args)
  }

  /**
   * Cursor-based key iteration. Prefer over keys() in production.
   */
  async *scan(prefix: string, pattern: string, count = 100): AsyncIterable<string> {
    const fullPattern = this.keyBuilder.build(prefix, pattern)
    const stream = this.connection.getClient().scanStream({ match: fullPattern, count })
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
    return JSON.stringify(value)
  }
  deserialize<T>(raw: string): T {
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
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue }
```

`get<T>`/`set<T>` does not constrain `T` to `SerializableValue` to retain flexibility with custom serializers. The constraint exists as an optional alias.

### 6.5 Error Handling

When `JSON.parse` throws, `CacheService` propagates it as `CacheException` with code `DESERIALIZATION_FAILED`, including the affected key in `details`. It never returns a partial value.

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

### 7.2 Implementation — `KeyBuilder`

```typescript
@Injectable()
export class KeyBuilder {
  constructor(@Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions) {}

  /** Composes {namespace}:{prefix}:{id} */
  build(prefix: string, id: string): string {
    return `${this.options.namespace}${this.options.keySeparator}${prefix}${this.options.keySeparator}${id}`
  }

  /** Applies only the namespace (used inside Lua key prep) */
  applyNamespace(keyWithoutNamespace: string): string {
    return `${this.options.namespace}${this.options.keySeparator}${keyWithoutNamespace}`
  }
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

---

## 8. Pub/Sub

### 8.1 `PubSubService`

```typescript
@Injectable()
export class PubSubService implements OnModuleDestroy {
  private subscriber: Redis | null = null

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager,
    private readonly keyBuilder: KeyBuilder,
    private readonly serializer: Serializer
  ) {}

  /**
   * Publishes to a namespaced channel.
   * @returns Number of subscribers that received the message
   */
  async publish<T>(channel: string, message: T): Promise<number> {
    const full = this.keyBuilder.applyNamespace(channel)
    const raw = this.serializer.serialize(message)
    return this.connection.getClient().publish(full, raw)
  }

  /**
   * Subscribes to a channel. Creates the subscriber connection lazily.
   * @returns Unsubscribe function
   */
  async subscribe<T>(
    channel: string,
    handler: (message: T) => Promise<void>
  ): Promise<() => Promise<void>> {
    const full = this.keyBuilder.applyNamespace(channel)
    const sub = this.ensureSubscriber()
    await sub.subscribe(full)
    const listener = async (incoming: string, raw: string): Promise<void> => {
      if (incoming !== full) return
      await handler(this.serializer.deserialize<T>(raw))
    }
    sub.on('message', listener)
    return async () => {
      sub.off('message', listener)
      await sub.unsubscribe(full)
    }
  }

  /** Pattern-subscribe — supports globs like 'users:*' */
  async psubscribe<T>(
    pattern: string,
    handler: (channel: string, message: T) => Promise<void>
  ): Promise<() => Promise<void>> {
    // ...analogous to subscribe, but uses psubscribe/pmessage
  }

  private ensureSubscriber(): Redis {
    if (this.subscriber && this.subscriber.status === 'ready') return this.subscriber
    this.subscriber = this.connection.createSubscriberClient()
    return this.subscriber
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => this.subscriber?.disconnect())
      this.subscriber = null
    }
  }
}
```

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

Redis Pub/Sub is **fire-and-forget**: in the persistence, replay, or ack. For delivery guarantees, use Streams or a queue (`@bymax-one/nest-queue`). After the subscriber reconnects, `ioredis` re-subscribes channels automatically — but messages published during the offline window are **lost**.

---

## 9. Lua Scripts and `ScriptManager`

### 9.1 Motivation

Composite operations need to be atomic. Classic case: refresh token rotation (`nest-auth`) — two concurrent requests with the same token cannot create two sessions. Without Lua, both would pass through the `GET` before the `DEL`.

Lua scripts execute atomically on the server. `ScriptManager` loads via `SCRIPT LOAD`, caches the SHA1, and uses `EVALSHA` on subsequent invocations — cheaper than sending the full script.

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
export class ScriptManagerService implements OnModuleInit {
  private readonly scripts = new Map<string, { lua: string; sha?: string }>()

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager
  ) {
    for (const def of options.scripts ?? []) {
      this.scripts.set(def.name, { lua: def.lua })
    }
  }

  /** Pre-loads scripts in OnModuleInit (unless lazyConnect=true) */
  async onModuleInit(): Promise<void> {
    if (this.options.connection?.lazyConnect) return
    for (const [name] of this.scripts) await this.load(name)
  }

  register(name: string, lua: string): void {
    this.scripts.set(name, { lua })
  }

  async load(name: string): Promise<string> {
    const entry = this.scripts.get(name)
    if (!entry) throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    if (!entry.sha) {
      entry.sha = (await this.connection.getClient().script('LOAD', entry.lua)) as string
    }
    return entry.sha
  }

  /**
   * Executes the script. Uses EVALSHA; on NOSCRIPT reloads and retries.
   * Caller is responsible for ensuring `keys` are already namespaced.
   */
  async eval(name: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const entry = this.scripts.get(name)
    if (!entry) throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    try {
      if (!entry.sha) entry.sha = await this.load(name)
      return await this.connection.getClient().evalsha(entry.sha, keys.length, ...keys, ...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOSCRIPT')) {
        // FLUSHALL or server restart cleared the script — reload
        entry.sha = (await this.connection.getClient().script('LOAD', entry.lua)) as string
        return await this.connection.getClient().evalsha(entry.sha, keys.length, ...keys, ...args)
      }
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
        name,
        originalError: msg
      })
    }
  }
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

`events.onEvent` can feed Prometheus/OpenTelemetry metrics:

```typescript
BymaxCacheModule.forRoot({
  events: {
    onEvent: (event) => {
      if (event === 'ready') metrics.gauge('redis_status').set(1)
      if (event === 'close' || event === 'error') metrics.gauge('redis_status').set(0)
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
  private client: Redis | null = null
  private readonly redisOptionsResolved: RedisOptions

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) private readonly events?: ICacheEvents
  ) {
    this.redisOptionsResolved = this.buildRedisOptions(options)
  }

  async onModuleInit(): Promise<void> {
    this.client = this.createClient()
    this.registerListeners(this.client, 'main')
    if (!this.options.connection?.lazyConnect) await this.waitUntilReady()
  }

  getClient(): Redis {
    if (!this.client) {
      this.client = this.createClient()
      this.registerListeners(this.client, 'main')
    }
    return this.client
  }

  /** Creates a NEW dedicated connection for subscriber mode. Caller owns the lifecycle. */
  createSubscriberClient(): Redis {
    const client = this.createClient()
    this.registerListeners(client, 'subscriber')
    return client
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return
    const timeout = this.options.shutdownTimeoutMs ?? 5000
    try {
      await Promise.race([
        this.client.quit(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), timeout))
      ])
    } catch {
      this.client.disconnect()
    } finally {
      this.client = null
    }
  }

  private createClient(): Redis {
    switch (this.options.mode ?? 'standalone') {
      case 'standalone':
        return new Redis(this.redisOptionsResolved)
      case 'sentinel':
        return new Redis({
          ...this.redisOptionsResolved,
          sentinels: this.options.sentinel!.sentinels,
          name: this.options.sentinel!.name,
          sentinelPassword: this.options.sentinel!.sentinelPassword,
          role: this.options.sentinel!.role
        })
      case 'cluster':
        return new (Redis as typeof Redis).Cluster(
          this.options.cluster!.nodes,
          this.options.cluster!.options
        ) as unknown as Redis
    }
  }

  private buildRedisOptions(opts: ResolvedOptions): RedisOptions {
    const c = opts.connection ?? {}
    const fromUrl = c.url ? parseRedisUrl(c.url) : {}
    return {
      host: c.host,
      port: c.port,
      password: c.password,
      db: c.db,
      username: c.username,
      tls: c.tls,
      lazyConnect: c.lazyConnect ?? false,
      connectTimeout: c.connectTimeout ?? 10_000,
      commandTimeout: c.commandTimeout ?? 5_000,
      maxRetriesPerRequest: c.maxRetriesPerRequest ?? 3,
      enableReadyCheck: c.enableReadyCheck ?? true,
      enableOfflineQueue: c.enableOfflineQueue ?? false,
      retryStrategy: c.retryStrategy ?? ((times) => Math.min(times * 50, 2000)),
      reconnectOnError: c.reconnectOnError ?? ((err) => err.message.includes('READONLY')),
      keepAlive: c.keepAlive ?? 0,
      noDelay: c.noDelay ?? true,
      family: c.family ?? 4,
      ...fromUrl // URL has priority
    }
  }

  private registerListeners(client: Redis, role: 'main' | 'subscriber'): void {
    client.on('connect', () => this.events?.onEvent?.('connect', { role }))
    client.on('ready', () => this.events?.onEvent?.('ready', { role }))
    client.on('error', (err) => this.events?.onEvent?.('error', { role, error: err.message }))
    client.on('close', () => this.events?.onEvent?.('close', { role }))
    client.on('reconnecting', (delay: number) =>
      this.events?.onEvent?.('reconnecting', { role, delay })
    )
    client.on('end', () => this.events?.onEvent?.('end', { role }))
  }
}
```

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

### 11.3 `parseRedisUrl`

Parses `redis://`, `rediss://` (TLS) URLs with user, password, port, and database. Returns `Partial<RedisOptions>` — discrete options serve as fallback.

### 11.4 Retry / Reconnection Behavior

| Scenario                             | Default behavior                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Initial connection fails             | `retryStrategy` = `Math.min(times * 50, 2000)` (50ms, 100ms, …, 2s). In the total limit. |
| Individual command fails             | Retried up to `maxRetriesPerRequest` (3) before propagating                              |
| Server returns `READONLY` (failover) | `reconnectOnError` returns `true` — forces reconnection                                  |
| Other errors                         | `reconnectOnError` returns `false` — error propagates                                    |
| `client.quit()` on shutdown          | Waits up to `shutdownTimeoutMs`; if exceeded, forces `disconnect()`                      |

### 11.5 Offline Queue Disabled

`enableOfflineQueue: false` by default — when the connection drops, new commands fail immediately instead of queueing. We prefer to fail fast rather than OOM from silent buffering. Consumers that need buffering enable it explicitly.

---

## 12. Error Code Catalog

### 12.1 `CacheException`

```typescript
export class CacheException extends HttpException {
  constructor(
    code: string,
    details?: Record<string, unknown>,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR
  ) {
    super(
      {
        error: {
          code,
          message: CACHE_ERROR_MESSAGES[code] ?? 'Cache error',
          details: details ?? null
        }
      },
      statusCode
    )
  }
}
```

### 12.2 Code Table

| Code                                 | HTTP | When                                         |
| ------------------------------------ | ---- | -------------------------------------------- |
| `cache.connection_failed`            | 500  | Could not connect after retries              |
| `cache.command_timeout`              | 504  | `commandTimeout` exceeded                    |
| `cache.connection_lost`              | 503  | `'close'` during operation                   |
| `cache.serialization_failed`         | 500  | `serializer.serialize` threw                 |
| `cache.deserialization_failed`       | 500  | `serializer.deserialize` threw               |
| `cache.invalid_namespace`            | 500  | Namespace empty or contains separator        |
| `cache.invalid_key`                  | 400  | `prefix` or `id` empty                       |
| `cache.script_not_registered`        | 500  | Tried to execute unknown script              |
| `cache.script_execution_failed`      | 500  | Script returned Redis error                  |
| `cache.script_registry_missing`      | 500  | `eval` called without registering scripts    |
| `cache.flush_disabled_in_production` | 403  | `flushNamespace` in prod without flag        |
| `cache.cluster_misconfigured`        | 500  | `mode === 'cluster'` without `cluster.nodes` |
| `cache.sentinel_misconfigured`       | 500  | `mode === 'sentinel'` misconfigured          |
| `cache.shutdown_timeout`             | 500  | `quit()` exceeded `shutdownTimeoutMs`        |

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
  SHUTDOWN_TIMEOUT: 'cache.shutdown_timeout'
} as const

export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[keyof typeof CACHE_ERROR_CODES]
```

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

Same as `@bymax-one/nest-auth`. Zero transitive deps; everything is peer.

### 14.2 `peerDependencies`

```json
{
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "ioredis": "^5.0.0",
    "reflect-metadata": "^0.2.0"
  }
}
```

> **Corrected 2026-05-30 (§0):** peers are **NOT** optional — the previous
> `peerDependenciesMeta.optional` block was removed. Marking the NestJS peers optional
> broke server-subpath resolution in consumers (proven by the dogfood smoke test).

| Peer               | Version | Why                                                                      |
| ------------------ | ------- | ------------------------------------------------------------------------ |
| `@nestjs/common`   | `^11`   | Decorators (`@Injectable`, `@Inject`, `@Optional`, `@Global`), lifecycle |
| `@nestjs/core`     | `^11`   | `DynamicModule` type                                                     |
| `ioredis`          | `^5`    | Redis client with TLS, sentinel, cluster support                         |
| `reflect-metadata` | `^0.2`  | NestJS decorators                                                        |

`ioredis` is the only functional dep; the rest is standard for any NestJS project.

### 14.3 `devDependencies`

Mirrors the `@bymax-one/nest-auth` template with specific additions:

- `ioredis-mock ^8` — unit tests without real Redis
- `@testcontainers/redis ^10` — e2e tests with real Redis
- Removes `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/websockets`, `class-validator`, `react`, `next` (not used here)

### 14.4 `engines` and `packageManager`

```json
{
  "packageManager": "pnpm@10.8.1",
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
2. **Cluster mode is experimental.** Works via `ioredis.Cluster` passthrough, but multi-key commands require all keys to be in the same slot — `KeyBuilder` does not enforce this.
3. **No hot-reload of configuration.** Changing `namespace`, `serializer`, or `connection.url` requires a restart.
4. **Pub/Sub does not persist messages.** Limitation of Redis Pub/Sub, not of the lib.
5. **`KEYS` may block the server.** `cache.keys()` exists but JSDoc discourages it in production.
6. **No smart retry per command.** After `maxRetriesPerRequest`, the error propagates; the consumer implements a circuit breaker at a higher layer if needed.
7. **JSON loses types.** `Date`, `Map`, `Set`, `BigInt`, `undefined` do not roundtrip — use a custom serializer.
8. **No value size limit.** Redis accepts up to 512MB; the lib imposes in the limit. Values > 1MB should be rethought (chunking, external storage).

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

| ADR | Decision                                                   | Justification                                                              |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| 001 | `ioredis` as the only functional peer, in the `node-redis` | Native support for sentinel/cluster/pipelines and better performance       |
| 002 | Mandatory namespace (default `'app'`)                      | Isolation on shared Redis instances                                        |
| 003 | Default JSON serializer, open interface                    | JSON covers 90% of cases; those who need msgpack plug their own            |
| 004 | In the BullMQ client                                       | Conflicting configuration; `nest-queue` creates its own connection         |
| 005 | Pub/Sub in the same package                                | Pub/Sub is Redis 101; separating would create friction with in the benefit |
| 006 | `EVALSHA` + `EVAL` fallback on `NOSCRIPT`                  | Standard production optimization, transparent                              |
| 007 | `flushNamespace` blocked in prod by default                | Destructive operation; better to fail visibly                              |
| 008 | Events callback instead of embedded logger                 | Keeps zero deps; consumer plugs the logger                                 |
| 009 | Lazy subscriber                                            | Apps that only use cache do not pay the cost of a 2nd TCP connection       |
| 010 | Graceful shutdown with configurable timeout                | `quit` can hang; timeout guarantees deterministic shutdown                 |
