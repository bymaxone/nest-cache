# @bymax-one/nest-cache — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-cache` — typed Redis cache for NestJS based on ioredis 6, with namespace strategy, Pub/Sub and Lua script management
> **Runtime:** Node.js 24+ | Zero direct dependencies (functionality via peer deps)
> **Status:** v1.2.1 — 100% coverage, 100% mutation score. Adds the `./admin` subpath (read-only administration) and a security fix: the namespace is now rejected when it carries a Redis glob metacharacter, which previously reached `flushNamespace`'s destructive match pattern. See [docs/mutation_testing_results.md](./docs/mutation_testing_results.md).

---

## Critical Rules

**1. npm Library — Not an App** (uses pnpm)

- Zero direct dependencies (`"dependencies": {}`). Everything is `peerDependency` or `node:` builtin.
- Define interfaces (`ICacheEvents`, `ISerializer`, script definitions) — never import concrete third-party implementations beyond the `ioredis` peer.
- Export public API from `src/{subpath}/index.ts`. Use `export type` for interfaces/types, `export` for classes/constants.

**2. English Only**

- All code, comments, JSDoc, variable names, and docs in English. JSDoc on every public export.
- Library error codes are namespaced `cache.*` (see `CACHE_ERROR_CODES`).

**3. TypeScript — Zero `any`**

- Never `any` in production code. Use `unknown`, generics (`get<T>`, `set<T>`), or explicit types.
- `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — no exceptions.

**4. Security — Non-Negotiable**

- **Namespace every key** via the key builder — never expose raw `getClient()` keys that bypass namespacing (tenant isolation).
- **Deserialization fails closed** — malformed input throws `CacheException(DESERIALIZATION_FAILED)`, never returns a partial / wrongly-typed value.
- **Never log or echo secret values** — error `details` previews are truncated.
- `flushNamespace` is disabled in production unless an explicit flag is set (`FLUSH_DISABLED_IN_PRODUCTION`).
- Untrusted input must never reach Lua script bodies.

**5. NestJS Patterns**

- Injection tokens: `Symbol()` — never strings (`BYMAX_CACHE_*`).
- `@Inject(TOKEN)` must be explicit on every provider (tsup strips decorator metadata — implicit DI breaks in the published package).
- Dynamic module via `ConfigurableModuleBuilder` — `forRoot()` (sync) and `forRootAsync()` (async). Global by default.
- No `Scope.REQUEST` — connection and services are singletons. Lifecycle via `OnModuleInit` / `OnModuleDestroy`.

**6. Code Style**

- Single quotes, no semicolons, 2-space indent. kebab-case files, PascalCase classes.
- Import order: `node:` → external → internal → relative → types. One concern per file.

**7. Testing — TDD, 100% Coverage (hard gate)**

- Co-located unit tests (`*.spec.ts`). AAA pattern. Mock Redis with `ioredis-mock` — never a real connection in unit tests.
- E2E tests in `test/e2e/` using `@nestjs/testing`.
- **100% statements / branches / functions / lines** enforced by `jest.coverage.config.ts` (`pnpm test:cov:all`). A pre-publish gate, not a target.
- Mutation testing (Stryker `break: 100`) is the deeper gate. `ignoreStatic: false` (rigorous — exposes module-level constant mutants). Equivalent mutants are documented inline with `// Stryker disable next-line <Mutator>: <reason>` — acceptable for genuine equivalents only; minimize, and never disable a mutant a test could kill.

**8. Build** — tsup builds 3 subpaths → ESM (.mjs) + CJS (.cjs) + .d.ts. `sideEffects: false`. Peer deps (`@nestjs/*`, `ioredis`, `reflect-metadata`) always external.

---

## Subpaths

| Subpath      | Purpose                                           | Peer Deps                              |
| ------------ | ------------------------------------------------- | -------------------------------------- |
| `.` (server) | NestJS module + cache services                    | NestJS 11, ioredis 6, reflect-metadata |
| `./admin`    | Read-only administration (health, INFO, keyspace) | NestJS 11, ioredis 6, the server entry |
| `./shared`   | Types + constants (zero deps)                     | None                                   |

**`./admin` rules.** Privileged and deliberately separate — never fold it into `.`.
Its sources import the server surface by **package specifier** (`@bymax-one/nest-cache`),
never relatively: the tsup entry marks the package `external`, and a relative import would
inline a second copy of `CacheService` and the DI tokens, so `@Inject(CacheService)` would
name a different class object than `BymaxCacheModule` registered and DI would fail in the
published package. The subpath issues **no mutating Redis command** — enforced by
`pnpm check:admin-readonly`, not by convention. Scope patterns are restricted to a literal
prefix with at most one trailing `*` so key-membership is exact by construction; do not
relax this (a matcher more permissive than the server's is a silent cross-scope leak).

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm check:admin-readonly && pnpm test:cov:all && pnpm build && pnpm size && pnpm check:exports
```

Mutation testing (before tagging a release), under Node 24:

```bash
pnpm mutation             # incremental — re-tests only what changed; writes reports/mutation/mutation.html
pnpm mutation:full        # cold — deletes the baseline first, measures the truth
```

Mutation runs automatically **post-merge on `main`** via the shared reusable CI (`bymaxone/.github` → node-lib-ci) — never per-PR — and can also be run on demand with `pnpm mutation:full` before a release. Do **not** add it to `prepublishOnly` or the per-PR path.

---

## Documentation changes ship

**`README.md` and `CHANGELOG.md` are in `files`, so they are part of the published package.** A documentation fix that stays on `main` leaves the npm page — where people actually read it — still wrong. So a change to any shipped file gets a **patch release**, not a "next time" note:

- Bump the version and add the `## [x.y.z]` CHANGELOG section in the same pull request.
- State plainly that `dist/` is unchanged and **verify it** rather than asserting it: unpack the published tarball and diff it against a fresh build. "Documentation only" is a claim about the artifact, and the artifact is checkable.
- It is a **patch**. There is no feature, and a minor would reach exactly the same installs anyway.

Files outside `files` — `scripts/`, `.github/`, `docs/`, `CLAUDE.md`, config — do not ship and do not justify a release on their own.

---

## Docs — Load Only What You Need

> The cache engine is built in phases. The authoritative design lives in `docs/`.

| Doc                               | Load when...                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `docs/technical_specification.md` | Understanding the API, options, error catalog, Redis modes |
| `docs/development_plan.md`        | Planning a phase / module                                  |
| `docs/development_tasks.md`       | Picking up a specific `CACHE-xxx` task                     |

For full architecture and patterns, see **[AGENTS.md](./AGENTS.md)**.
