---
applyTo: 'src/**/*.ts'
---

# TypeScript source code standards

## TypeScript compiler flags — practical implications

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`. Review impact:

- **`noUncheckedIndexedAccess`**: `array[0]` is `T | undefined`. Every index access must be guarded. Flag unguarded accesses.
- **`exactOptionalPropertyTypes`**: `{ prop?: string }` ≠ `{ prop: string | undefined }`. Flag conflation.
- **`noImplicitOverride`**: NestJS lifecycle hooks that override a parent must have `override`. Flag missing keyword.
- **`noImplicitReturns`**: every code path must return. Flag conditional fall-through.

## ESLint rules enforced as errors

- `no-explicit-any: error` — no `any` in source. Use `unknown`, generics (`get<T>`), or explicit types.
- `no-non-null-assertion: error` — never `!`. Narrow the type instead.
- `consistent-type-imports: error` — type-only imports must use `import type { ... }`.
- `explicit-function-return-type: error` — explicit return type on all functions.
- `explicit-module-boundary-types: error` — explicit types on all exported parameters.
- `import/no-cycle: error` — circular imports are forbidden.
- `no-restricted-imports: error` — `node:crypto` only; never `crypto` (bare), `bcrypt`, `argon2`, `uuid`, `nanoid`, `crypto-js`.

## Types and interfaces

- **`interface`** for DI ports/contracts that classes `implement` (`ISerializer`, `ICacheEvents`). The `I` prefix is reserved for these only.
- **`type`** for unions, intersections, mapped types, aliases (`CacheEventName`, `CacheErrorCode`, `CacheConnectionStatus`).

## NestJS patterns

- DI only — no `new ServiceClass()` outside tests.
- **Injection tokens must use `Symbol()`**, never string literals (string tokens cause silent collisions in multi-module apps). Example: `export const BYMAX_CACHE_OPTIONS = Symbol('BYMAX_CACHE_OPTIONS')`.
- Dynamic module requires both `forRoot(options)` and `forRootAsync({ useFactory, useClass, useExisting })`, built on `ConfigurableModuleBuilder`, global by default via `setExtras` → `DynamicModule.global` (not a manual `@Global()` — see spec §0).
- Singletons only — no `Scope.REQUEST`.
- Core logic depends only on interfaces (`ISerializer`, `ICacheEvents`) — never imports concrete implementations beyond the `ioredis` peer.
- `OnModuleInit` connects (unless `lazyConnect`); `OnModuleDestroy` tears the connection down gracefully (`quit()` with a shutdown timeout, then `disconnect()`).
- Unconfigured optional features (Pub/Sub, scripts) must not register providers in DI.

## Import ordering

`node:*` → external → internal (`@bymax-one/nest-cache`) → parent/sibling → index. Alphabetical within each group (enforced by `import/order`).

## Redis / ioredis patterns

- One singleton `ioredis` client owned by the connection manager — never instantiate `new Redis()` ad hoc in services.
- **Namespace every key** through the key builder; raw `getClient()` keys bypass tenant isolation and are an anti-pattern.
- `enableOfflineQueue: false` (fail fast); bounded `retryStrategy`; `reconnectOnError` only on `READONLY` failover.
- Lua scripts: register up front, run via `EVALSHA` with a `NOSCRIPT` fallback — never `EVAL` raw untrusted bodies.
- Use `SCAN` (cursors), never `KEYS` (blocks Redis); batch with `pipeline()`.

## Security

- Deserialization must fail closed — malformed input throws `CacheException(DESERIALIZATION_FAILED)`, never returns a partial or wrongly-typed value.
- Never put secret values in `CacheException` `details` or event payloads; truncate previews.
- Any secret/hash comparison must use `node:crypto` `timingSafeEqual` — never `===`.
- `flushNamespace` must be guarded against accidental production use.
