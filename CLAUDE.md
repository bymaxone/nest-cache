# @bymax-one/nest-cache — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-cache` — typed Redis cache for NestJS based on ioredis 5, with namespace strategy, Pub/Sub and Lua script management
> **Runtime:** Node.js 24+ | Zero direct dependencies (functionality via peer deps)
> **Status:** scaffolding — the engine is built in phases per `docs/development_plan.md`.

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
- Mutation testing (Stryker `break: 95`) is the deeper gate. `ignoreStatic: false` (rigorous — exposes module-level constant mutants). Equivalent mutants are documented inline with `// Stryker disable next-line <Mutator>: <reason>` — acceptable for genuine equivalents only; minimize, and never disable a mutant a test could kill.

**8. Build** — tsup builds 2 subpaths → ESM (.mjs) + CJS (.cjs) + .d.ts. `sideEffects: false`. Peer deps (`@nestjs/*`, `ioredis`, `reflect-metadata`) always external.

---

## Subpaths

| Subpath      | Purpose                        | Peer Deps                            |
| ------------ | ------------------------------ | ------------------------------------ |
| `.` (server) | NestJS module + cache services | NestJS 11, ioredis, reflect-metadata |
| `./shared`   | Types + constants (zero deps)  | None                                 |

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size
```

Mutation testing (before tagging a release), under Node 24:

```bash
pnpm mutation             # full run; writes reports/mutation/mutation.html
pnpm mutation:incremental # faster re-run
```

Do **not** add mutation testing to `prepublishOnly` or the per-PR CI — it is a manual/release gate.

---

## Docs — Load Only What You Need

> The cache engine is built in phases. The authoritative design lives in `docs/`.

| Doc                               | Load when...                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `docs/technical_specification.md` | Understanding the API, options, error catalog, Redis modes |
| `docs/development_plan.md`        | Planning a phase / module                                  |
| `docs/development_tasks.md`       | Picking up a specific `CACHE-xxx` task                     |

For full architecture and patterns, see **[AGENTS.md](./AGENTS.md)**.
