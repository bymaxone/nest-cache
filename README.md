<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--cache-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-cache" />
</p>

<h1 align="center">@bymax-one/nest-cache</h1>

<p align="center">
  <strong>Typed Redis cache for NestJS</strong><br />
  <sub>ioredis 5 · Namespacing · Pub/Sub · Lua Scripts · Multi-Tenant · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-cache"><img src="https://img.shields.io/npm/v/@bymax-one/nest-cache?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-cache"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-cache?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-cache/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-cache/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-cache/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-cache/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-pending-lightgrey?style=flat-square&colorA=000000" alt="mutation score" /></a>
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

## 🔥 Features

- **Typed API** — `get<T>` / `set<T>` / `setNx<T>` / `mget<T>` / `mset<T>` with a pluggable serializer
- **Automatic namespacing** — key builder enforces tenant/feature isolation; no manual string concatenation
- **Full command surface** — strings, numbers (`incr`/`decr`), hashes, sets, TTL (`expire`/`ttl`/`persist`), iteration (`scan`)
- **Pub/Sub** — `publish` / `subscribe` / `psubscribe` on namespaced channels with typed handlers and a lazy subscriber connection
- **Lua scripts** — register scripts up front, execute via `EVALSHA` with transparent `NOSCRIPT` reload + retry
- **Multi-topology** — standalone, Sentinel, and Cluster modes from the same options shape
- **Fail-closed serialization** — malformed payloads raise `CacheException(DESERIALIZATION_FAILED)`, never a partial value
- **Production safety** — `flushNamespace()` is blocked in production unless explicitly allowed
- **Health checks** — `isHealthy()` / `ping()` / `info()` for readiness and liveness endpoints
- **Connection events** — `connect` / `ready` / `error` / `close` / `reconnecting` / `end` surfaced via `events.onEvent`
- **Zero runtime dependencies** — everything is a peer dependency; `dependencies: {}`

## 📦 Subpath Exports

| Import                         | Contents                                                                                                 | Peer deps                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@bymax-one/nest-cache`        | `BymaxCacheModule`, `CacheService`, `PubSubService`, `ScriptManagerService`, DI tokens, `CacheException` | NestJS 11, ioredis 5, reflect-metadata |
| `@bymax-one/nest-cache/shared` | Zero-dependency types + constants (`CACHE_ERROR_CODES`, `CacheEventName`)                                | None                                   |

## 📥 Installation

```bash
pnpm add @bymax-one/nest-cache ioredis
```

> [!IMPORTANT]
> `@nestjs/common`, `@nestjs/core`, and `reflect-metadata` are peer dependencies (already present in
> any NestJS app). `ioredis` is the single functional peer — the Redis client itself.

## 🚀 Quick Start

```bash
pnpm add @bymax-one/nest-cache ioredis
```

### Scenario 1 — Standalone (dev / single node)

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

### Scenario 2 — Sentinel (high availability)

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

### Scenario 3 — Cluster (sharded)

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

### Scenario 4 — forRootAsync with ConfigService

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

**Inject `CacheService`** anywhere (the module is global by default):

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

Both `forRoot(options)` (synchronous) and `forRootAsync({ useFactory, inject, imports })` are supported. The module is `@Global()` by default.

## 🔑 Key Namespacing

Every key is composed as `{namespace}{separator}{prefix}{separator}{id}` (default separator `:`).
Calling `cache.get('user-profile', '42')` under namespace `app` reads `app:user-profile:42`. This
keeps tenants and features isolated and makes `flushNamespace()` surgical. Reaching for
`getClient()` to set raw, un-namespaced keys is supported as an escape hatch but documented as an
anti-pattern.

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

## 🏗️ Architecture

```
BymaxCacheModule (@Global, ConfigurableModuleBuilder)
  ├── ConnectionManager      singleton ioredis client + lifecycle (standalone/sentinel/cluster)
  ├── CacheService           typed, namespaced command API + eval + health
  ├── PubSubService          publish / subscribe / psubscribe (lazy subscriber)
  ├── ScriptManagerService   Lua register / load / EVALSHA + NOSCRIPT fallback
  ├── KeyBuilder             {namespace}:{prefix}:{id} composition
  └── ISerializer            JsonSerializer (default) — fail-closed
