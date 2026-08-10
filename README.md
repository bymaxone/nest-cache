<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--cache-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-cache" />
</p>

<h1 align="center">@bymax-one/nest-cache</h1>

<p align="center">
  <strong>Typed Redis cache for NestJS</strong><br />
  <sub>ioredis 6 · Namespacing · Pub/Sub · Lua Scripts · Multi-Tenant · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-cache"><img src="https://img.shields.io/npm/v/@bymax-one/nest-cache?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-cache"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-cache?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-cache/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-cache/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-cache/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-cache/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-99.78%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-cache"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-cache/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-cache/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-cache?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-cache">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-cache/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="https://github.com/bymaxone/nest-cache-example">Example App</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-cache` wraps a single, correctly-managed `ioredis` connection behind a typed
NestJS module. Instead of scattering raw Redis calls across your services, you get a namespaced,
serializer-backed API with first-class Pub/Sub and atomic Lua scripting — and a connection whose
lifecycle, reconnection, and graceful shutdown are handled for you.

The library has **zero direct dependencies** — `ioredis` and NestJS arrive as peer dependencies,
so you control exact versions and the supply-chain surface stays minimal.

### Why nest-cache?

- **🔑 Namespaced by design** — every key is composed through a key builder (`{namespace}:{prefix}:{id}`), so tenants and features never collide. Raw, un-namespaced access is a documented anti-pattern.
- **🧬 Typed get/set** — `get<T>` / `set<T>` go through a pluggable `ISerializer` (JSON by default). Deserialization **fails closed** — a malformed payload throws `CacheException`, never a half-decoded value.
- **📡 Batteries included** — Pub/Sub on namespaced channels and a Lua script manager (`EVALSHA` + `NOSCRIPT` fallback) ship in the box, on top of the full string/hash/set/numeric command surface.
- **♻️ Lifecycle done right** — singleton connection with `OnModuleInit` / `OnModuleDestroy`, bounded retry strategy, `READONLY`-failover reconnect, and a graceful `quit()` with shutdown timeout.
- **🔌 Bring your own observability** — connection events surface through an `events.onEvent` callback; plug in [`@bymax-one/nest-logger`](https://github.com/bymaxone/nest-logger) or your metrics layer. No observability peer deps forced on you.

```
pnpm add @bymax-one/nest-cache ioredis
```

---

## 🔥 Features

### 🧬 Typed Cache API

- ✅ **Typed get/set** — `get<T>` / `set<T>` / `setNx<T>` / `mget<T>` / `mset<T>` through a pluggable serializer
- ✅ **Full command surface** — strings, numbers (`incr`/`decr`), hashes, sets, TTL (`expire`/`ttl`/`persist`), iteration (`scan`)
- ✅ **Pluggable serialization** — `ISerializer` contract; swap JSON for MessagePack, CBOR, or your own codec
- ✅ **Raw string access** — `getRaw` / `setRaw` skip the serializer while keeping namespacing; `pipeline` / `getClient` are the documented escape hatches

### 🔑 Isolation & Namespacing

- ✅ **Automatic namespacing** — the key builder enforces tenant/feature isolation; no manual string concatenation
- ✅ **Namespaced channels** — Pub/Sub channels are composed through the same builder as keys
- ✅ **Surgical flush** — `flushNamespace()` scans only `{namespace}:*`, never another namespace's keys
- ✅ **Validated at bootstrap** — an empty namespace, or one containing the key separator, fails module initialization

### ⚙️ Reliability & Topology

- ✅ **Multi-topology** — standalone, Sentinel, and Cluster modes from the same options shape
- ✅ **Managed lifecycle** — singleton connection via `OnModuleInit` / `OnModuleDestroy`, graceful `quit()` with a shutdown timeout
- ✅ **Bounded retries** — `maxRetriesPerRequest` and a reconnect policy that triggers on `READONLY` replica failover
- ✅ **Connection events** — `connect` / `ready` / `error` / `close` / `reconnecting` / `end` surfaced via `events.onEvent`
- ✅ **Health checks** — `isHealthy()` / `ping()` / `info()` for readiness and liveness endpoints

### 🛡️ Safety

- ✅ **Fail-closed serialization** — malformed payloads raise `CacheException(DESERIALIZATION_FAILED)`, never a partial value
- ✅ **Production flush guard** — `flushNamespace()` is blocked under `NODE_ENV=production` unless explicitly allowed
- ✅ **Secrets never echoed** — connection URLs and cached values are kept out of error `details`; previews are truncated
- ✅ **Script bodies are registered, not interpolated** — call sites pass a name plus keys/args, never Lua source

### 🧩 Developer Experience

- ✅ **Dynamic module** — `forRoot()` and `forRootAsync()` via `ConfigurableModuleBuilder`; registered globally by default (`isGlobal`)
- ✅ **Lua script manager** — register scripts up front, execute by name with transparent `NOSCRIPT` reload + retry
- ✅ **Structured errors** — every failure is a `CacheException` with a stable `cache.*` code and an HTTP status
- ✅ **Zero runtime dependencies** — everything is a peer dependency; `dependencies: {}`

---

## 📦 Subpath Exports

One package, two entry points — import only what your app needs:

| Subpath    | Import                         | Purpose                                                                                                  |              Dependencies              |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- | :------------------------------------: |
| **Server** | `@bymax-one/nest-cache`        | `BymaxCacheModule`, `CacheService`, `PubSubService`, `ScriptManagerService`, DI tokens, `CacheException` | NestJS 11, ioredis 6, reflect-metadata |
| **Shared** | `@bymax-one/nest-cache/shared` | Types + constants — `CACHE_ERROR_CODES`, `CacheEventName`, config types                                  |                  None                  |

```
shared (zero deps)
     ↑
  server
```

The `/shared` subpath is safe to import in isomorphic code, test helpers, CLI scripts, or shared packages that must not pull in NestJS or ioredis.

---

> [!TIP]
> Prefer to learn from a working app? See the [nest-cache-example](https://github.com/bymaxone/nest-cache-example) — a full NestJS project wired with this library.

## 🚀 Quick Start

### 1. Install

```bash
# Using pnpm (recommended)
pnpm add @bymax-one/nest-cache ioredis

# Using npm
npm install @bymax-one/nest-cache ioredis

# Using yarn
yarn add @bymax-one/nest-cache ioredis
```

> [!IMPORTANT]
> `@nestjs/common`, `@nestjs/core`, and `reflect-metadata` are peer dependencies (already present in
> any NestJS app). `ioredis` is the single functional peer — the Redis client itself.

### 2. Register the Module

Pick the topology that matches your deployment. All four forms share the same options shape.

#### Scenario 1 — Standalone (dev / single node)

```typescript
import { Module } from '@nestjs/common'
import { BymaxCacheModule } from '@bymax-one/nest-cache'

@Module({
  imports: [
    BymaxCacheModule.forRoot({
      connection: { url: 'redis://localhost:6379' },
      namespace: 'app'
    })
  ]
})
export class AppModule {}
```

#### Scenario 2 — Sentinel (high availability)

```typescript
BymaxCacheModule.forRoot({
  mode: 'sentinel',
  sentinel: {
    sentinels: [
      { host: 'sentinel1.example.com', port: 26379 },
      { host: 'sentinel2.example.com', port: 26379 }
    ],
    name: 'mymaster',
    password: process.env.REDIS_PASSWORD
  },
  namespace: 'app'
})
```

#### Scenario 3 — Cluster (sharded)

```typescript
BymaxCacheModule.forRoot({
  mode: 'cluster',
  cluster: {
    nodes: [
      { host: 'cluster1.example.com', port: 7000 },
      { host: 'cluster2.example.com', port: 7001 },
      { host: 'cluster3.example.com', port: 7002 }
    ]
  },
  namespace: 'app'
})
```

#### Scenario 4 — forRootAsync with ConfigService

```typescript
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BymaxCacheModule } from '@bymax-one/nest-cache'

@Module({
  imports: [
    BymaxCacheModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        namespace: 'app',
        events: {
          // Plug @bymax-one/nest-logger or a metrics sink here
          onEvent: (event, data) => console.log(`[cache] ${event}`, data)
        }
      })
    })
  ]
})
export class AppModule {}
```

### 3. Inject `CacheService`

The module is global by default, so no re-import is needed in feature modules:

```typescript
import { Injectable } from '@nestjs/common'
import { CacheService } from '@bymax-one/nest-cache'

@Injectable()
export class ProfileService {
  constructor(private readonly cache: CacheService) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const cached = await this.cache.get<Profile>('user-profile', userId)
    if (cached) return cached

    const profile = await this.repo.findProfile(userId)
    await this.cache.set('user-profile', userId, profile, 3600) // TTL in seconds
    return profile
  }
}
```

Keys resolve to `app:user-profile:<userId>` — namespaced automatically.

---

## ⚙️ Configuration

| Option              | Type                                      | Default          | Description                                                        |
| ------------------- | ----------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `mode`              | `'standalone' \| 'sentinel' \| 'cluster'` | `'standalone'`   | Redis topology                                                     |
| `connection.url`    | `string`                                  | —                | `redis://` / `rediss://` URL (overrides discrete host/port fields) |
| `connection.tls`    | `tls.ConnectionOptions`                   | —                | TLS options for `rediss://`                                        |
| `namespace`         | `string`                                  | `'app'`          | Key prefix for tenant/feature isolation                            |
| `serializer`        | `ISerializer`                             | `JsonSerializer` | Value encoding/decoding (plug MsgPack, CBOR, etc.)                 |
| `events.onEvent`    | `(event, data) => void`                   | —                | Connection-event hook (plug a logger or metrics)                   |
| `scripts`           | `IScriptDefinition[]`                     | `[]`             | Lua scripts to preload on init                                     |
| `shutdownTimeoutMs` | `number`                                  | `5000`           | Graceful `quit()` timeout before forced `disconnect()`             |

Both `forRoot(options)` (synchronous) and `forRootAsync({ useFactory, inject, imports })` are supported. The module registers globally by default — pass `isGlobal: false` to scope it to the importing module.

---

## 🔑 Key Namespacing

Every key is composed as `{namespace}{separator}{prefix}{separator}{id}` (default separator `:`).
Calling `cache.get('user-profile', '42')` under namespace `app` reads `app:user-profile:42`. This
keeps tenants and features isolated and makes `flushNamespace()` surgical. Reaching for
`getClient()` to set raw, un-namespaced keys is supported as an escape hatch but documented as an
anti-pattern.

---

## 📡 Pub/Sub

```typescript
const unsubscribe = await pubsub.subscribe<UserEvent>('user-events', async (msg) => {
  await handle(msg)
})
await pubsub.publish<UserEvent>('user-events', { type: 'created', id: '42' })
// ...later
await unsubscribe()
```

Channels are namespaced like keys. The subscriber connection is created lazily on the first
subscription. Redis Pub/Sub is fire-and-forget — messages published while a subscriber is offline
are not replayed.

---

## 📜 Lua Scripts

Register scripts at module init, then execute them atomically by name. The manager caches the
SHA1 and uses `EVALSHA`, transparently reloading on `NOSCRIPT`:

```typescript
// In module options:
scripts: [{ name: 'compareAndSet', lua: '...' }]

// At call site — keys are flat strings passed directly to Lua's KEYS[] table.
// CacheService prepends the namespace via applyNamespace(), so 'lock:job'
// becomes 'app:lock:job' in Redis. Pass the full suffix as a single string.
const ok = await cache.eval('compareAndSet', ['lock:job'], [expected, next])
```

---

## 🔁 Custom Serializer

Swap the default `JsonSerializer` with any `ISerializer` implementation — MsgPack, CBOR, or your own:

```typescript
import { encode, decode } from '@msgpack/msgpack'
import type { ISerializer } from '@bymax-one/nest-cache'

class MsgPackSerializer implements ISerializer {
  serialize<T>(value: T): string {
    return Buffer.from(encode(value)).toString('base64')
  }
  deserialize<T>(raw: string): T {
    return decode(Buffer.from(raw, 'base64')) as T
  }
}

// In module options:
BymaxCacheModule.forRoot({
  connection: { url: 'redis://localhost:6379' },
  serializer: new MsgPackSerializer()
})
```

---

## 🔗 Plug with @bymax-one/nest-logger

Wire connection events into your logger via the `events.onEvent` hook:

```typescript
import { BymaxOneLogger } from '@bymax-one/nest-logger'

BymaxCacheModule.forRootAsync({
  imports: [ConfigModule, LoggerModule],
  inject: [ConfigService, BymaxOneLogger],
  useFactory: (config: ConfigService, logger: BymaxOneLogger) => ({
    connection: { url: config.getOrThrow('REDIS_URL') },
    namespace: 'app',
    events: {
      onEvent: (event, data) => {
        if (event === 'error') logger.error('[cache]', data)
        else logger.log(`[cache] ${event}`, data)
      }
    }
  })
})
```

---

## ❤️ Health Check (terminus integration)

```typescript
import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'
import { CacheService } from '@bymax-one/nest-cache'

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly cache: CacheService
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () =>
        this.cache
          .isHealthy()
          .then((ok) =>
            ok ? { redis: { status: 'up' } } : Promise.reject(new Error('Redis not ready'))
          )
    ])
  }
}
```

---

## 🏗️ Architecture

The package runs **inside** your NestJS application as a dynamic module — not as a separate service:

```
┌─────────────────────────────────────────────────────┐
│               Your NestJS Application               │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │             @bymax-one/nest-cache             │  │
│  │                                               │  │
│  │  CacheService ←→ ConnectionManager ←→ Redis   │  │
│  │  PubSubService ←→ lazy subscriber conn        │  │
│  │  ScriptManagerService ←→ EVALSHA + NOSCRIPT   │  │
│  │  KeyBuilder → {namespace}:{prefix}:{id}       │  │
│  └─────────────┬─────────────────┬───────────────┘  │
│                │                 │                  │
│        ┌───────▼──────┐  ┌───────▼──────┐           │
│        │ ISerializer  │  │ ICacheEvents │           │
│        │ (yours)      │  │ (yours)      │           │
│        └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────┘
```

Both consumer-facing contracts are optional: omit `serializer` and you get `JsonSerializer`; omit `events.onEvent` and connection events are simply not forwarded anywhere.

DI tokens are `Symbol`s (`BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`, `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`, `BYMAX_CACHE_SERIALIZER`, `BYMAX_CACHE_KEY_BUILDER`); all providers are singletons. The module is built with `ConfigurableModuleBuilder` and registers globally by default via the `isGlobal` extra (which sets `DynamicModule.global`) — there is no `@Global()` decorator.

### Design Principles

| Principle                    | Description                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔑 Structural Isolation**  | Every key and channel is composed by `KeyBuilder` — namespacing is enforced by the type of the API, not by a convention a caller can forget                       |
| **🚪 Fail Closed**           | A payload that cannot be decoded throws; it never degrades into `undefined` or a partially-typed object, because a silently wrong cache read is worse than a miss |
| **🔌 Interface-Driven**      | `ISerializer` and `ICacheEvents` are contracts — MessagePack, a metrics sink, or a logger is a consumer implementation, never a dependency of this package        |
| **🪶 Singleton Connection**  | One `ioredis` client per module, owned by `ConnectionManager` with `OnModuleInit` / `OnModuleDestroy` — no `Scope.REQUEST`, no per-call connection churn          |
| **🌳 Zero Runtime Deps**     | `"dependencies": {}` — every package arrives as a peer dependency, so consumers pin exact versions and the supply-chain surface stays theirs                      |
| **🧭 Explicit Escape Hatch** | `getClient()` exists, is documented, and is an anti-pattern — un-namespaced access is possible on purpose, and named so a reviewer sees it                        |

---

## 🔐 Security Model

A cache sits between your application and every value it has ever computed, so the security posture is about two things: one tenant's data never being reachable from another tenant's key, and a hostile or corrupt payload never being handed back as a valid object.

### Namespace isolation is structural

Every key and every Pub/Sub channel is composed through `KeyBuilder`, which prepends `{namespace}{separator}` before the command reaches Redis. `CacheService.get('user-profile', '42')` can only ever read `app:user-profile:42` — there is no code path through the typed API that emits a bare key.

The namespace itself is validated at module bootstrap, not at call time:

| Violation                               | Result                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| Empty or whitespace-only namespace      | `CacheException(INVALID_NAMESPACE)` — the module fails to start  |
| Namespace containing the key separator  | `CacheException(INVALID_NAMESPACE)` — prevents prefix collisions |
| Empty `prefix` or `id` at the call site | `CacheException(INVALID_KEY)` — no key is sent to Redis          |

A namespace containing the separator is rejected because `namespace: 'a:b'` and `namespace: 'a'` with prefix `b` would resolve to the same keyspace — a tenant boundary that reads as isolated but is not.

### Deserialization fails closed

`JsonSerializer.deserialize` throws `CacheException(DESERIALIZATION_FAILED)` on any payload that is not valid JSON. It never returns `undefined`, never returns a partial object, and never lets a corrupted entry masquerade as a valid `T`. The same contract is required of any custom `ISerializer` — fail-closed is the invariant, not the default implementation's private choice.

Serialization is symmetric: a top-level `undefined`, function, or `symbol` is rejected up front, because `JSON.stringify` returns the JS value `undefined` for those **without throwing**, which would otherwise escape the try/catch and break the `string` return contract.

### Secrets stay out of error payloads

Error `details` are built to be safe to log:

- A malformed `connection.url` throws `CONNECTION_FAILED` with `reason: 'invalid connection.url'` — the URL is omitted, because it may embed a password.
- `SERIALIZATION_FAILED` carries the encoder's message, never the value being encoded.
- `DESERIALIZATION_FAILED` carries a `preview` of the raw payload truncated to **100 characters** with an ellipsis — enough to debug a codec mismatch, bounded so a cached record full of PII is not copied into a log line.

### Destructive operations are guarded in production

`flushNamespace()` throws `CacheException(FLUSH_DISABLED_IN_PRODUCTION)` when `NODE_ENV === 'production'` unless `allowFlushInProduction` is explicitly set. When it does run, it iterates with `SCAN` scoped to `{namespace}{separator}*` and removes keys with `UNLINK` (asynchronous reclaim), so it neither touches another namespace nor blocks the server on a large keyset.

### Lua scripts are registered, never interpolated

Scripts are declared up front — through `options.scripts` or `ScriptManagerService.register(name, lua)` — and executed **by name**. A call site passes `eval(scriptName, keys, args)`; it has no way to pass a script body. Keys are namespaced before execution and arguments arrive as Redis `ARGV[]`, which Lua treats as data, so request input cannot become script source. Standalone and Sentinel use `EVALSHA` with a `NOSCRIPT` reload-and-retry; Cluster sends the full body via `EVAL`, because `EVALSHA` routes by key slot and a keyless reload would not reach the node that reported `NOSCRIPT`.

### Cluster mode refuses commands it cannot honor safely

`scan()`, `flushNamespace()`, and `getClient()` throw `UNSUPPORTED_IN_CLUSTER` under `mode: 'cluster'` rather than silently operating on one node. A partial flush that reports success is worse than an error.

### Security Checklist

When integrating `@bymax-one/nest-cache` in production, verify each of the following:

- `namespace` is distinct per tenant or per application — it is the isolation boundary, and a shared value makes every other guarantee moot
- `allowFlushInProduction` stays unset; if it is on, the reason belongs in a security review
- `getClient()` and `pipeline()` call sites are audited — they are the only paths that bypass namespacing
- Connection credentials come from the environment (`config.getOrThrow('REDIS_URL')`), never from a URL literal in module options in source control
- `rediss://` (or an explicit `connection.tls`) is used for any Redis reachable off-host
- Values that must not be readable by whoever can read Redis are encrypted by the application (or a custom `ISerializer`) before they are cached — the library stores what you hand it
- Cached entries carry a TTL sized to your data-retention policy; namespacing bounds who can read an entry, not how long it exists
- Custom `ISerializer` implementations throw on malformed input rather than returning a fallback value

---

## 🛡️ Security Table

| Layer                 | Implementation                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tenant Isolation      | Every key and channel composed by `KeyBuilder` as `{namespace}{sep}{prefix}{sep}{id}` — no bare-key path in the API         |
| Namespace Validation  | Empty or separator-containing namespace rejected at bootstrap (`INVALID_NAMESPACE`)                                         |
| Key Validation        | Empty `prefix` / `id` rejected before the command is issued (`INVALID_KEY`)                                                 |
| Deserialization       | Fails closed — `DESERIALIZATION_FAILED`; never a partial or wrongly-typed value                                             |
| Serialization         | Top-level `undefined` / function / symbol rejected; the value is never echoed into `details`                                |
| Error Payloads        | Connection URLs omitted (may embed credentials); raw payload previews truncated to 100 characters                           |
| Destructive Ops       | `flushNamespace()` blocked under `NODE_ENV=production` unless `allowFlushInProduction`; `SCAN` + `UNLINK`, namespace-scoped |
| Lua Execution         | Scripts registered by name; call sites pass keys/args only — request input never reaches a script body                      |
| Cluster Safety        | `scan` / `flushNamespace` / `getClient` throw `UNSUPPORTED_IN_CLUSTER` instead of acting on a single node                   |
| Transport             | `rediss://` sets TLS on the client; explicit `connection.tls` supported for custom CA / mTLS                                |
| Connection Resilience | Bounded `maxRetriesPerRequest`, `READONLY`-failover reconnect, graceful `quit()` with a shutdown timeout                    |
| Supply Chain          | `"dependencies": {}` — no transitive runtime packages of the library's own choosing; published with npm provenance          |

> [!IMPORTANT]
> The namespace is the isolation boundary. Anything reached through `getClient()` or `pipeline()` sits outside it — those call sites are where cross-tenant reads get introduced.

---

## 🧱 Tech Stack

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![ioredis](https://img.shields.io/badge/ioredis-6-DC382D?style=flat-square&logo=redis&logoColor=white)](https://github.com/redis/ioredis)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Jest](https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest)](https://jestjs.io)
[![Stryker](https://img.shields.io/badge/Stryker-Mutation_Testing-red?style=flat-square)](https://stryker-mutator.io)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![tsup](https://img.shields.io/badge/tsup-8-orange?style=flat-square)](https://tsup.egoist.dev)

---

## 🧪 Testing & Quality

A cache is consulted on the hot path of every request that touches it, so the suite is held to a bar beyond "it runs" — every behavior is pinned so that a regression **fails a test**.

- ✅ **100% line coverage** — statements, branches, functions, and lines, enforced by `jest.coverage.config.ts` as a pre-publish gate, not a target
- ✅ **100% mutation score** — verified with [Stryker](https://stryker-mutator.io/) at `break: 100` and `ignoreStatic: false`; 441 killed, 6 timed out, **0 survived**, and [documented in full](./docs/mutation_testing_results.md)
- ✅ **One documented equivalent** — the production source carries a single `// Stryker disable` directive, on `configurable: false` of the withheld connection accessor, genuinely equivalent because the resolved options are frozen on the way out (freezing already makes every property non-configurable); `check:mutants` proves it parses and carries its reason, so the score is an accounting rather than a number
- ✅ **No real Redis in unit tests** — `ioredis-mock` throughout; e2e tests exercise the wired module through `@nestjs/testing` and Testcontainers against a real Redis for connection lifecycle, Pub/Sub, and Lua scripts
- ✅ **Published-package smoke test** — `scripts/dogfood-smoke-test.mjs` validates exports, tarball shape, and a consumer install before tagging

```bash
pnpm test          # unit tests (Jest)
pnpm test:e2e      # end-to-end tests (@nestjs/testing + Testcontainers)
pnpm test:cov:all  # full coverage gate (100% statements/branches/functions/lines)
pnpm mutation      # Stryker mutation testing (95% break gate)
pnpm typecheck     # tsc strict check
pnpm lint          # ESLint
```

> [!NOTE]
> Line coverage proves a line _executed_ under test; mutation testing proves a test _would fail_ if that line were wrong. The full methodology and per-area breakdown are in [docs/mutation_testing_results.md](./docs/mutation_testing_results.md).

---

## 📖 API Reference

### `CacheService`

| Group           | Methods                                                |
| --------------- | ------------------------------------------------------ |
| Strings         | `get<T>` · `getRaw` · `set<T>` · `setRaw` · `setNx<T>` |
| Delete / exists | `del` · `delMany` · `exists`                           |
| TTL             | `ttl` · `expire` · `persist`                           |
| Numbers         | `incr` · `decr`                                        |
| Batch           | `mget<T>` · `mset<T>`                                  |
| Hashes          | `hget<T>` · `hset<T>` · `hgetall<T>` · `hdel`          |
| Sets            | `sadd` · `srem` · `smembers` · `sismember` · `scard`   |
| Iteration       | `keys` (avoid in prod) · `scan` (cursor)               |
| Scripts         | `eval`                                                 |
| Escape hatch    | `pipeline` · `getClient`                               |
| Namespace       | `flushNamespace` (prod-guarded)                        |
| Health          | `isHealthy` · `ping` · `info`                          |

### `PubSubService`

`publish<T>(channel, message)` · `subscribe<T>(channel, handler)` · `psubscribe<T>(pattern, handler)`

### `ScriptManagerService`

`register(name, lua)` · `load(name)` · `eval(name, keys, args)`

### Errors

`CacheException` (extends `HttpException`) + `CACHE_ERROR_CODES` (namespaced `cache.*`).

---

## 🪪 Default Error Codes

All errors are instances of `CacheException` and carry a stable `code` string from `CACHE_ERROR_CODES`:

| Code                                 | HTTP | When thrown                                                     |
| ------------------------------------ | ---- | --------------------------------------------------------------- |
| `cache.connection_failed`            | 500  | Cannot connect after retries                                    |
| `cache.command_timeout`              | 504  | Command exceeded `commandTimeout`                               |
| `cache.connection_lost`              | 503  | Connection dropped during an in-flight operation                |
| `cache.deserialization_failed`       | 500  | Malformed payload in `get<T>`                                   |
| `cache.serialization_failed`         | 500  | Unserializable value in `set<T>`                                |
| `cache.invalid_key`                  | 400  | Empty prefix or id passed to `build` / `applyNamespace`         |
| `cache.invalid_namespace`            | 500  | Empty or separator-containing namespace                         |
| `cache.script_not_registered`        | 500  | `eval(name)` before `register(name)`                            |
| `cache.script_execution_failed`      | 500  | Lua runtime error or NOSCRIPT retry failure                     |
| `cache.script_registry_missing`      | 500  | `eval` called when no `ScriptManagerService` is wired           |
| `cache.flush_disabled_in_production` | 403  | `flushNamespace()` in prod without `allowFlushInProduction`     |
| `cache.unsupported_in_cluster`       | 500  | `scan`, `flushNamespace`, or `getClient` called in cluster mode |
| `cache.cluster_misconfigured`        | 500  | `mode: 'cluster'` without `cluster.nodes`                       |
| `cache.sentinel_misconfigured`       | 500  | `mode: 'sentinel'` without `sentinel.sentinels`/`name`          |
| `cache.shutdown_timeout`             | 500  | `quit()` exceeded `shutdownTimeoutMs`                           |

Full catalog and HTTP status mapping: [`docs/technical_specification.md §12`](./docs/technical_specification.md).

---

## 🚫 What This Library Does NOT Do

Reliable atomic primitives are in scope; opinionated policies are not. By design, the following are out of scope:

- ❌ **Rate limiting** — compose `incr` + `expire`, a custom Lua script, or a future `@bymax-one/nest-rate-limit`
- ❌ **Distributed locks** — `setNx` + a release script covers the common case; a future `@bymax-one/nest-lock` would own the edge cases
- ❌ **BullMQ wiring** — [`@bymax-one/nest-queue`](https://github.com/bymaxone/nest-queue) owns its own connection
- ❌ **Cache-aside / read-through patterns** — that policy belongs in your repositories, not in the client
- ❌ **Compression and at-rest encryption** — implement a custom `ISerializer`
- ❌ **Tag-based invalidation** — namespaces and prefixes are the invalidation unit
- ❌ **Redis Streams** — a different consumption model than Pub/Sub; out of scope for this package

See §13 of the [technical specification](./docs/technical_specification.md) for the rationale.

---

## 🤝 Contributing

Contributions are welcome. Development follows the Bymax coding standards:

- TypeScript strict (`noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- TDD with a 100% coverage gate and a 95% mutation break threshold
- Conventional Commits enforced by commitlint + husky
- No direct dependencies — peer deps only
- All boolean identifiers prefixed with `is / has / should / can`

```bash
# Clone the repository
git clone https://github.com/bymaxone/nest-cache.git
cd nest-cache

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm typecheck
```

Run the full gate before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for the full process.

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public issue. Instead, email us at **support@bymax.one** with details. We take security seriously and will respond promptly.

See [SECURITY.md](./SECURITY.md) for the private reporting process, supported versions, and the threat model (cache poisoning, key injection, unsafe deserialization, production flush guard, Lua injection).

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
