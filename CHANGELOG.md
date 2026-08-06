# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.5] — 2026-08-06

**Documentation, tests and E2E only.** `dist/` is byte-identical to `1.0.4`.

### Fixed

- The Redis Cluster E2E was flaky at roughly one run in three, failing with `CLUSTERDOWN` or
  "Too many Cluster redirections". The container log line proves `redis-cli --cluster create`
  printed its coverage message, but what the client needs is the state each node serves on the
  port the test dials. The helper now polls `CLUSTER INFO` on every node until all six report
  `cluster_state:ok` and full slot coverage. Six consecutive runs of the previously flaky spec
  pass, where it failed three times in nine before.

### Documentation

- The mutation badge said **100%**; the measured score is **99.78%**.

### Tests

- `findProvider` gained a spec of its own; it had only ever been exercised through the module
  suites, where either half of its disjunction covered for the other.

## [1.0.4] - 2026-08-04

### Security

- The Redis credentials are no longer disclosed when a service that holds the resolved
  options is serialized. The three connection shapes — `connection`, `sentinel` and
  `cluster` — move from plain fields on the resolved options to non-enumerable accessors,
  and `ConnectionManager` keeps its client and the driver options built from them, as does
  `PubSubService` with its subscriber, in ECMAScript private fields. A `url` carries the
  password inline, the discrete forms carry it as a field, and an ioredis instance carries
  `options.password` as a plain field, so `JSON.stringify`, object spread and
  `util.inspect` on any holder emitted it in plaintext — which is what a structured logger
  does when it renders a provider it was handed, and what an error reporter does when it
  captures the scope of a throw.

Reading on purpose is unchanged: `options.connection` resolves as before, and no public
type or export moved.

## [1.0.3] - 2026-08-01

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. Leaving
  the floor below a published advisory told a consumer that a vulnerable install
  was a supported one, and nothing in their tooling contradicted it — the install
  resolved cleanly and silently.

  Shipped as a patch, which is where a security fix belongs. A minor would have
  bought nothing: `^1.0.2` accepts `1.1.0` just as readily as `1.0.3`, so the same
  installs are affected either way. No runtime behaviour changed.

## [1.0.2] - 2026-07-29

### Fixed

- **The `./shared` subpath now resolves under `moduleResolution: node`.** A
  `typesVersions` map points the subpath at its `.d.cts` declarations, which is
  the only mechanism that resolution algorithm understands — it predates
  `exports` and ignores it entirely. Without this, a consumer whose tsconfig
  sets `module: commonjs` without an explicit `moduleResolution` (the default
  the Nest CLI scaffolds, which falls back to `node`) got
  `error TS2307: Cannot find module '@bymax-one/nest-cache/shared'` while the
  root entrypoint resolved fine. Runtime was never affected: Node reads
  `exports`, so `require('@bymax-one/nest-cache/shared')` always worked.

  This supersedes the note under 1.0.1 claiming the subpath was "not fixable
  without a directory shim" — that was wrong, `typesVersions` fixes it with no
  extra files in the tarball.

### Changed

- `check:exports` now runs the **strict** `attw` profile. The `--profile node16`
  escape hatch existed only to ignore the failing `node10` row, which no longer
  fails, so every entrypoint is now verified in every resolution mode.

## [1.0.1] - 2026-07-29

### Fixed

- **CommonJS consumers no longer receive ESM type declarations.** Both subpaths
  now declare `types` per condition, so `require()` resolves to the `.d.cts`
  declarations that match the `.cjs` runtime. Previously a single `types` entry
  pointed at the `.d.ts` files, which — with `"type": "module"` — TypeScript
  reads as ESM, so a project on `moduleResolution: node16` / `nodenext`
  importing from CommonJS got declarations for the wrong module format.
- Added top-level `main`, `module` and `types` so the root entrypoint also
  resolves under the legacy `moduleResolution: node` algorithm. The `./shared`
  subpath remains unresolvable in that mode, which is inherent to subpath
  exports and not fixable without a directory shim.
- Exposed `./package.json` through the `exports` map. Reading it previously
  failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, which breaks tooling that
  inspects an installed package's manifest.

### Added

- `pnpm check:exports` (`@arethetypeswrong/cli`) — packs the tarball and
  resolves every entrypoint the way each module resolution mode would. Wired
  into CI and into the release-shape gates, since the type-level API tests
  compile `src` and therefore cannot catch a broken `exports` map.

## [1.0.0] - 2026-07-29

### Added

- Initial public release of `@bymax-one/nest-cache`
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

[1.0.4]: https://github.com/bymaxone/nest-cache/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.0
