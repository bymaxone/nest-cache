# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-01

### Added

- Initial release of `@bymax-one/nest-cache`
- `BymaxCacheModule.forRoot()` and `forRootAsync()` via `ConfigurableModuleBuilder` — global by default
- `ConnectionManager` — singleton ioredis 5 client with full lifecycle (`OnModuleInit` / `OnModuleDestroy`), bounded retry strategy, `READONLY`-failover reconnect, and graceful `quit()` with configurable shutdown timeout
- Standalone, Sentinel, and Cluster connection topologies from a single options shape
- `CacheService` — typed, namespaced command API:
  - Strings: `get<T>` · `getRaw` · `set<T>` · `setRaw` · `setNx<T>`
  - Delete / exists: `del` · `delMany` · `exists`
  - TTL: `expire` · `persist` · `ttl`
  - Numerics: `incr` · `decr`
  - Batch: `mget<T>` · `mset<T>`
  - Hashes: `hget<T>` · `hset<T>` · `hgetall<T>` · `hdel`
  - Sets: `sadd` · `srem` · `smembers` · `sismember` · `scard`
  - Iteration: `keys` (dev only) · `scan` (cursor-based, async iterator)
  - Pipeline / escape hatch: `pipeline` · `getClient`
  - Namespace: `flushNamespace` (production safety guard)
  - Health: `isHealthy` · `ping` · `info`
- `KeyBuilder` — `{namespace}{separator}{prefix}{separator}{id}` composition with configurable namespace and separator; all keys namespaced automatically; raw access via `getClient()` documented as an anti-pattern
- `ISerializer` interface + default `JsonSerializer` — fail-closed deserialization (malformed payloads throw `CacheException(DESERIALIZATION_FAILED)`, never a partial value)
- `PubSubService` — `publish<T>` / `subscribe<T>` / `psubscribe<T>` on namespaced channels; subscriber connection created lazily on first subscription
- `ScriptManagerService` — `register` / `load` / `eval` with `EVALSHA` + automatic `NOSCRIPT` reload-and-retry; cluster mode uses `EVAL` (body routing by key)
- Connection lifecycle events surfaced via `events.onEvent` callback (plug any logger or metrics backend — no observability peer dep forced)
- `CacheException` (extends `HttpException`) + `CACHE_ERROR_CODES` — stable `cache.*` error codes with mapped HTTP statuses
- Subpath exports: `.` (server — NestJS module + services) and `./shared` (zero-dependency types + constants)
- 100% coverage gate (statements / branches / functions / lines) enforced by `jest.coverage.config.ts`
- Mutation score: **100% global** (427 killed, 6 timeout, 0 survived) under Node 24 — `pnpm mutation` exits 0 (`break: 95`)
- E2E suite: `@nestjs/testing` with `ioredis-mock` + Testcontainers (standalone, sentinel, cluster, connection resilience)
- Published with npm OIDC provenance — no long-lived tokens
- Zero direct runtime dependencies (`dependencies: {}`) — `ioredis` and NestJS via peer deps