```

DI tokens are `Symbol`s (`BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`, `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`, `BYMAX_CACHE_SERIALIZER`, `BYMAX_CACHE_KEY_BUILDER`); all providers are singletons.

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

## 🪪 Default Error Codes

All errors are instances of `CacheException` and carry a stable `code` string from `CACHE_ERROR_CODES`:

| Code                                 | HTTP | When thrown                                                 |
| ------------------------------------ | ---- | ----------------------------------------------------------- |
| `cache.connection_failed`            | 500  | Cannot connect after retries                                |
| `cache.command_timeout`              | 504  | Command exceeded `commandTimeout`                           |
| `cache.connection_lost`              | 503  | Connection dropped during an in-flight operation            |
| `cache.deserialization_failed`       | 500  | Malformed payload in `get<T>`                               |
| `cache.serialization_failed`         | 500  | Unserializable value in `set<T>`                            |
| `cache.invalid_key`                  | 400  | Empty prefix or id passed to `build` / `applyNamespace`     |
| `cache.invalid_namespace`            | 500  | Empty or separator-containing namespace                     |
| `cache.script_not_registered`        | 500  | `eval(name)` before `register(name)`                        |
| `cache.script_execution_failed`      | 500  | Lua runtime error or NOSCRIPT retry failure                 |
| `cache.script_registry_missing`      | 500  | `eval` called when no `ScriptManagerService` is wired       |
| `cache.flush_disabled_in_production` | 403  | `flushNamespace()` in prod without `allowFlushInProduction` |
| `cache.unsupported_in_cluster`       | 500  | `scan` or `flushNamespace` called in cluster mode           |
| `cache.cluster_misconfigured`        | 500  | `mode: 'cluster'` without `cluster.nodes`                   |
| `cache.sentinel_misconfigured`       | 500  | `mode: 'sentinel'` without `sentinel.sentinels`/`name`      |
| `cache.shutdown_timeout`             | 500  | `quit()` exceeded `shutdownTimeoutMs`                       |

Full catalog and HTTP status mapping: [`docs/technical_specification.md §12`](./docs/technical_specification.md).

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

## 🧪 Testing & Quality

- **100% coverage** (statements / branches / functions / lines) — enforced by `jest.coverage.config.ts` as a pre-publish gate, not a target.
- **Mutation testing** — Stryker with `break: 95` and `ignoreStatic: false`; **100% global score** (427 killed, 0 survived). See [`docs/mutation_testing_results.md`](./docs/mutation_testing_results.md).
- **E2E** — `@nestjs/testing` with `ioredis-mock` and Testcontainers (real Redis) for connection lifecycle, Pub/Sub, and Lua scripts.
- **Dogfood smoke test** — `scripts/dogfood-smoke-test.mjs` validates the published package shape (exports, tarball, consumer install) before tagging.

## 🧱 Tech Stack

Node.js 24+ · NestJS 11 · ioredis 5 · TypeScript 5.9 (strict) · tsup (ESM + CJS) · Jest 30 · Stryker 9

## 🚫 What This Library Does NOT Do

Reliable atomic primitives are in scope; opinionated policies are not. **Out of scope** (use the
listed alternative): rate limiting (custom Lua or a future `nest-rate-limit`), distributed locks
(`setNx` + Lua or a future `nest-lock`), BullMQ wiring (`@bymax-one/nest-queue` owns its own
connection), cache-aside/read-through patterns (your repositories), compression and at-rest
encryption (a custom `ISerializer`), tag-based invalidation, and Redis Streams. See §13 of the
technical specification for the rationale.

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). All work
follows TDD with a 100% coverage gate; run `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size` before opening a PR.

## 🔒 Security Policy

See [SECURITY.md](./SECURITY.md) for the private vulnerability reporting process and the threat
model (cache poisoning, key injection, unsafe deserialization, production flush guard, Lua injection).

## 📄 License

[MIT](./LICENSE) © Bymax One

<p align="center"><sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub></p>
