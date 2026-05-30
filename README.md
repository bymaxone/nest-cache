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

> [!NOTE]
> **Status: under active development.** The package layout, tooling, CI/CD, and the 100% coverage
> gate follow the Bymax lib standard and are already in place. The cache engine ships across
> Phases 1-4 — see [`docs/development_plan.md`](./docs/development_plan.md). The API documented
> below is the **target design** from [`docs/technical_specification.md`](./docs/technical_specification.md).

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

**1. Register the module** (once, in your root module):

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
          // Plug @bymax-one/nest-logger or a metrics layer here
          onEvent: (event, data) => console.log(`[cache] ${event}`, data)
        }
      })
    })
  ]
})
export class AppModule {}
```

**2. Inject `CacheService`** anywhere (the module is global by default):

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

The keys above resolve to `app:user-profile:<userId>` — namespaced automatically.

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

// At call site (keys are namespaced for you):
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

## 🧪 Testing & Quality

- **100% coverage** (statements / branches / functions / lines) — enforced by `jest.coverage.config.ts` as a pre-publish gate, not a target.
- **Mutation testing** — Stryker configured with `break: 95` and `ignoreStatic: false`; the baseline runs as a manual release gate (Phase 5). See [`docs/mutation_testing_plan.md`](./docs/mutation_testing_plan.md).
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
