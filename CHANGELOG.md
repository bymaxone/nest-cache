# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-21

### Security

- **`validateOptions` now rejects a namespace containing a Redis glob metacharacter
  (`*`, `?`, `[`, `\`).** The namespace is this library's isolation boundary and it was
  composed unvalidated into `flushNamespace`'s destructive match pattern
  (`{namespace}{separator}*`), so a metacharacter changed which keys `UNLINK` reached.
  Measured against Redis 8.10.0, each one broke isolation differently: `*` and `?` **widen**
  the pattern (namespace `ten*ant` matches every other tenant's keys, turning a scoped flush
  into a cross-tenant delete); `\` **escapes** the next character (namespace `ten\ant`
  matches `tenant:*` — a different keyspace — while sparing its own keys); and `[` opens a
  character class that never closes, so the pattern matches **nothing** and `flushNamespace`
  removes none of the namespace's keys while returning `0`, which reads as a successful flush.
  Triggering it required a misconfigured namespace, so no default configuration was exposed;
  the case to worry about is a namespace derived from input, such as multi-tenant wiring using
  a tenant slug. `]` is deliberately still accepted — measured to be a literal that neither
  widens nor silences the pattern.
- An **empty `keySeparator`** now fails with its own message. It was already rejected, but by
  coincidence: the next guard is `namespace.includes(separator)` and `'anything'.includes('')`
  is `true` for every string, so it reported _"namespace contains key separator"_ — something
  the consumer had not done.

### Added

- **New subpath `@bymax-one/nest-cache/admin`** — a privileged, read-only administration
  surface: health, parsed `INFO` statistics, resolved configuration, keyspace listing, key
  inspection and value reveal. Kept out of the main entry deliberately: importing it is a
  greppable, reviewable act; a consumer who never wires it cannot resolve a reveal service
  from DI by accident and does not pay for it in the main bundle.
- `BymaxCacheAdminModule.forRoot()` / `.forRootAsync()`, `CacheStatusService`,
  `CacheAdminService`, and the scope model (`CacheScope`, `validateScopes`, `findScope`,
  `isKeyInScope`).
- New error codes: `cache.invalid_scope`, `cache.scope_not_found`, `cache.scope_not_readable`,
  `cache.key_not_in_scope`.
- `ResolvedOptions` and `DEFAULT_REDIS_PORT` are now exported from the main entry. The former
  is the shape stored under the already-exported `BYMAX_CACHE_OPTIONS` token, which previously
  had no public type.
- `pnpm check:admin-readonly` — a build gate that fails if the admin subpath declares a method
  named after a mutating Redis command, sends a non-allowlisted command through the `call`
  escape hatch, or imports `ioredis` as a value. Wired into `prepublishOnly`.

### Administration surface — shapes chosen deliberately

- **The application declares which keyspaces exist; the library validates and serves them.**
  A cache library cannot know that another library writes at Redis root through
  `getClient()`, and must not depend on that library to learn it.
- **`isReadable: false` withholds the value only.** Listing, types, TTLs and sizes stay
  available. A surface that renders an unreadable keyspace as empty tells an operator the
  region holds nothing when it is full — the same defect as a blank log page during an outage.
- **Scope patterns are restricted to a literal prefix with at most one trailing `*`.** A
  caller names a key, so the library must decide whether that key belongs to the named scope.
  Deciding that for arbitrary globs means reimplementing Redis's `stringmatchlen`, and a
  matcher even slightly _more_ permissive than the server's is a silent cross-scope leak that
  no happy-path test would show. With this shape, membership is exact by construction — and it
  is checked differentially against a real server in the E2E suite.
- **Health is three states and `latencyMs` cannot exist without a measurement.** The type is
  a union, so a handler that caught a throwing ping and returned a confident status does not
  compile. `mode` and `isScanSupported` sit outside the union: a cluster deployment that is
  down should still report that scanning was never going to work.
- **Every reading that would carry two meanings under one `null` is a union.**
  `maxmemory` is `unbounded | limited | unreported` (Redis spells "no ceiling" as
  `maxmemory:0`, which read literally draws a full saturation bar on the least constrained
  server there is); `TTL` is `expiring | persistent | missing` (`-1` and `-2` are different
  facts, and the key that expired mid-listing is the one an operator is watching);
  `aofEnabled` is nullable, because `false` for an absent field is a durability claim made
  without evidence.
- **`connection.url` is never on the wire.** The config payload carries host, port and a TLS
  flag; the URL and its password are never read into this subpath at all.
- **Sampled figures are named `sampledCount` / `sampledBytes`.** They are sums over a capped
  `SCAN`, not measurements of the keyspace. `isComplete` is the fact; the names are the guard,
  because a caller reaching for one does not necessarily read the other.
- **Pipeline batches are bounded in commands, not keys.** Redis is single-threaded, so a
  pipeline converts a network cost into a server-blocking one — describing N keys is two or
  three commands each, and one flush blocks every other client for the whole burst, on a
  server someone is inspecting precisely because it is unwell. Sizing is opt-in for the same
  reason.

### Internal

- Bundle-size budgets recalibrated: server `14.50` → `15.00` kB, admin added at `7.25` kB
  against a measured `6.60` kB. The admin entry marks `@bymax-one/nest-cache` **external** —
  bundling the server modules would give it its own copies of `CacheService` and the DI
  tokens, so `@Inject(CacheService)` in an admin provider would name a different class object
  than the one `BymaxCacheModule` registered and DI would fail at a consumer's runtime.
- E2E coverage for the admin subpath against a real Redis, asserting all twenty-four `INFO`
  field names the parser reads, real `MEMORY USAGE` sizing, and the differential scope-membership
  check. `ioredis-mock` supports none of those three (measured), so a unit suite alone could not
  have verified them.

## [1.1.0] - 2026-08-11

### Changed

- **BREAKING: peer dependency `ioredis` migrated `^5` → `^6`.** A consumer must move to
  ioredis 6, which aligns this package with `@bymax-one/nest-queue` so a single ioredis copy
  resolves across a workspace that uses both. ioredis 6 negotiates **RESP3** on the wire by
  default — the protocol changes at runtime — but its `'legacy'` reply mapping preserves every
  reply shape this cache relies on (GET/SET/TTL, EVALSHA, Pub/Sub message events, cluster and
  sentinel commands), so observable behaviour is unchanged; the only source change is the
  compile-time typing narrowing below. ioredis 6 requires Node.js ≥ 20, already covered by
  this package's `engines` (Node ≥ 24).

### Internal

- `ConnectionManager` narrows the options handed to the `Redis` and `Cluster` constructors
  to a local shape (`OwnedRedisOptions` / `OwnedClusterOptions`). ioredis 6's constructor
  overloads intersect `replyMapping` with a non-`undefined` variant to infer the
  reply-mapping generic, which makes a plain `RedisOptions`/`ClusterOptions` value
  unassignable under `exactOptionalPropertyTypes`. The narrowing drops only that `undefined`;
  the runtime object is untouched.
- Mutation gate tightened: Stryker `break`/`high`/`low` raised to **100** (the run is at
  100%, 0 survivors).

## [1.0.6] - 2026-08-06

### Fixed

- `ConnectionManager.onModuleInit()` assigned a freshly created client over the field
  unconditionally. When something had already opened the main client through
  `getClient()`, that first socket was left connected with no reference left to close it —
  `onModuleDestroy()` quits only the current client, so the abandoned one stayed in Redis's
  `CLIENT LIST` until its own timeout. Init now adopts an existing client instead of
  replacing it, and the assignment lives in one private accessor so no other path can
  strand a live connection.

  Reaching it takes touching the cache before the cache module's own init hook runs, which
  is possible in two ordinary shapes: NestJS orders `onModuleInit` by module depth, so a
  consumer module deeper in the graph runs first, and `app.get()` works between
  `NestFactory.create()` and `app.init()`. The ordinary boot path opened exactly one client
  before this change and still does.

## [1.0.5] - 2026-08-06

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

[1.2.0]: https://github.com/bymaxone/nest-cache/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/bymaxone/nest-cache/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-cache/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-cache/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/bymaxone/nest-cache/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.0
