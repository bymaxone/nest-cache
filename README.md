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
  <a href="https://github.com/bymaxone/nest-cache/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
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
- ✅ **Validated at bootstrap** — an empty namespace, an empty key separator, or a namespace containing the key separator or a Redis glob metacharacter (`*`, `?`, `[`, `\`) fails module initialization

### ⚙️ Reliability & Topology

- ✅ **Multi-topology** — standalone, Sentinel, and Cluster modes from the same options shape
- ✅ **Managed lifecycle** — singleton connection via `OnModuleInit` / `OnApplicationShutdown`, graceful `quit()` with a shutdown timeout
- ✅ **Bounded retries** — `maxRetriesPerRequest` and a reconnect policy that triggers on `READONLY` replica failover
- ✅ **Connection events** — `connect` / `ready` / `error` / `close` / `reconnecting` / `end` surfaced via `events.onEvent`, which also receives Pub/Sub handler and deserialization failures as `'error'` with `reason: 'handler_error'`
- ✅ **Health checks** — `isHealthy()` / `ping()` / `info()` for readiness and liveness endpoints

### 🛡️ Safety

- ✅ **Fail-closed serialization** — malformed payloads raise `CacheException(DESERIALIZATION_FAILED)`, never a partial value
- ✅ **Production flush guard** — `flushNamespace()` is blocked under `NODE_ENV=production` unless explicitly allowed
- ✅ **Secrets never echoed** — connection URLs and cached values are kept out of error `details`; no part of a stored value is ever echoed
- ✅ **Script bodies are registered, not interpolated** — call sites pass a name plus keys/args, never Lua source

### 🧩 Developer Experience

- ✅ **Dynamic module** — `forRoot()` and `forRootAsync()` via `ConfigurableModuleBuilder`; registered globally by default (`isGlobal`)
- ✅ **Lua script manager** — register scripts up front, execute by name with transparent `NOSCRIPT` reload + retry
- ✅ **Structured errors** — every failure is a `CacheException` with a stable `cache.*` code and an HTTP status
- ✅ **No runtime dependencies** — everything is a peer dependency

---

## 📦 Subpath Exports

One package, four entry points — import only what your app needs:

| Subpath     | Import                          | Purpose                                                                                                  |                                     Dependencies                                     |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------: |
| **Server**  | `@bymax-one/nest-cache`         | `BymaxCacheModule`, `CacheService`, `PubSubService`, `ScriptManagerService`, DI tokens, `CacheException` |                        NestJS 11, ioredis 6, reflect-metadata                        |
| **Admin**   | `@bymax-one/nest-cache/admin`   | Read-only administration — health, `INFO` statistics, keyspace listing, key inspection, value reveal     |                        NestJS 11, ioredis 6, the server entry                        |
| **Metrics** | `@bymax-one/nest-cache/metrics` | Connection-lifecycle metrics on the application's `prom-client` registry, through `@bymax-one/nest-core` | NestJS 11, the server entry, optional peers `@bymax-one/nest-core` and `prom-client` |
| **Shared**  | `@bymax-one/nest-cache/shared`  | Types + constants — `CACHE_ERROR_CODES`, `CacheEventName`, config types                                  |                                         None                                         |

```
shared (zero deps)
     ↑
  server  ←  admin
     ↑
          metrics
```

`/admin` is a **privileged** surface and is kept out of the main entry on purpose: importing it is a greppable, reviewable act, a consumer who never wires it cannot resolve a reveal service from DI by accident, and it never lands in the main bundle.

`/metrics` is the only entry that loads `@bymax-one/nest-core` or `prom-client`, both optional peers: `.`, `/admin` and `/shared` never import either.

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

Pick the topology that matches your deployment. All forms share the same options shape.

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

#### Scenario 2 — Sentinel or Cluster

```typescript
// Sentinel (high availability)
BymaxCacheModule.forRoot({
  mode: 'sentinel',
  sentinel: {
    sentinels: [
      { host: 'sentinel1.example.com', port: 26379 },
      { host: 'sentinel2.example.com', port: 26379 }
    ],
    name: 'mymaster',
    password: process.env.REDIS_PASSWORD ?? ''
  },
  namespace: 'app'
})

// Cluster (sharded)
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

#### Scenario 3 — forRootAsync with ConfigService

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

> [!IMPORTANT]
> **Call `app.enableShutdownHooks()` in `main.ts`.** Nest runs `OnApplicationShutdown` on `SIGTERM` / `SIGINT` only when shutdown hooks are enabled. Without it the process exits on a signal without quitting the Redis connection gracefully, and `shutdownTimeoutMs` never comes into play. The connections close in that hook, after the HTTP server has stopped, so a request still in flight when the signal arrives keeps its cache.

```typescript
const app = await NestFactory.create(AppModule)
app.enableShutdownHooks()
await app.listen(3000)
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

| Option                   | Type                                      | Default          | Description                                                                                                                                                                                |
| ------------------------ | ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`                   | `'standalone' \| 'sentinel' \| 'cluster'` | `'standalone'`   | Redis topology                                                                                                                                                                             |
| `connection.url`         | `string`                                  | —                | `redis://` / `rediss://` URL (overrides discrete host/port fields)                                                                                                                         |
| `connection.tls`         | `tls.ConnectionOptions`                   | —                | TLS options for `rediss://`                                                                                                                                                                |
| `namespace`              | `string`                                  | `'app'`          | Key prefix for tenant/feature isolation                                                                                                                                                    |
| `serializer`             | `ISerializer`                             | `JsonSerializer` | Value encoding/decoding (plug MsgPack, CBOR, etc.)                                                                                                                                         |
| `events.onEvent`         | `(event, data) => void`                   | —                | Lifecycle and Pub/Sub failure hook (plug a logger or metrics); receives connection events, and `'error'` with `reason: 'handler_error'` when a subscriber handler or deserialization fails |
| `scripts`                | `IScriptDefinition[]`                     | —                | Lua scripts to preload on init                                                                                                                                                             |
| `shutdownTimeoutMs`      | `number`                                  | `5000`           | Graceful `quit()` timeout before forced `disconnect()` (minimum `100`)                                                                                                                     |
| `keySeparator`           | `string`                                  | `':'`            | Separator between namespace, prefix and id segments                                                                                                                                        |
| `keyEscaping`            | `'legacy' \| 'strict'`                    | `'legacy'`       | How prefix and id are joined; `'strict'` escapes each part so no two tuples share a key (see Key Namespacing)                                                                              |
| `allowFlushInProduction` | `boolean`                                 | `false`          | Allows `flushNamespace()` when `NODE_ENV=production`                                                                                                                                       |
| `isGlobal`               | `boolean`                                 | `true`           | Register the module globally                                                                                                                                                               |
| `sentinel`               | `{ sentinels, name, ... }`                | —                | Sentinel connection block; required when `mode: 'sentinel'`                                                                                                                                |
| `cluster`                | `{ nodes, options? }`                     | —                | Cluster connection block; required when `mode: 'cluster'`                                                                                                                                  |

`connection` also accepts `host`, `port`, `password`, `db`, `username`, `lazyConnect`, `connectTimeout` (minimum `100`), `commandTimeout`, `maxRetriesPerRequest`, `enableReadyCheck`, `enableOfflineQueue`, `retryStrategy`, `reconnectOnError`, `keepAlive`, `noDelay` and `family`; `url` takes precedence over the discrete fields.

Both `forRoot(options)` (synchronous) and `forRootAsync({ useFactory, inject, imports })` are supported. The module registers globally by default — pass `isGlobal: false` to scope it to the importing module. With `forRootAsync`, `isGlobal` is read at the call site (`forRootAsync({ isGlobal, ... })`); a value returned from `useFactory` has no effect.

---

## 🔌 A second, dedicated connection

`BymaxCacheModule` registers one connection. When another part of the application needs its own, with different options (for example a standalone connection beside a cache that runs in cluster mode), build it with `createConnectionManager` rather than hand-writing the resolved options, which would skip validation and the defaults.

```ts
import { Inject, Injectable, Module } from '@nestjs/common'
import { ConnectionManager, createConnectionManager } from '@bymax-one/nest-cache'

export const AUTH_REDIS = Symbol('AUTH_REDIS')

@Module({
  providers: [
    {
      provide: AUTH_REDIS,
      useFactory: (): ConnectionManager =>
        createConnectionManager({
          mode: 'standalone',
          connection: { url: process.env.AUTH_REDIS_URL ?? 'redis://localhost:6379' }
        })
    }
  ],
  exports: [AUTH_REDIS]
})
export class AuthRedisModule {}

@Injectable()
export class SessionStore {
  constructor(@Inject(AUTH_REDIS) private readonly redis: ConnectionManager) {}

  async ping(): Promise<string> {
    return this.redis.getClient().ping()
  }
}
```

It takes the same options as `forRoot()` and runs the same validation and defaults, so an invalid set throws the same `CacheException` before any client exists. The manager owns its connection: Nest connects it on `onModuleInit` and quits it on `onApplicationShutdown`, with the forced `disconnect()` after `shutdownTimeoutMs`, so you write neither hook. The connection is independent of the one the module registers, and the client you get from `getClient()` applies no namespace: its keys are not prefixed.

---

## 🔑 Key Namespacing

Every key is composed as `{namespace}{separator}{prefix}{separator}{id}` (default separator `:`).
Calling `cache.get('user-profile', '42')` under namespace `app` reads `app:user-profile:42`. This
keeps tenants and features isolated and makes `flushNamespace()` surgical. Reaching for
`getClient()` to set raw, un-namespaced keys is supported as an escape hatch but documented as an
anti-pattern.

`prefix` and `id` are supplied by the caller, and the library always rejects an empty one
(`INVALID_KEY`). What it does with a separator or a glob character inside them depends on
`keyEscaping`:

| `keyEscaping`        | `build('a', 'b:c')` | `build('a:b', 'c')` | Glob character in `prefix`                      |
| -------------------- | ------------------- | ------------------- | ----------------------------------------------- |
| `'legacy'` (default) | `app:a:b:c`         | `app:a:b:c`         | widens `keys()` / `scan()` within the namespace |
| `'strict'`           | `app:a:b%3Ac`       | `app:a%3Ab:c`       | a literal                                       |

Under `'strict'` each part is escaped, so **no two distinct `(prefix, id)` tuples compose one key**.
The escape rewrites `%`, every character of the separator, glob metacharacters (`*`, `?`, `[`, `\`)
in the `prefix`, and unpaired surrogates as `%XX` (ASCII) or `%uXXXX` tokens. A part holding none of
those keeps its bytes, so most keys do not change. `keys()` and `scan()` escape only the `prefix` and
pass the pattern through as a glob. A separator containing `%` or a glob character (`*`, `?`, `[`, `\`) is rejected under `'strict'`, and `escapePart` refuses a `%` separator in either mode.

```ts
BymaxCacheModule.forRoot({ connection: { host: 'localhost' }, keyEscaping: 'strict' })
```

Inject `KeyBuilder` for the helpers: `escapePart('tenant:7')` returns `'tenant%3A7'`, safe to join several
fields into one `id`, and `parse('app:a%3Ab:c')` returns `{ prefix: 'a:b', id: 'c' }` under `'strict'`.

The `scan()` / `keys()` pattern is a glob over the _escaped_ id, and a stored id holds no separator character under `'strict'`, so a pattern that spells one as a literal can never match and throws `INVALID_KEY` instead of returning nothing. The check stops at the first character class (`[...]`): a class can match ids that hold none of its members, and Redis's rules for closing one are not copied here, so a pattern with a class is accepted and may match nothing. A separator character that escape tokens are also spelled with is the exception: it cannot be told apart from a token, so it is never refused and a pattern holding it may match nothing. To sweep a composite id (every session of one user, say), build the ids from escaped fields and use `idPrefixPattern`:

```ts
import { Injectable } from '@nestjs/common'
import { CacheService, KeyBuilder } from '@bymax-one/nest-cache'

@Injectable()
export class SessionStore {
  constructor(
    private readonly cache: CacheService,
    private readonly keys: KeyBuilder
  ) {}

  async save(userId: string, sessionId: string): Promise<void> {
    const id = [userId, sessionId].map((field) => this.keys.escapePart(field)).join(':')
    await this.cache.set('sessions', id, { device: 'phone' })
  }

  async revokeAll(userId: string): Promise<void> {
    // every key of userId, and no key of 'u10' when userId is 'u1'
    for await (const key of this.cache.scan('sessions', this.keys.idPrefixPattern([userId]))) {
      void key
    }
  }
}
```

Turning `'strict'` on changes the key of every part the escape rewrites; a key with plain parts is the same in both modes, and `KeyBuilder.buildLegacy(prefix, id)` returns the unescaped key. Every instance sharing a Redis must run one mode: during a rolling deploy a lock or counter on a rewritten part is held once per mode. `CacheStatusService.config().keyEscaping` (from `./admin`) shows what an instance runs.

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

Pub/Sub also works in cluster mode: channel and pattern subscribers both receive the message, which
the end-to-end suite verifies against a three-master cluster.

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

Whatever a custom serializer throws reaches the caller as a `CacheException` (`SERIALIZATION_FAILED` or `DESERIALIZATION_FAILED`) whose `details` hold a fixed text and never the value, with the original error on `cause`. An error that is already a `CacheException` passes through unchanged.

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

## 📊 Connection metrics (`/metrics`)

The readiness probe says whether the cache answers _now_. It cannot see a connection that drops and
recovers between two probes, which is the failure worth seeing. `/metrics` counts the lifecycle
events of each connection and reports whether each is ready, on the `prom-client` registry that
[`@bymax-one/nest-core`](https://www.npmjs.com/package/@bymax-one/nest-core) already serves, with
nothing to wire beyond two providers. It needs `@bymax-one/nest-core` `^1.1.0` and `prom-client`
`^15`, both optional peers.

```typescript
import { BymaxCacheModule } from '@bymax-one/nest-cache'
import {
  CACHE_CONNECTION_TALLY,
  CacheConnectionMetrics,
  CacheConnectionTally
} from '@bymax-one/nest-cache/metrics'

const tally = new CacheConnectionTally()

@Module({
  imports: [BymaxCacheModule.forRoot({ connection: { host: 'localhost' }, events: tally.events })],
  providers: [{ provide: CACHE_CONNECTION_TALLY, useValue: tally }, CacheConnectionMetrics]
})
export class ObservabilityModule {}
```

| Metric                                | Type    | Labels          | Meaning                                                 |
| ------------------------------------- | ------- | --------------- | ------------------------------------------------------- |
| `bymax_cache_connection_events_total` | counter | `role`, `event` | Lifecycle events since start, per connection            |
| `bymax_cache_connection_ready`        | gauge   | `role`          | `1` while the connection's latest transition is `ready` |

- **Everything is per role.** The module runs a main client and a dedicated subscriber, and both
  emit the same events. Alert on `role="main"`; the subscriber is control-plane traffic whose
  loss costs Pub/Sub delivery, not cache reads.
- **An `error` carrying a `reason` is not a socket failure.** `forced_disconnect` (graceful
  shutdown) and `handler_error` (a subscriber handler threw) are counted but never move readiness.
  Only an `error` carrying the driver's message does.
- **Labels come from a closed set.** `role` is `main` or `subscriber`; anything else is recorded as
  `unknown`. No part of an error message is ever a label, since a driver message can carry a host or
  a credential. To record a connection of your own under its own role, declare it with
  `new CacheConnectionTally({ roles: ['auth'] })` and pass `tally.eventsAs('auth')` as its `events`.
- Events recorded before the registry exists are published too: the tally records from the first
  event, and each scrape reads it.

---

## 🔎 Administration surface (`/admin`)

A read-only surface for an operator-facing console: is the cache answering, what is it doing, what is in it.

> [!WARNING]
> **`/admin` has no authentication or authorization of its own.** The library registers services, not routes: `CacheStatusService` and `CacheAdminService` list keys, report `INFO` statistics and, for a readable scope, return stored values to whoever calls them. Put every route you build on them behind your own guard (an authenticated operator role), and never on a public route.

```ts
import { BymaxCacheModule } from '@bymax-one/nest-cache'
import { BymaxCacheAdminModule } from '@bymax-one/nest-cache/admin'

// `config` is a ConfigService reachable where the module is declared; see
// Scenario 3 above for the forRootAsync form that injects it properly.
@Module({
  imports: [
    BymaxCacheModule.forRoot({
      connection: { url: config.getOrThrow<string>('REDIS_URL') },
      namespace: 'my-app'
    }),
    BymaxCacheAdminModule.forRoot({
      scopes: [
        {
          id: 'cache',
          label: 'Application cache',
          pattern: 'my-app:*',
          isReadable: true,
          origin: "the application's own namespace, written through the typed API"
        },
        {
          id: 'auth',
          label: 'Authentication',
          pattern: 'auth:*',
          isReadable: false,
          origin:
            'written by another library through the un-namespaced client, so it sits at Redis ' +
            'root. Values are refused: this keyspace holds session records.'
        }
      ]
    })
  ]
})
export class AppModule {}
```

```ts
constructor(
  @Inject(CacheStatusService) private readonly status: CacheStatusService,
  @Inject(CacheAdminService) private readonly admin: CacheAdminService
) {}

await this.status.health()   // { status: 'up', latencyMs: 3, mode, isScanSupported, degradedAboveMs }
await this.status.stats()    // parsed INFO
this.status.config()         // resolved wiring, connection URL withheld
this.admin.listScopes()      // never touches the connection
await this.admin.listKeys('cache', { includeSize: true })
await this.admin.revealValue('auth', 'auth:sess:1')  // { status: 'withheld', origin }
```

### Options

| Option              | Type                    | Default | Description                                                              |
| ------------------- | ----------------------- | ------- | ------------------------------------------------------------------------ |
| `scopes`            | `readonly CacheScope[]` | —       | The keyspaces this deployment exposes; required                          |
| `degradedAboveMs`   | `number`                | `250`   | Probe latency above which `health()` reports `degraded`                  |
| `probeTimeoutMs`    | `number`                | `2000`  | How long `health()` waits for `PING` before reporting `down`             |
| `scanLimit`         | `number`                | `500`   | Entries one `listKeys` page may carry (a page can slightly exceed it)    |
| `commandBatchLimit` | `number`                | `100`   | Commands in one pipeline batch                                           |
| `revealLimit`       | `number`                | `200`   | Members or fields `revealValue` returns before `isComplete` is `false`   |
| `revealStringLimit` | `number`                | `4096`  | Characters of a string value `revealValue` returns                       |
| `isGlobal`          | `boolean`               | `false` | Register the admin module globally. The cache module's default is `true` |

Every threshold must be a positive integer; one that is not fails the boot with `cache.invalid_scope`. `CacheAdminService` also has `listScopes()` and `describeKey(scope, key)`, which returns a key's type, TTL and whether its value is readable, without the value.

The library owns the mechanism (validating the allowlist, scanning against it, describing keys, withholding values). The application owns which keyspaces exist, their `origin` text, the routes and the guards.

### Scopes

A scope pattern is a literal prefix, optionally ending in `*`: `auth:*`, `my-app:*` and exact keys are accepted; `app:*:v1`, `*`, `a?b` and `a[bc]` are refused at wiring. Key membership is therefore exact: a caller names a key and the library checks it against the named scope by prefix, never with a glob matcher.

`isReadable: false` withholds the value only. Listing, types, TTLs and sizes stay available, and the refusal is returned before the value is read. A withheld value is not an authorization failure, since the deployment declared the keyspace unreadable at wiring and no credential changes that, so do not serve it as `403`.

Readings that would carry two meanings are unions, not nullables: `maxmemory` is `unbounded | limited | unreported`, a TTL is `expiring | persistent | missing`, `aofEnabled` is `boolean | null`, and health is `{ up | degraded, latencyMs } | { down, reason, code }`. `mode`, `isScanSupported` and `degradedAboveMs` sit outside the health union.

### Reading a value: `revealed` / `withheld` / `missing`

`revealValue()` answers with a discriminated union, because "I may not tell you" and "there is nothing here" are different answers.

```ts
import type { CacheAdminService } from '@bymax-one/nest-cache/admin'

async function describeValue(admin: CacheAdminService, scope: string, key: string) {
  const result = await admin.revealValue(scope, key)

  switch (result.status) {
    case 'revealed':
      // `result.type` is the Redis type; `result.value` is shaped by it.
      return { type: result.type, value: result.value }
    case 'withheld':
      // The scope declares `isReadable: false`. `origin` explains why, verbatim.
      // Listing, types, TTLs and sizes for this key remain available.
      return { refusedBecause: result.origin }
    case 'missing':
      return { gone: true }
  }
}
```

The revealed value is shaped by the key's type:

| `value.kind`  | Shape                              | Notes                                                                                    |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `string`      | `{ value: string }`                | Truncated to `revealStringLimit`                                                         |
| `hash`        | `{ fields: { field, value }[] }`   | `field`, matching Redis's own vocabulary (`HSET key field value`)                        |
| `members`     | `{ members: string[] }`            | **Sets and lists both.** The enclosing `type` says which — see the ordering caveat below |
| `scored`      | `{ members: { member, score }[] }` | Sorted sets. `score` is a **string**: parsing to a number would round large integers     |
| `unsupported` | `{ type: RedisKeyType }`           | Streams and module types — says so, rather than returning an empty value                 |

Every arm except `unsupported` carries `isComplete`; `false` means the value was cut.

> [!IMPORTANT]
> **List order is meaningful; set order is not**, and both arrive in the same `members` array. Sort for display only when `type === 'set'`.

### Costs

- `sampledCount` / `sampledBytes` are sums over a capped `SCAN`, not measurements of the keyspace; `isComplete` is the fact.
- A page may carry slightly more than `scanLimit` entries: `SCAN` returns whole batches, so the limit stops the loop rather than trimming the result.
- Sizing is opt-in (`includeSize`), and every pipeline batch is bounded in commands, not keys, because a large pipeline blocks the single-threaded server for the whole burst.
- The config payload carries a connection's host, port and a TLS flag, never its URL or credentials.
- `mem_fragmentation_ratio` is reported raw; turning it into a verdict is deployment policy.

### Cluster

Every scan-based operation throws `UNSUPPORTED_IN_CLUSTER`, inherited from `CacheService.getClient()` rather than restated. `isScanSupported` travels on the health payload so a console never has to re-derive that rule from `mode`.

---

## 🏗️ Architecture

The package runs **inside** your NestJS application as a dynamic module, not as a separate service: `CacheService` and `PubSubService` sit on a `ConnectionManager` (the Pub/Sub subscriber connection is created lazily), `ScriptManagerService` runs scripts with `EVALSHA` and a `NOSCRIPT` fallback, and `KeyBuilder` composes every key and channel as `{namespace}{sep}{prefix}{sep}{id}`.

Both consumer-facing contracts are optional: omit `serializer` and you get `JsonSerializer`; omit `events.onEvent` and connection events are simply not forwarded anywhere.

DI tokens are `Symbol`s (`BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`, `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`, `BYMAX_CACHE_SERIALIZER`, `BYMAX_CACHE_KEY_BUILDER`); all providers are singletons. The module is built with `ConfigurableModuleBuilder` and registers globally by default via the `isGlobal` extra (which sets `DynamicModule.global`) — there is no `@Global()` decorator.

---

## 🔐 Security Model

A cache sits between your application and every value it has ever computed, so the security posture is about two things: one tenant's data never being reachable from another tenant's key, and a hostile or corrupt payload never being handed back as a valid object.

### Namespace isolation is structural

Every key and every Pub/Sub channel is composed through `KeyBuilder`, which prepends `{namespace}{separator}` before the command reaches Redis. With fixed literals, `CacheService.get('user-profile', '42')` reads `app:user-profile:42` — there is no code path through the typed API that emits a bare key. The namespace is the isolation boundary; the library does not constrain `prefix` and `id` beyond non-emptiness.

The namespace is validated at module bootstrap, not at call time: an empty or whitespace-only namespace, one containing the key separator, or one containing a glob metacharacter fails with `INVALID_NAMESPACE`, and an empty `prefix` or `id` at the call site fails with `INVALID_KEY` before any command is sent. A namespace containing the separator is rejected because `namespace: 'a:b'` and `namespace: 'a'` with prefix `b` would resolve to the same keyspace.

The same collision exists below the namespace: under `keyEscaping: 'legacy'` (the default) `prefix` and `id` are validated only for emptiness, so `build('a', 'b:c')` and `build('a:b', 'c')` both give `app:a:b:c`, and a glob metacharacter in `prefix` widens `keys()` / `scan()` within the namespace. Set `keyEscaping: 'strict'` and the composition is injective: no two distinct `(prefix, id)` tuples share a key, and a `prefix` is always a literal. See Key Namespacing for what changes when you switch.

### Deserialization fails closed

`JsonSerializer.deserialize` throws `CacheException(DESERIALIZATION_FAILED)` on any payload that is not valid JSON; it never returns `undefined` or a partial object. It does not check valid JSON against `T`, so validate the shape of untrusted data in your application. The same contract is required of any custom `ISerializer`. Serialization is symmetric: a top-level `undefined`, function or `symbol` is rejected up front, because `JSON.stringify` returns `undefined` for those without throwing.

### Secrets stay out of error payloads

Error `details` are built to be safe to log:

- A malformed `connection.url` throws `CONNECTION_FAILED` with `reason: 'invalid connection.url'` — the URL is omitted, because it may embed a password.
- `SERIALIZATION_FAILED` carries the encoder's message, never the value being encoded.
- `DESERIALIZATION_FAILED` carries a fixed `error` text and the `length` of the stored value, and nothing from its content — not a preview, not the parser's message, which quotes the start of its input. The exception is an `HttpException`, so a default Nest filter sends `details` to the HTTP client; a cached record holding PII or a token must never reach it.

### Destructive operations are guarded in production

`flushNamespace()` throws `CacheException(FLUSH_DISABLED_IN_PRODUCTION)` when `NODE_ENV === 'production'` unless `allowFlushInProduction` is explicitly set. When it does run, it iterates with `SCAN` scoped to `{namespace}{separator}*` and removes keys with `UNLINK` (asynchronous reclaim), so it neither touches another namespace nor blocks the server on a large keyset.

### Lua scripts are registered, never interpolated

Scripts are declared up front (through `options.scripts` or `ScriptManagerService.register(name, lua)`) and executed by name: a call site passes `eval(scriptName, keys, args)` and cannot pass a script body. Keys are namespaced before execution and arguments arrive as `ARGV[]`, which Lua treats as data. Standalone and Sentinel use `EVALSHA` with a `NOSCRIPT` reload-and-retry; Cluster sends the full body via `EVAL`, because `EVALSHA` routes by key slot.

### The namespace cannot widen a destructive pattern

`validateOptions` rejects a namespace containing a Redis glob metacharacter (`*`, `?`, `[`, `\`), because the namespace is composed into `flushNamespace()`'s match pattern: `*` and `?` widen it into other keyspaces, `\` escapes into a different one while sparing its own keys, and `[` opens a class that never closes, so the flush matches nothing and reports success. `]` is accepted, since an unpaired one is a literal. This matters most when the namespace is derived from input, such as a tenant slug.

### Cluster mode refuses commands it cannot honor safely

`scan()`, `keys()`, `flushNamespace()`, and `getClient()` throw `UNSUPPORTED_IN_CLUSTER` under `mode: 'cluster'` rather than silently operating on one node. `KEYS` carries no key, so the cluster client sends it to a single node and the reply would list only that node's share of the keyspace. A partial flush that reports success is worse than an error.

### Security Checklist

When integrating `@bymax-one/nest-cache` in production, verify each of the following:

- `namespace` is distinct per tenant or per application — it is the isolation boundary, and a shared value makes every other guarantee moot
- `allowFlushInProduction` stays unset; if it is on, the reason belongs in a security review
- `getClient()` and `pipeline()` call sites are audited — they are the only paths that bypass namespacing
- `keyEscaping: 'strict'` is set, so a separator inside `prefix` or `id` cannot collide two keys and a glob character in `prefix` cannot widen `keys()` / `scan()`; under the default `'legacy'`, `prefix` and `id` that derive from untrusted input must be rejected or escaped by the caller (`KeyBuilder.escapePart`)
- Connection credentials come from the environment (`config.getOrThrow('REDIS_URL')`), never from a URL literal in module options in source control
- `rediss://` (or an explicit `connection.tls`) is used for any Redis reachable off-host
- Values that must not be readable by whoever can read Redis are encrypted by the application (or a custom `ISerializer`) before they are cached — the library stores what you hand it
- Cached entries carry a TTL sized to your data-retention policy; namespacing bounds who can read an entry, not how long it exists
- Custom `ISerializer` implementations throw on malformed input rather than returning a fallback value
- If `/admin` is wired, its routes are behind the application's own authorization — the library validates scopes and withholds values, it does not authenticate anyone
- Any admin scope whose keyspace holds credentials is declared `isReadable: false`, and the deployment understands that this withholds the **value only** — listing, types, TTLs and sizes stay visible by design

---

## 🛡️ Security Table

| Layer                 | Implementation                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tenant Isolation      | Every key and channel is composed by `KeyBuilder`; no bare-key path in the typed API                             |
| Namespace Validation  | An empty, separator-containing or glob-metacharacter namespace is rejected at bootstrap (`INVALID_NAMESPACE`)    |
| Key Validation        | An empty `prefix` or `id` is rejected (`INVALID_KEY`); `keyEscaping: 'strict'` makes the composition injective   |
| Admin Scope Allowlist | Scopes are declared at wiring and frozen; a caller names a scope by id and never supplies a pattern              |
| Admin Read-Only       | `/admin` issues no mutating command, enforced by the `check:admin-readonly` build gate                           |
| Deserialization       | A payload that is not valid JSON throws `DESERIALIZATION_FAILED`; valid JSON is not checked against `T`          |
| Error Payloads        | Connection URLs and stored values never appear in error `details`                                                |
| Destructive Ops       | `flushNamespace()` is blocked in production unless `allowFlushInProduction`; `SCAN` + `UNLINK`, namespace-scoped |
| Lua Execution         | Scripts are registered by name; call sites pass keys and arguments, never a script body                          |
| Cluster Safety        | `scan`, `keys`, `flushNamespace` and `getClient` throw `UNSUPPORTED_IN_CLUSTER` instead of acting on one node    |
| Transport             | `rediss://` sets TLS on the client; `connection.tls` covers a custom CA or mTLS                                  |
| Supply Chain          | Nothing is bundled and every dependency is a peer you pin; published with npm provenance                         |

> [!IMPORTANT]
> The namespace is the isolation boundary. Anything reached through `getClient()` or `pipeline()` sits outside it.

---

## 🧱 Tech Stack

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![ioredis](https://img.shields.io/badge/ioredis-6-DC382D?style=flat-square&logo=redis&logoColor=white)](https://github.com/redis/ioredis)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Jest](https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest)](https://jestjs.io)
[![Stryker](https://img.shields.io/badge/Stryker-Mutation_Testing-red?style=flat-square)](https://stryker-mutator.io)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![tsup](https://img.shields.io/badge/tsup-9-orange?style=flat-square)](https://tsup.egoist.dev)

---

## 🧪 Testing & Quality

A cache is consulted on the hot path of every request that touches it, so the suite is held to a bar beyond "it runs" — every behavior is pinned so that a regression **fails a test**.

- ✅ **100% line coverage** — statements, branches, functions, and lines, enforced by `jest.coverage.config.ts` as a pre-publish gate, not a target
- ✅ **100% mutation score** — verified with [Stryker](https://stryker-mutator.io/) at `break: 100` and `ignoreStatic: false`, **0 survived**, and [documented in full](./docs/mutation_testing_results.md)
- ✅ **No real Redis in unit tests** — `ioredis-mock` throughout; e2e tests exercise the wired module through `@nestjs/testing` and Testcontainers against a real Redis for connection lifecycle, Pub/Sub, and Lua scripts
- ✅ **Published-package smoke test** — `scripts/dogfood-smoke-test.mjs` validates exports, tarball shape, and a consumer install before tagging

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

**TTLs.** `ttlSeconds` on `set`, `setRaw` and `setNx` is a safe integer of at least `1`; omit it for no expiry. `expire` takes a safe integer, and as in Redis a zero or negative one deletes the key. Anything else throws `INVALID_TTL` before a command is sent.

### `PubSubService`

`publish<T>(channel, message)` · `subscribe<T>(channel, handler)` · `psubscribe<T>(pattern, handler)`

### `ScriptManagerService`

`register(name, lua)` · `load(name)` · `eval(name, keys, args)`

### Errors

`CacheException` (extends `HttpException`) + `CACHE_ERROR_CODES` (namespaced `cache.*`).

### Types, constants and tokens

From `@bymax-one/nest-cache`:

| Export                                                                                          | What it is                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `BymaxCacheModuleOptions`, `BymaxCacheModuleAsyncOptions`                                       | The options of `forRoot()` and `forRootAsync()`; the Configuration table lists their fields |
| `BymaxCacheStandaloneConnection`, `BymaxCacheSentinelConnection`, `BymaxCacheClusterConnection` | The `connection`, `sentinel` and `cluster` blocks                                           |
| `RedisOptions`, `ClusterOptions`, `ClusterNode`, `SentinelAddress`                              | The ioredis option types the blocks above refer to, re-exported                             |
| `ResolvedOptions`                                                                               | The shape injected under `BYMAX_CACHE_OPTIONS`, with every default applied                  |
| `IPubSubHandler`, `IPubSubPatternHandler`, `Unsubscribe`                                        | The handler signatures and the function `subscribe` / `psubscribe` return                   |
| `CACHE_ERROR_MESSAGES`                                                                          | The default message of every code, keyed by code                                            |
| `DEFAULT_NAMESPACE`, `DEFAULT_KEY_SEPARATOR`, `DEFAULT_REDIS_PORT`                              | `'app'`, `':'` and `6379`                                                                   |

From `@bymax-one/nest-cache/shared` (also re-exported from the main entry): `CACHE_EVENT_NAMES`, `CacheEventName`, `CacheConnectionStatus`, `CacheErrorCode`, `CacheNamespace`, `CacheKeyPrefix` and `SerializableValue`.

From `@bymax-one/nest-cache/admin`: `BymaxCacheAdminModuleOptions` and `BymaxCacheAdminModuleAsyncOptions` (the Options table above), `CacheScope`, `ListKeysOptions`, the result types `CacheHealth`, `CacheConfig`, `CacheMode`, `RedisStats`, `KeyspacePage`, `KeyEntry`, `KeyDetail`, `KeyTtl`, `RevealResult` and `RevealedValue`, the token `BYMAX_CACHE_ADMIN_OPTIONS`, and the defaults `DEFAULT_DEGRADED_ABOVE_MS`, `DEFAULT_PROBE_TIMEOUT_MS`, `DEFAULT_SCAN_LIMIT`, `DEFAULT_COMMAND_BATCH_LIMIT`, `DEFAULT_REVEAL_LIMIT` and `DEFAULT_REVEAL_STRING_LIMIT`.

The other names `/admin` exports (the scope and `INFO` helpers such as `validateScopes` and `readRedisStats`, `resolveAdminOptions`, and the reader contracts) are implementation helpers, marked `@deprecated`: they will leave the public surface in 2.0.0, so do not depend on them.

---

## 🪪 Default Error Codes

All errors are instances of `CacheException` and carry a stable `code` string from `CACHE_ERROR_CODES`:

| Code                                 | HTTP | When thrown                                                                                                                                                                                                                                            |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cache.connection_failed`            | 500  | Cannot connect after retries; also bootstrap validation of `connection` and timeouts                                                                                                                                                                   |
| `cache.command_timeout`              | 504  | Reserved, never thrown today                                                                                                                                                                                                                           |
| `cache.connection_lost`              | 503  | Reserved, never thrown today                                                                                                                                                                                                                           |
| `cache.deserialization_failed`       | 500  | Malformed payload in `get<T>`                                                                                                                                                                                                                          |
| `cache.serialization_failed`         | 500  | Unserializable value in `set<T>`                                                                                                                                                                                                                       |
| `cache.invalid_key`                  | 400  | Empty prefix or id (`build`), or empty key (`applyNamespace`)                                                                                                                                                                                          |
| `cache.invalid_ttl`                  | 400  | `ttlSeconds` is not a safe integer, or is below 1 for `set` / `setRaw` / `setNx`                                                                                                                                                                       |
| `cache.invalid_namespace`            | 500  | Empty or whitespace-only namespace, empty `keySeparator`, namespace containing the separator or a glob metacharacter (`*`, `?`, `[`, `\`), a `keyEscaping` other than `legacy` or `strict`, a `%` separator under `strict` (and `escapePart` with one) |
| `cache.script_not_registered`        | 500  | `eval(name)` before `register(name)`                                                                                                                                                                                                                   |
| `cache.script_execution_failed`      | 500  | Lua runtime error or NOSCRIPT retry failure                                                                                                                                                                                                            |
| `cache.script_registry_missing`      | 500  | `eval` called when no `ScriptManagerService` is wired                                                                                                                                                                                                  |
| `cache.flush_disabled_in_production` | 403  | `flushNamespace()` in prod without `allowFlushInProduction`                                                                                                                                                                                            |
| `cache.unsupported_in_cluster`       | 500  | `scan`, `keys`, `flushNamespace`, or `getClient` called in cluster mode                                                                                                                                                                                |
| `cache.cluster_misconfigured`        | 500  | `mode: 'cluster'` without `cluster.nodes`                                                                                                                                                                                                              |
| `cache.sentinel_misconfigured`       | 500  | `mode: 'sentinel'` without `sentinel.sentinels`/`name`                                                                                                                                                                                                 |
| `cache.shutdown_timeout`             | 500  | Internal, never thrown to the caller: `quit()` exceeded `shutdownTimeoutMs`, so the library forces `disconnect()` and emits `error` with `reason: 'forced_disconnect'`                                                                                 |
| `cache.invalid_scope`                | 500  | `/admin` scope allowlist invalid at wiring                                                                                                                                                                                                             |
| `cache.scope_not_found`              | 500  | `/admin` call named an undeclared scope id                                                                                                                                                                                                             |
| `cache.scope_not_readable`           | 500  | Reserved, never thrown today (unreadable scopes return `withheld`)                                                                                                                                                                                     |
| `cache.key_not_in_scope`             | 500  | `/admin` call named a key outside the named scope                                                                                                                                                                                                      |

---

## 🚫 What This Library Does NOT Do

Reliable atomic primitives are in scope; opinionated policies are not. By design, the following are out of scope:

- ❌ **Rate limiting** — compose `incr` + `expire` or a custom Lua script
- ❌ **Distributed locks** — `setNx` + a release script covers the common case
- ❌ **BullMQ wiring** — [`@bymax-one/nest-queue`](https://github.com/bymaxone/nest-queue) takes this module's `ConnectionManager` client instead (its Mode A, standalone)
- ❌ **Cache-aside / read-through patterns** — that policy belongs in your repositories, not in the client
- ❌ **Compression and at-rest encryption** — implement a custom `ISerializer`
- ❌ **Tag-based invalidation** — namespaces and prefixes are the invalidation unit
- ❌ **Redis Streams** — a different consumption model than Pub/Sub; out of scope for this package

---

## 🤝 Contributing

Contributions are welcome. TypeScript strict, TDD with a 100% coverage gate and a 100% mutation break threshold, Conventional Commits, peer dependencies only. Run the full gate before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm check:admin-readonly && pnpm test:cov:all && pnpm build && pnpm size && pnpm check:exports
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
