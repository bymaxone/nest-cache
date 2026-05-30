# AGENTS.md — @bymax-one/nest-cache

> Architecture and working agreement for AI agents and human contributors. The
> dense quick rules live in [CLAUDE.md](./CLAUDE.md); the authoritative design
> lives in [docs/technical_specification.md](./docs/technical_specification.md).
> This library is under active scaffolding — the engine is delivered across the
> phases in [docs/development_plan.md](./docs/development_plan.md).

## Table of Contents

1. Project Overview
2. Architecture
3. Backend Patterns
4. Security Specification
5. Testing Strategy
6. Build and Publish
7. Common Pitfalls
8. Pre-Task Checklist
9. Guidelines Reference

## 1. Project Overview

`@bymax-one/nest-cache` encapsulates a singleton `ioredis` 5 connection behind a
typed NestJS module: typed `get<T>`/`set<T>`, automatic key namespacing, Pub/Sub
on namespaced channels, and a Lua script manager (`EVALSHA` + `NOSCRIPT`
fallback). It owns connection lifecycle, reconnection, graceful shutdown, and
propagates connection events via an `events.onEvent` callback. It reads no
environment variables — everything is supplied through DI. Published as a
public, MIT, zero-runtime-dependency package.

## 2. Architecture

- **Subpaths (2):** `.` (server — NestJS module + services) and `./shared`
  (zero-dependency types + constants).
- **Dynamic module:** `BymaxCacheModule.forRoot()` / `forRootAsync()` built on
  `ConfigurableModuleBuilder`, global by default via `setExtras` →
  `DynamicModule.global` (not a manual `@Global()` — see spec §0).
- **DI tokens (Symbol):** `BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`,
  `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`, `BYMAX_CACHE_SERIALIZER`,
  `BYMAX_CACHE_KEY_BUILDER`.
- **Core units:** `ConnectionManager` (singleton + lifecycle, standalone /
  sentinel / cluster), `CacheService` (typed API + namespacing), `PubSubService`,
  `ScriptManagerService`, plus `KeyBuilder` / `parseRedisUrl` / serializer utils.
- **Folder layout:**
  `src/server/{connection,services,config,interfaces,utils,errors,constants}` and
  `src/shared/{types,constants}`.

## 3. Backend Patterns

- `Symbol` injection tokens; **explicit `@Inject(TOKEN)`** on every provider and
  factory `inject: []` (tsup builds without `emitDecoratorMetadata`).
- Singletons only — no `Scope.REQUEST`. Connection lifecycle via `OnModuleInit` /
  `OnModuleDestroy`.
- Errors via `CacheException` + `CACHE_ERROR_CODES` (namespaced `cache.*`,
  append-only).
- Generics (`get<T>`, `set<T>`) with a pluggable `ISerializer`; keys always built
  through the key builder.
- Redis: offline queue disabled (fail fast), bounded `retryStrategy`,
  `reconnectOnError` on `READONLY` failover.

## 4. Security Specification

- **Key namespacing / tenant isolation** — never expose raw keys that bypass the
  builder.
- **Fail-closed deserialization** — malformed payloads throw, never return a
  partial value.
- **No secrets in `details` or events** — previews truncated.
- **Production flush guard** — `flushNamespace` disabled in prod without an
  explicit flag.
- **No untrusted input in Lua bodies.**

## 5. Testing Strategy

- TDD; **100% coverage** in both `jest.config.ts` and `jest.coverage.config.ts`.
- Unit tests mock Redis with `ioredis-mock`; E2E uses `@nestjs/testing` in
  `test/e2e/`.
- Mutation testing (Stryker, `break: 95`) is a manual release gate.
  `ignoreStatic: false` (exposes module-level constant mutants). Equivalent
  mutants are flagged inline with `// Stryker disable next-line` and a reason —
  only for genuine equivalents.

## 6. Build and Publish

- tsup → 2 subpaths, ESM + CJS + `.d.ts`/`.d.cts`, `sideEffects: false`, peers
  external. `minify: false` (readable backend bundle).
- `files` allowlist publishes only `dist` + metadata. `pnpm size` gate +
  `dogfood-smoke-test.mjs` before tagging. Release via OIDC provenance.

## 7. Common Pitfalls

- **Implicit DI** breaks after tsup — always `@Inject(TOKEN)`.
- **`getClient()` raw keys** bypass the namespace — only for advanced escape
  hatches, documented as an anti-pattern.
- **`KEYS`** blocks Redis in production — use `SCAN` cursors; batch with
  `pipeline()`.
- **BullMQ** needs `maxRetriesPerRequest: null` — it must create its own
  connection (`@bymax-one/nest-queue`), not reuse this one.

## 8. Pre-Task Checklist

1. Read the relevant section of `docs/technical_specification.md` and the matching
   `CACHE-xxx` task in `docs/development_tasks.md`.
2. TDD: write the failing `*.spec.ts` first; keep 100% coverage.
3. Run `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size`.

## 9. Guidelines Reference

- `docs/technical_specification.md` — full API, options, error catalog, Redis modes.
- `docs/development_plan.md` — phased build-out.
- `docs/development_tasks.md` — atomic `CACHE-xxx` tasks.
