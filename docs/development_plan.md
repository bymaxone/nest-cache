# Development Plan — @bymax-one/nest-cache

> **Version:** 2.0.0
> **Last updated:** 2026-05-30 (aligned to the Bymax lib standard — see spec §0)
> **Status:** Draft for execution
> **Reference spec:** [`docs/technical_specification.md`](./technical_specification.md)
> **Target engine:** ioredis 5.x (peer dep) over Node.js 24+
> **Derived document:** `docs/development_tasks.md` (Layer 3 — generated from this plan)

---

## Alignment with the Bymax Lib Standard (2026-05-30)

> This plan predates the cross-lib standards audit. Before executing, apply the **normative
> overrides in [`technical_specification.md`](./technical_specification.md) §0**:
> (1) dynamic module via `ConfigurableModuleBuilder` + `forRoot`/`forRootAsync` (not a manual module);
> (2) peer deps are **NOT** optional; (3) **six** DI tokens (+ `BYMAX_CACHE_SERIALIZER`,
> `BYMAX_CACHE_KEY_BUILDER`); (4) bundle budgets in **KiB brotli** (provisional); and
> (5) **no `.gitkeep`** files anywhere. Where a task below conflicts with §0, §0 wins.

---

## Table of Contents

1. [Plan Overview](#1-plan-overview)
2. [Phase 1 — Foundation + Connection Manager](#2-phase-1--foundation--connection-manager)
3. [Phase 2 — CacheService + Typed Helpers + Serializer](#3-phase-2--cacheservice--typed-helpers--serializer)
4. [Phase 3 — Pub/Sub + ScriptManager + Health Check](#4-phase-3--pubsub--scriptmanager--health-check)
5. [Phase 4 — forRootAsync + E2E + Mutation Baseline](#5-phase-4--forrootasync--e2e--mutation-baseline)
6. [Phase 5 — Release v0.1.0](#6-phase-5--release-v010)
7. [Appendix A — Dependency Graph](#appendix-a--dependency-graph)
8. [Appendix B — Complexity Matrix](#appendix-b--complexity-matrix)
9. [Appendix C — Reference Configs (mirror of nest-auth)](#appendix-c--reference-configs-mirror-of-nest-auth)
10. [Appendix D — Glossary and term mapping](#appendix-d--glossary-and-term-mapping)

---

## 1. Plan Overview

### 1.1 Development strategy

The implementation follows the **TDD red-green-refactor** protocol with vertically sliced phases:

- Each phase delivers **usable functionality** (not just "ready code") — at the end of each phase, the lib can be installed in a NestJS fixture app to exercise what was implemented
- **Tests precede implementation** in every file with non-trivial logic (services, utils, connection manager, key builder, serializers, script manager)
- **Per-phase coverage gate**: 80% minimum, 95% on critical paths (`ConnectionManager`, `KeyBuilder`, `parseRedisUrl`, `ScriptManagerService`, `CacheService`)
- **Mutation testing** runs as a **pre-release** gate only (not on per-commit CI — Stryker takes 10-20 min)
- **Refactor pass** at the end of each phase, with `/bymax-quality:code-review` before marking the phase as done

The phase order respects the dependency graph (Appendix A): contracts before implementations, dynamic module after services, advanced features (Pub/Sub, Lua) after a stable cache API.

### 1.2 Guiding principles

| Principle                                       | Practical application                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TS strict, zero `any`**                       | Compiler in `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Single exception documented: `eval()` return is `unknown` (Redis Lua scripts return dynamic types). |
| **JSDoc on every exported symbol**              | Every `export` of class, function, interface, constant carries JSDoc with `@example` when applicable.                                                                                     |
| **English in code and comments**                | Identifiers, internal messages, comments, JSDoc — all in English. Documentation (`docs/`) in English.                                                                                     |
| **Zero `dependencies`**                         | `package.json` ships `"dependencies": {}`. Everything via peer dep. `ioredis` is the only functional dep.                                                                                 |
| **Configuration over convention**               | Everything via `forRoot`/`forRootAsync`. Zero `process.env` read inside the lib.                                                                                                          |
| **Singleton by default**                        | One main command connection; subscriber created lazily on the first Pub/Sub call.                                                                                                         |
| **Correct lifecycle**                           | `OnModuleInit` connects (unless `lazyConnect`), `OnModuleDestroy` performs `quit()` with a configurable timeout.                                                                          |
| **Strict namespace**                            | Every key passes through `KeyBuilder.build(prefix, id)`. Raw strings only via the `getClient()` escape hatch.                                                                             |
| **Lua-first for atomicity**                     | Scripts registered via `IScriptDefinition`, executed via `EVALSHA` with automatic fallback on `NOSCRIPT`.                                                                                 |
| **Events callback instead of embedded logger**  | The connection emits events via `ICacheEvents.onEvent` — the consumer plugs in `@bymax-one/nest-logger` or another logger.                                                                |
| **Error code pattern `cache.<scope>_<reason>`** | Same `CACHE_ERROR_CODES` from spec §12; human messages tabulated in `CACHE_ERROR_MESSAGES`.                                                                                               |
| **Fail fast on offline**                        | `enableOfflineQueue: false` by default — we prefer an immediate error over OOM from silent buffering.                                                                                     |
| **Conventional Commits**                        | `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Drives the semver bump on release.                                                                                              |

### 1.3 Phase summary

| Phase | Content                                                                                                                                                                                                    | Sub-steps | Complexity |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| **1** | Foundation + Connection Manager (scaffold, types, shared subpath, interfaces, DI tokens, `parseRedisUrl`, `ConnectionManager` with lifecycle, `KeyBuilder`, `CacheException`, synchronous module skeleton) | 9         | MEDIUM     |
| **2** | `CacheService` + typed helpers (`get/set/setNx/del/exists/incr/decr/expire/ttl/mget/mset/keys/scan/hget/hset/sadd/srem`), `ISerializer` + `JsonSerializer`, `flushNamespace` with safety guard             | 8         | MEDIUM     |
| **3** | `PubSubService` (publish/subscribe/psubscribe lazy), `ScriptManagerService` (register/load/eval with NOSCRIPT fallback), health check (`isHealthy/ping/info`)                                              | 7         | MEDIUM     |
| **4** | `forRootAsync()`, integration of pre-registered scripts at bootstrap, E2E suite against Redis via `ioredis-mock` + Testcontainers, mutation baseline                                                       | 6         | HIGH       |
| **5** | README + CHANGELOG + SECURITY.md + CLAUDE.md + AGENTS.md + CI workflows + bundle budgets + tag + `pnpm publish --provenance`                                                                               | 7         | LOW        |
|       | **Total**                                                                                                                                                                                                  | **37**    | —          |

> **No time estimate** — this plan is intended for execution by AI agents. Duration in human days does not apply. Relative complexity per phase is documented above and detailed per sub-step in the [Complexity Matrix in Appendix B](#appendix-b--complexity-matrix). Use those signals to prioritize more careful human review on HIGH complexity phases.

### 1.4 Global per-phase Done criteria

A phase is only marked **Done** when, **cumulatively**:

- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm lint` passes without warnings (no `eslint-disable`)
- [ ] `pnpm test:cov` passes with coverage ≥ 80% global, ≥ 95% on the phase's critical paths
- [ ] `pnpm build` produces `dist/` with `.mjs`, `.cjs`, `.d.ts` for every declared subpath
- [ ] All sub-step acceptance criteria checked off
- [ ] JSDoc present on all new exports
- [ ] `git status` clean (commits made with Conventional Commits)
- [ ] `/bymax-quality:code-review` executed and findings applied

### 1.5 Expected end file structure (after Phase 5)

The `nest-cache/` repo root directory mirrors the template from EXTRACTION_ROADMAP §4 and the tree declared in spec §3.1:

```
nest-cache/
├── .github/workflows/      # ci.yml, codeql.yml, release.yml, scorecard.yml
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md          ← this file
│   ├── development_tasks.md         ← generated later
│   ├── mutation_testing_plan.md
│   └── mutation_testing_results.md
├── scripts/check-size.mjs
├── src/server/             # main entry — see §3.1 of the spec
├── src/shared/             # zero deps — types & constants
├── test/                   # e2e specs (ioredis-mock + Testcontainers)
├── package.json
├── tsup.config.ts
├── tsconfig.json (+ build / server / e2e / jest variants)
├── jest.config.ts (+ coverage / e2e / stryker variants)
├── stryker.config.json
├── eslint.config.mjs
├── README.md / CHANGELOG.md / SECURITY.md / LICENSE / CLAUDE.md / AGENTS.md
```

### 1.6 How this plan feeds `development_tasks.md`

Each numbered **sub-step** in this plan (§2.X, §3.X, etc.) becomes **one or more executable tasks** in `development_tasks.md`. The derivation rule:

- Sub-step with **a single file + logic < 100 LoC** → **1 task**
- Sub-step with **multiple related files** → **grouped task** with a per-file checklist
- Sub-step with **logic > 200 LoC** → **task split** into red (test), green (impl), refactor

The task carries the full prompt for AI agent execution (Role / Project / Preconditions / Required Reading / Task / Deliverables / Constraints / Verification / Completion Protocol — `/bymax-workflow:phase-tasks` standard).

---

## 2. Phase 1 — Foundation + Connection Manager

> **Phase objective:** Establish the full project scaffold, define public contracts (interfaces, types, constants, DI tokens), implement `ConnectionManager` with lifecycle (`OnModuleInit`/`OnModuleDestroy`, retry strategy, event listeners), `KeyBuilder`, `parseRedisUrl`, `CacheException` + error codes, and the synchronous `BymaxCacheModule.forRoot()` in its minimal version (no `CacheService` yet — just the manager and tokens). At the end of the phase, the lib can be installed in a NestJS fixture app and the Redis connection opens/closes correctly via `events.onEvent`.
>
> **Complexity:** MEDIUM.
>
> **Critical paths for 95% coverage:** `src/server/connection/connection.manager.ts`, `src/server/utils/parse-redis-url.ts`, `src/server/utils/key-builder.ts`, `src/server/config/resolved-options.ts`.

### 2.1 Project scaffold

**Objective:** Create the folder structure, configuration files and base dependencies, mirroring the `EXTRACTION_ROADMAP.md` §3 template and the canonical `nest-auth` configs.

**Files to create:**

```
nest-cache/
├── .gitignore
├── .prettierrc
├── .npmignore
├── eslint.config.mjs
├── jest.config.ts
├── jest.coverage.config.ts
├── jest.e2e.config.ts
├── jest.stryker.config.ts
├── stryker.config.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.server.json
├── tsconfig.e2e.json
├── tsconfig.jest.json
├── tsup.config.ts
├── package.json
├── scripts/check-size.mjs
├── src/server/index.ts          # empty at this step — structure only
├── src/shared/index.ts          # empty at this step
└── test/e2e/                    # e2e specs land here in Phase 4 (no .gitkeep — see spec §0)
```

**Reference content:**

Copy from `/Users/maximiliano/Documents/MyApps/nest-auth/` and adapt (replace `nest-auth` with `nest-cache`):

| Source (nest-auth)        | Destination (nest-cache)  | Adaptation                                                                                                |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`           | `tsconfig.json`           | Swap path aliases: 2 subpaths instead of 5 (`@bymax-one/nest-cache`, `@bymax-one/nest-cache/shared`)      |
| `tsconfig.build.json`     | `tsconfig.build.json`     | Identical (extends tsconfig.json, excludes `**/*.spec.ts`, `test/`)                                       |
| `tsconfig.server.json`    | `tsconfig.server.json`    | `include: ['src/server/**/*']`                                                                            |
| `tsconfig.e2e.json`       | `tsconfig.e2e.json`       | Includes `test/`; more permissive on e2e helpers                                                          |
| `tsconfig.jest.json`      | `tsconfig.jest.json`      | Identical                                                                                                 |
| `jest.config.ts`          | `jest.config.ts`          | Swap `moduleNameMapper` to 2 subpaths; coverage threshold 80/95 for critical paths (see §2.9)             |
| `jest.coverage.config.ts` | `jest.coverage.config.ts` | Threshold 100% global (release gate) — see §6.5                                                           |
| `jest.e2e.config.ts`      | `jest.e2e.config.ts`      | `rootDir 'test'`                                                                                          |
| `jest.stryker.config.ts`  | `jest.stryker.config.ts`  | Identical                                                                                                 |
| `stryker.config.json`     | `stryker.config.json`     | Swap `tsconfig.json`, keep `tempDirName`; thresholds: high 95, low 85, break 85                           |
| `tsup.config.ts`          | `tsup.config.ts`          | **Rewrite** — 2 entries (`server`, `shared`); externals: peer deps from package.json (see §2.1.3 below)   |
| `eslint.config.mjs`       | `eslint.config.mjs`       | Copy; remove rules specific to `oauth/`, `crypto/`; keep `eslint-plugin-security`, `eslint-plugin-import` |
| `.prettierrc`             | `.prettierrc`             | Identical                                                                                                 |
| `.gitignore`              | `.gitignore`              | Identical                                                                                                 |
| `scripts/check-size.mjs`  | `scripts/check-size.mjs`  | **Rewrite** — 2 entries: `server` budget 18_000 brotli, `shared` budget 2_500 brotli (see §6.5)           |

**Detail — `package.json` for this phase:**

```json
{
  "name": "@bymax-one/nest-cache",
  "version": "0.1.0-alpha.0",
  "description": "Typed Redis cache for NestJS based on ioredis 5, with namespace strategy, Pub/Sub and Lua script management.",
  "author": "Bymax One <support@bymax.one>",
  "license": "MIT",
  "homepage": "https://github.com/bymaxone/nest-cache#readme",
  "repository": { "type": "git", "url": "https://github.com/bymaxone/nest-cache.git" },
  "bugs": { "url": "https://github.com/bymaxone/nest-cache/issues" },
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    }
  },
  "scripts": {
    "build": "pnpm clean && tsup",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.ts",
    "test:all": "pnpm test && pnpm test:e2e",
    "test:cov:all": "jest --config jest.coverage.config.ts --coverage",
    "mutation": "stryker run",
    "mutation:incremental": "stryker run --incremental",
    "mutation:dry-run": "stryker run --dryRunOnly",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
    "size": "node scripts/check-size.mjs",
    "clean": "rm -rf dist coverage",
    "prepublishOnly": "pnpm clean && pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build",
    "release": "pnpm publish --provenance"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "ioredis": "^5.0.0",
    "reflect-metadata": "^0.2.0"
  },
  "peerDependenciesMeta": {
    "@nestjs/common": { "optional": true },
    "@nestjs/core": { "optional": true },
    "reflect-metadata": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11.1.20",
    "@nestjs/core": "^11.1.20",
    "@nestjs/platform-express": "^11.1.20",
    "@nestjs/testing": "^11.1.20",
    "@stryker-mutator/core": "^9",
    "@stryker-mutator/jest-runner": "^9",
    "@stryker-mutator/typescript-checker": "^9",
    "@testcontainers/redis": "^10.30.0",
    "@types/express": "^5.0.6",
    "@types/jest": "^30.0.0",
    "@types/node": "^25.7.0",
    "@typescript-eslint/eslint-plugin": "^8.59.3",
    "@typescript-eslint/parser": "^8.59.3",
    "eslint": "^9.39.4",
    "eslint-config-prettier": "^10.1.8",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import": "^2.32.0",
    "eslint-plugin-prettier": "^5.5.5",
    "eslint-plugin-security": "^4.0.0",
    "ioredis": "^5.4.1",
    "ioredis-mock": "^8.9.0",
    "jest": "^30.4.2",
    "prettier": "^3.8.3",
    "reflect-metadata": "^0.2.2",
    "testcontainers": "^10.30.0",
    "ts-jest": "^29.4.9",
    "ts-node": "^10.9.2",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  },
  "packageManager": "pnpm@10.8.1",
  "engines": { "node": ">=24.0.0" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

**Detail — `tsup.config.ts`:**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  // Server entry (main) — Node.js + NestJS
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: [/^@nestjs\//, 'reflect-metadata', 'ioredis'],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Shared entry — types + constants (zero deps)
  {
    entry: { 'shared/index': 'src/shared/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  }
])
```

**Acceptance criteria:**

- [ ] Directory structure created per the tree above
- [ ] `package.json` with all scripts, peer deps and devDeps listed
- [ ] `tsconfig.json` inherits strict settings from nest-auth (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [ ] `tsup.config.ts` configured with 2 entries
- [ ] `eslint.config.mjs` in flat config v9 functional (zero warnings on empty folder)
- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes on empty `src/server/index.ts` and `src/shared/index.ts` (placeholder comment only)
- [ ] `pnpm lint` passes without warnings
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}` even with empty source

**Validation commands:**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
ls -la dist/server/  # confirms .mjs, .cjs, .d.ts
ls -la dist/shared/
```

**Dependencies:** In the prior sub-step. This is the phase entry point.

**Risks/Notes:**

- ⚠️ `pnpm@10.8.1` is a requirement; using a different version can break lockfile resolution
- ⚠️ Node 24 LTS is the minimum (aligned with the rest of the portfolio)
- ⚠️ `ioredis` 5.x is a peer dep; pin to `^5.4.1` in devDependencies to guarantee deterministic tests
- ⚠️ `ioredis-mock` 8.x is compatible with `ioredis` 5.x; **do not** upgrade without checking the matrix

### 2.2 Shared types and constants (`src/shared/`)

**Objective:** Define public types and constants with in the NestJS dependencies. These modules can be imported in any context (CLI, frontend, scripts) without bringing overhead.

**Files to create:**

```
src/shared/
├── types/
│   ├── cache-event.types.ts
│   ├── cache-config.types.ts
│   └── serializable-value.types.ts
├── constants/
│   ├── error-codes.ts
│   └── event-names.ts
└── index.ts
```

**Skeleton — `src/shared/types/cache-event.types.ts`:**

```typescript
/**
 * Lifecycle events emitted by the underlying ioredis connection.
 *
 * @see Spec §11.2 — ICacheEvents interface
 */
export type CacheEventName = 'connect' | 'ready' | 'error' | 'close' | 'reconnecting' | 'end'

/**
 * Snapshot of the connection state. Useful for health endpoints and metrics.
 */
export type CacheConnectionStatus =
  | 'wait'
  | 'connecting'
  | 'connect'
  | 'ready'
  | 'reconnecting'
  | 'end'
```

**Skeleton — `src/shared/types/cache-config.types.ts`:**

```typescript
/**
 * Logical namespace applied to every key built via KeyBuilder.
 * Conventionally a short string like 'app', 'auth', 'fitness'.
 */
export type CacheNamespace = string

/**
 * Domain prefix that segments a namespace into resource groups.
 *
 * @example
 *   'users'      // → app:users:{id}
 *   'rl'         // → app:rl:{userId}
 *   'sessions'   // → app:sessions:{sid}
 */
export type CacheKeyPrefix = string
```

**Skeleton — `src/shared/types/serializable-value.types.ts`:**

```typescript
/**
 * Closed recursive type representing what the default JsonSerializer can
 * roundtrip without information loss.
 *
 * Note: `Date`, `Map`, `Set`, `BigInt`, `undefined` are NOT included —
 * those require a custom ISerializer implementation (MsgPack, CBOR, etc.).
 *
 * `get<T>` / `set<T>` do NOT constrain T to this type — clients may pass
 * arbitrary `T` when using a custom serializer. The type exists as
 * documentation and as an opt-in constraint for strict consumers.
 */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue }
```

**Skeleton — `src/shared/constants/error-codes.ts`:**

```typescript
/**
 * Stable error codes emitted by CacheException.
 * Mirrored in src/server/errors/cache-error-codes.ts for runtime use.
 *
 * Format: `cache.<scope>_<reason>` — scope identifies the subsystem,
 * reason is a verb_object snake_case slug.
 *
 * @see Spec §12.2 — Code Table
 */
export const CACHE_ERROR_CODES = {
  CONNECTION_FAILED: 'cache.connection_failed',
  COMMAND_TIMEOUT: 'cache.command_timeout',
  CONNECTION_LOST: 'cache.connection_lost',
  SERIALIZATION_FAILED: 'cache.serialization_failed',
  DESERIALIZATION_FAILED: 'cache.deserialization_failed',
  INVALID_NAMESPACE: 'cache.invalid_namespace',
  INVALID_KEY: 'cache.invalid_key',
  SCRIPT_NOT_REGISTERED: 'cache.script_not_registered',
  SCRIPT_EXECUTION_FAILED: 'cache.script_execution_failed',
  SCRIPT_REGISTRY_MISSING: 'cache.script_registry_missing',
  FLUSH_DISABLED_IN_PRODUCTION: 'cache.flush_disabled_in_production',
  CLUSTER_MISCONFIGURED: 'cache.cluster_misconfigured',
  SENTINEL_MISCONFIGURED: 'cache.sentinel_misconfigured',
  SHUTDOWN_TIMEOUT: 'cache.shutdown_timeout'
} as const

export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[keyof typeof CACHE_ERROR_CODES]
```

**Skeleton — `src/shared/constants/event-names.ts`:**

```typescript
/**
 * Canonical names of cache lifecycle events. Mirrors CacheEventName type.
 * Useful when matching against event strings in switch/case dispatch.
 */
export const CACHE_EVENT_NAMES = {
  CONNECT: 'connect',
  READY: 'ready',
  ERROR: 'error',
  CLOSE: 'close',
  RECONNECTING: 'reconnecting',
  END: 'end'
} as const
```

**Skeleton — `src/shared/index.ts`:**

```typescript
// Types
export type { CacheEventName, CacheConnectionStatus } from './types/cache-event.types'
export type { CacheNamespace, CacheKeyPrefix } from './types/cache-config.types'
export type { SerializableValue } from './types/serializable-value.types'

// Constants
export { CACHE_ERROR_CODES } from './constants/error-codes'
export type { CacheErrorCode } from './constants/error-codes'
export { CACHE_EVENT_NAMES } from './constants/event-names'
```

**Acceptance criteria:**

- [ ] All files created per the tree
- [ ] JSDoc present on each export (verifiable via `tsc --emitDeclarationOnly` which includes comments)
- [ ] `pnpm build` generates `dist/shared/index.d.ts` listing all exports
- [ ] `pnpm typecheck` passes
- [ ] Bundle `dist/shared/index.mjs` < 2.5 KB brotli (validate with `pnpm size` in §2.9)
- [ ] Subpath `import('@bymax-one/nest-cache/shared')` resolves correctly in consumer fixture

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m).sort()))"
# Expected: [ 'CACHE_ERROR_CODES', 'CACHE_EVENT_NAMES' ]
```

**Dependencies:** §2.1 complete.

**Risks/Notes:**

- ⚠️ `import type` is mandatory for types — avoids inclusion in the JS bundle
- ⚠️ Constants must be `as const` to preserve literal types in `dist/.d.ts`
- ⚠️ Do not add logic in `shared/` — only pure types and constants

### 2.3 Interfaces and contracts (`src/server/interfaces/`)

**Objective:** Define every public interface the consumer can implement or reference — `BymaxCacheModuleOptions`, `BymaxCacheModuleAsyncOptions`, `ICacheEvents`, `ISerializer`, `IScriptDefinition`, `IPubSubHandler`.

**Files to create:**

```
src/server/interfaces/
├── cache-module-options.interface.ts
├── cache-events.interface.ts
├── serializer.interface.ts
├── script-definition.interface.ts
├── pubsub-handler.interface.ts
└── index.ts
```

**Skeleton — `src/server/interfaces/cache-module-options.interface.ts`:**

```typescript
import type { ClusterNode, ClusterOptions, SentinelAddress, RedisOptions } from 'ioredis'
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import type {
  DynamicModule,
  ForwardReference,
  InjectionToken,
  OptionalFactoryDependency,
  Type
} from '@nestjs/common'
import type { ICacheEvents } from './cache-events.interface'
import type { ISerializer } from './serializer.interface'
import type { IScriptDefinition } from './script-definition.interface'

/**
 * Standalone (single-node) connection settings.
 *
 * Either `url` OR `host`+`port` is required. When both are present,
 * `url` has priority — discrete fields act as fallback.
 */
export interface BymaxCacheStandaloneConnection {
  /** redis:// or rediss:// (TLS) URL — overrides discrete fields. */
  url?: string
  host?: string
  port?: number
  password?: string
  db?: number
  username?: string
  tls?: TlsConnectionOptions
  /** Default: false (connects on OnModuleInit). */
  lazyConnect?: boolean
  /** Default: 10_000 ms. */
  connectTimeout?: number
  /** Default: 5_000 ms. */
  commandTimeout?: number
  /** Default: 3. Do NOT pass null here — that value is BullMQ-specific. */
  maxRetriesPerRequest?: number
  /** Default: true. */
  enableReadyCheck?: boolean
  /** Default: false — fail fast instead of queueing. */
  enableOfflineQueue?: boolean
  /** Default: `(times) => Math.min(times * 50, 2000)`. */
  retryStrategy?: (times: number) => number | null | void
  /** Default: reconnects only on 'READONLY' (replica failover). */
  reconnectOnError?: (err: Error) => boolean | 1 | 2
  keepAlive?: number
  noDelay?: boolean
  family?: 4 | 6
}

/** Sentinel-mode connection settings. Required when mode === 'sentinel'. */
export interface BymaxCacheSentinelConnection {
  sentinels: SentinelAddress[]
  name: string
  sentinelPassword?: string
  password?: string
  role?: 'master' | 'slave'
}

/** Cluster-mode connection settings. Required when mode === 'cluster'. */
export interface BymaxCacheClusterConnection {
  nodes: ClusterNode[]
  options?: ClusterOptions
}

/**
 * Synchronous configuration for BymaxCacheModule.forRoot().
 * See `docs/technical_specification.md` §4 for full semantics.
 */
export interface BymaxCacheModuleOptions {
  /** Connection mode. Default: 'standalone'. */
  mode?: 'standalone' | 'sentinel' | 'cluster'
  connection?: BymaxCacheStandaloneConnection
  sentinel?: BymaxCacheSentinelConnection
  cluster?: BymaxCacheClusterConnection
  /** Global namespace prefix applied to every key. Default: 'app'. */
  namespace?: string
  /** Separator used between namespace/prefix/id segments. Default: ':'. */
  keySeparator?: string
  /** Custom serializer. Default: JsonSerializer. */
  serializer?: ISerializer
  /** Connection lifecycle event hooks (plug logger here). */
  events?: ICacheEvents
  /** Graceful shutdown timeout in ms. Default: 5000. */
  shutdownTimeoutMs?: number
  /**
   * Allows flushNamespace() to run even when NODE_ENV === 'production'.
   * Default: false. SAFETY: leave false in real prod environments.
   */
  allowFlushInProduction?: boolean
  /** Register module as @Global(). Default: true. */
  isGlobal?: boolean
  /** Lua scripts pre-registered at module init. */
  scripts?: readonly IScriptDefinition[]
}

/**
 * Async configuration for BymaxCacheModule.forRootAsync().
 * Standard NestJS dynamic module async options shape.
 */
export interface BymaxCacheModuleAsyncOptions {
  imports?: Array<Type | DynamicModule | ForwardReference>
  inject?: Array<InjectionToken | OptionalFactoryDependency>
  useFactory: (...args: unknown[]) => Promise<BymaxCacheModuleOptions> | BymaxCacheModuleOptions
  isGlobal?: boolean
}

/** Re-export ioredis types for consumer convenience. */
export type { ClusterNode, ClusterOptions, RedisOptions, SentinelAddress }
```

**Skeleton — `src/server/interfaces/cache-events.interface.ts`:**

```typescript
import type { CacheEventName } from '../../shared/types/cache-event.types'

/**
 * Plug-in for connection lifecycle observation. Implementations may
 * forward events to a logger, metrics backend, alerting system, etc.
 *
 * Callbacks MUST be fast and non-blocking — exceptions thrown are caught
 * by ConnectionManager and swallowed (best-effort observability).
 */
export interface ICacheEvents {
  onEvent?: (event: CacheEventName, data: Record<string, unknown>) => void
}
```

**Skeleton — `src/server/interfaces/serializer.interface.ts`:**

```typescript
/**
 * Strategy interface for serializing/deserializing cache values.
 *
 * Implementations MUST be deterministic and MUST throw on malformed input
 * during deserialize (never return undefined or partial values —
 * CacheService catches and wraps as CacheException).
 */
export interface ISerializer {
  serialize<T>(value: T): string
  deserialize<T>(raw: string): T
}
```

**Skeleton — `src/server/interfaces/script-definition.interface.ts`:**

```typescript
/**
 * Definition of a Lua script registered with ScriptManagerService.
 *
 * Scripts are loaded into Redis via SCRIPT LOAD at module init and
 * invoked by name via CacheService.eval(name, keys, args). The library
 * caches the SHA1 and uses EVALSHA — on NOSCRIPT error (FLUSHALL or
 * server restart) it transparently re-loads and retries.
 */
export interface IScriptDefinition {
  name: string
  lua: string
}
```

**Skeleton — `src/server/interfaces/pubsub-handler.interface.ts`:**

```typescript
/** Handler signature for PubSubService.subscribe<T>(). */
export interface IPubSubHandler<T> {
  (message: T): Promise<void> | void
}

/** Handler signature for PubSubService.psubscribe<T>(). */
export interface IPubSubPatternHandler<T> {
  (channel: string, message: T): Promise<void> | void
}
```

**Skeleton — `src/server/interfaces/index.ts`:**

```typescript
export type {
  BymaxCacheModuleOptions,
  BymaxCacheModuleAsyncOptions,
  BymaxCacheStandaloneConnection,
  BymaxCacheSentinelConnection,
  BymaxCacheClusterConnection,
  ClusterNode,
  ClusterOptions,
  RedisOptions,
  SentinelAddress
} from './cache-module-options.interface'
export type { ICacheEvents } from './cache-events.interface'
export type { ISerializer } from './serializer.interface'
export type { IScriptDefinition } from './script-definition.interface'
export type { IPubSubHandler, IPubSubPatternHandler } from './pubsub-handler.interface'
```

**Acceptance criteria:**

- [ ] All interfaces created with full JSDoc
- [ ] `readonly` on immutable properties (consistent with `exactOptionalPropertyTypes`)
- [ ] `BymaxCacheModuleAsyncOptions` follows the official NestJS async dynamic module pattern
- [ ] `pnpm typecheck` passes
- [ ] In the `any` in any signature
- [ ] Re-exports of ioredis types (`ClusterNode`, `RedisOptions`, etc.) accessible by the consumer

**Validation commands:**

```bash
pnpm typecheck
grep -n ': any\b\|any\[\]' src/server/interfaces/  # expected: in the match
```

**Dependencies:** §2.2 (shared types).

**Risks/Notes:**

- ⚠️ Do not export these interfaces directly from `src/server/index.ts` yet — wait for Phase 1 to complete (§2.9 handles this)
- ⚠️ `BymaxCacheStandaloneConnection.maxRetriesPerRequest` is `number` (not `number | null`) intentionally — `null` is reserved for BullMQ and must not appear here
- ⚠️ Keep `BymaxCacheModuleOptions` separate from `BymaxCacheModuleAsyncOptions` (do not merge into a union)

### 2.4 Internal constants and DI tokens

**Objective:** Define the injection tokens (`Symbol()`), numeric defaults, and user-facing error messages.

**Files to create:**

```
src/server/
├── bymax-cache.constants.ts          # Injection tokens
├── constants/
│   ├── default-namespace.ts
│   └── default-timeouts.ts
└── errors/
    ├── cache-error-codes.ts          # Codes + messages
    └── cache-exception.ts            # HttpException class
```

**Skeleton — `src/server/bymax-cache.constants.ts`:**

```typescript
/**
 * Dependency injection tokens.
 *
 * Symbols are used instead of strings to avoid collision with tokens from
 * other libraries. Pattern inherited from @bymax-one/nest-auth.
 *
 * @see Spec §4.4 — Injection Tokens
 */
export const BYMAX_CACHE_OPTIONS = Symbol('BYMAX_CACHE_OPTIONS')
export const BYMAX_CACHE_CONNECTION = Symbol('BYMAX_CACHE_CONNECTION')
export const BYMAX_CACHE_SCRIPT_REGISTRY = Symbol('BYMAX_CACHE_SCRIPT_REGISTRY')
export const BYMAX_CACHE_EVENTS = Symbol('BYMAX_CACHE_EVENTS')
export const BYMAX_CACHE_SERIALIZER = Symbol('BYMAX_CACHE_SERIALIZER')
export const BYMAX_CACHE_KEY_BUILDER = Symbol('BYMAX_CACHE_KEY_BUILDER')
```

**Skeleton — `src/server/constants/default-namespace.ts`:**

```typescript
/** Default global namespace when consumer does not override. */
export const DEFAULT_NAMESPACE = 'app' as const

/** Default separator between namespace/prefix/id segments. */
export const DEFAULT_KEY_SEPARATOR = ':' as const
```

**Skeleton — `src/server/constants/default-timeouts.ts`:**

```typescript
/** Defaults applied by ConnectionManager when option is omitted. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
export const DEFAULT_COMMAND_TIMEOUT_MS = 5_000
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
export const DEFAULT_MAX_RETRIES_PER_REQUEST = 3

/** Lower bound for shutdownTimeoutMs validation (ms). */
export const MIN_SHUTDOWN_TIMEOUT_MS = 100
/** Lower bound for connectTimeout validation (ms). */
export const MIN_CONNECT_TIMEOUT_MS = 100
```

**Skeleton — `src/server/errors/cache-error-codes.ts`:**

```typescript
import { CACHE_ERROR_CODES, type CacheErrorCode } from '../../shared/constants/error-codes'

/** Re-export for backward compatibility with consumers importing from server entry. */
export { CACHE_ERROR_CODES }
export type { CacheErrorCode }

/**
 * Default English messages mapped from error codes.
 * Consumer apps MAY localize by overriding via i18n layer downstream.
 *
 * @see Spec §12.2 — when each code is thrown
 */
export const CACHE_ERROR_MESSAGES: Record<CacheErrorCode, string> = {
  [CACHE_ERROR_CODES.CONNECTION_FAILED]: 'Failed to connect to Redis after retries',
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT]: 'Redis command exceeded configured timeout',
  [CACHE_ERROR_CODES.CONNECTION_LOST]: 'Redis connection closed during operation',
  [CACHE_ERROR_CODES.SERIALIZATION_FAILED]: 'Failed to serialize value',
  [CACHE_ERROR_CODES.DESERIALIZATION_FAILED]: 'Failed to deserialize cached value',
  [CACHE_ERROR_CODES.INVALID_NAMESPACE]: 'Cache namespace is invalid (empty or contains separator)',
  [CACHE_ERROR_CODES.INVALID_KEY]: 'Cache key segment is empty',
  [CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED]: 'Lua script is not registered',
  [CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED]: 'Lua script execution returned an error',
  [CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING]:
    'No script registry available — register scripts via forRoot.scripts',
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION]: 'flushNamespace() is disabled in production',
  [CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED]: 'Cluster mode requires cluster.nodes',
  [CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED]:
    'Sentinel mode requires sentinel.sentinels and sentinel.name',
  [CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT]: 'Connection quit() exceeded shutdownTimeoutMs'
}
```

**Skeleton — `src/server/errors/cache-exception.ts`:**

```typescript
import { HttpException, HttpStatus } from '@nestjs/common'
import { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES, type CacheErrorCode } from './cache-error-codes'

/** Maps each error code to a default HTTP status. */
const STATUS_BY_CODE: Record<CacheErrorCode, HttpStatus> = {
  [CACHE_ERROR_CODES.CONNECTION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,
  [CACHE_ERROR_CODES.CONNECTION_LOST]: HttpStatus.SERVICE_UNAVAILABLE,
  [CACHE_ERROR_CODES.SERIALIZATION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.DESERIALIZATION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.INVALID_NAMESPACE]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.INVALID_KEY]: HttpStatus.BAD_REQUEST,
  [CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION]: HttpStatus.FORBIDDEN,
  [CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT]: HttpStatus.INTERNAL_SERVER_ERROR
}

/**
 * Domain exception for all cache-related failures.
 *
 * Wraps an HttpException so NestJS exception filters render the payload
 * automatically. Payload shape is `{ error: { code, message, details } }`.
 *
 * @example
 *   throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, { namespace: '' })
 */
export class CacheException extends HttpException {
  readonly code: CacheErrorCode
  readonly details: Record<string, unknown> | null

  constructor(
    code: CacheErrorCode,
    details?: Record<string, unknown>,
    overrideStatus?: HttpStatus
  ) {
    const status = overrideStatus ?? STATUS_BY_CODE[code]
    const message = CACHE_ERROR_MESSAGES[code]
    super({ error: { code, message, details: details ?? null } }, status)
    this.code = code
    this.details = details ?? null
  }
}
```

**Acceptance criteria:**

- [ ] Unique Symbols (verifiable: `BYMAX_CACHE_OPTIONS === BYMAX_CACHE_OPTIONS` true; cross-token equality false)
- [ ] `CACHE_ERROR_MESSAGES[code]` covers 100% of enum codes
- [ ] `CacheException.code` and `.details` accessible without cast
- [ ] Correct HttpStatus per code (verifiable via tests in §2.9)
- [ ] `pnpm typecheck` passes
- [ ] `instanceof CacheException` returns true in catch blocks

**Validation commands:**

```bash
pnpm typecheck
pnpm test src/server/errors/cache-exception.spec.ts
```

**Dependencies:** §2.2 (shared error codes).

**Risks/Notes:**

- ⚠️ `HttpException` imported from `@nestjs/common` — peer dep, marked external in tsup
- ⚠️ Do not confuse `code` (string slug `cache.xxx_yyy`) with HTTP status (number)

### 2.5 `parseRedisUrl` utility

**Objective:** Parse `redis://` and `rediss://` (TLS) URLs into `Partial<RedisOptions>`. URL takes precedence over discrete fields when both are provided.

**Files to create:**

```
src/server/utils/parse-redis-url.ts
```

**Skeleton:**

```typescript
import type { RedisOptions } from 'ioredis'

/**
 * Parses a Redis connection URL into ioredis RedisOptions.
 *
 * Supports:
 *   - redis://             (plain TCP)
 *   - rediss://            (TLS — enables tls: {})
 *   - redis://user:pass@host:port/db
 *
 * Returns Partial — discrete connection fields act as fallback when set.
 *
 * @throws Error if URL is malformed or protocol is unsupported
 *
 * @example
 *   parseRedisUrl('rediss://default:secret@redis.example.com:6380/2')
 *   // → { host: 'redis.example.com', port: 6380, password: 'secret',
 *   //     username: 'default', db: 2, tls: {} }
 */
export function parseRedisUrl(url: string): Partial<RedisOptions> {
  const parsed = new URL(url)

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis protocol: ${parsed.protocol}`)
  }

  const result: Partial<RedisOptions> = {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379
  }

  if (parsed.username) result.username = decodeURIComponent(parsed.username)
  if (parsed.password) result.password = decodeURIComponent(parsed.password)

  const dbSegment = parsed.pathname.replace(/^\//, '')
  if (dbSegment && /^\d+$/.test(dbSegment)) {
    result.db = Number.parseInt(dbSegment, 10)
  }

  if (parsed.protocol === 'rediss:') {
    result.tls = {}
  }

  return result
}
```

**Acceptance criteria:**

- [ ] `parseRedisUrl('redis://localhost:6379')` returns `{ host: 'localhost', port: 6379 }`
- [ ] `parseRedisUrl('rediss://...')` includes `tls: {}`
- [ ] User + password decoded when URL-encoded (e.g.: `redis://user%40domain:p%40ss@host`)
- [ ] Database extracted from pathname (e.g.: `redis://host/3` → `db: 3`)
- [ ] Malformed URL throws Error
- [ ] Unsupported protocol (e.g.: `http://`) throws Error
- [ ] 100% coverage (critical path)
- [ ] Mutation score ≥ 95% (high blast radius — wrong behavior breaks the connection silently)

**Validation commands:**

```bash
pnpm test src/server/utils/parse-redis-url.spec.ts
```

**Dependencies:** §2.3 (RedisOptions type re-export).

**Risks/Notes:**

- ⚠️ Do not use `node:url` legacy API — use the global `URL` constructor (available in Node 24)
- ⚠️ `decodeURIComponent` required for passwords with encoded `@`, `:`, `/`
- ⚠️ Default database is not set if pathname is empty — let ioredis default (db 0) prevail
- ⚠️ For `rediss://`, passing empty `tls: {}` is intentional — consumer may override via discrete options

### 2.6 `KeyBuilder` (namespace strategy)

**Objective:** Encapsulate the key composition `{namespace}{separator}{prefix}{separator}{id}` in an injectable class.

**Files to create:**

```
src/server/utils/key-builder.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache-exception'
import type { ResolvedOptions } from '../config/resolved-options'

/**
 * Composes Redis keys following the convention:
 *
 *   {namespace}{separator}{prefix}{separator}{id}
 *
 * With defaults (namespace='app', separator=':'):
 *
 *   build('users', 'u_1')      → 'app:users:u_1'
 *   applyNamespace('rl:u_1')   → 'app:rl:u_1'
 *
 * Validates that prefix and id are non-empty strings.
 *
 * @see Spec §7 — Namespace Strategy
 */
@Injectable()
export class KeyBuilder {
  private readonly namespace: string
  private readonly separator: string

  constructor(@Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions) {
    this.namespace = options.namespace
    this.separator = options.keySeparator
  }

  /**
   * Builds the full key: `{namespace}{sep}{prefix}{sep}{id}`.
   *
   * @throws CacheException with code INVALID_KEY when prefix or id is empty
   */
  build(prefix: string, id: string): string {
    if (!prefix || prefix.length === 0) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })
    }
    if (!id || id.length === 0) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_id' })
    }
    return `${this.namespace}${this.separator}${prefix}${this.separator}${id}`
  }

  /**
   * Applies only the namespace to an already-composed key.
   * Used internally by PubSubService (channels) and ScriptManagerService.
   */
  applyNamespace(keyWithoutNamespace: string): string {
    if (!keyWithoutNamespace || keyWithoutNamespace.length === 0) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_key' })
    }
    return `${this.namespace}${this.separator}${keyWithoutNamespace}`
  }

  /** Returns the namespace+separator prefix string (for SCAN patterns). */
  getNamespacePrefix(): string {
    return `${this.namespace}${this.separator}`
  }
}
```

**Acceptance criteria:**

- [ ] `build('users', 'u_1')` returns `'app:users:u_1'` with defaults
- [ ] `build('', 'u_1')` throws `CacheException(INVALID_KEY)`
- [ ] `build('users', '')` throws `CacheException(INVALID_KEY)`
- [ ] `applyNamespace('rl:u_1')` returns `'app:rl:u_1'`
- [ ] `getNamespacePrefix()` returns `'app:'` with defaults
- [ ] Custom separator (`'|'`) respected: `build` returns `'app|users|u_1'`
- [ ] 100% coverage

**Validation commands:**

```bash
pnpm test src/server/utils/key-builder.spec.ts
```

**Dependencies:** §2.3, §2.4.

**Risks/Notes:**

- ⚠️ Do not validate `id` against `separator` here — it can break consumers that use slugs containing `:`. Recommend via JSDoc only (spec §7.5 lists it as an anti-pattern).
- ⚠️ Template literal is faster than `Array.join` for 3 fixed segments — keep the literal

### 2.7 `ConnectionManager` + `resolveOptions` (lifecycle, retry, listeners)

**Objective:** Core of Phase 1. Manages the singleton ioredis client with correct lifecycle, retry strategy, options validation at bootstrap, and event propagation via `ICacheEvents.onEvent`.

**Files to create:**

```
src/server/
├── config/
│   ├── default-options.ts            # Applies defaults + validates
│   └── resolved-options.ts            # Type Required<BymaxCacheModuleOptions>
└── connection/
    └── connection.manager.ts          # Singleton + lifecycle
```

**Skeleton — `src/server/config/resolved-options.ts`:**

```typescript
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/**
 * Fully-resolved options after defaults merge. Required fields are
 * guaranteed; mode-specific blocks (connection/sentinel/cluster) remain
 * optional because only one applies per mode.
 */
export type ResolvedOptions = Required<
  Pick<
    BymaxCacheModuleOptions,
    'namespace' | 'keySeparator' | 'shutdownTimeoutMs' | 'allowFlushInProduction' | 'isGlobal'
  >
> &
  Pick<
    BymaxCacheModuleOptions,
    'mode' | 'connection' | 'sentinel' | 'cluster' | 'serializer' | 'events' | 'scripts'
  >
```

**Skeleton — `src/server/config/default-options.ts`:**

```typescript
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { DEFAULT_NAMESPACE, DEFAULT_KEY_SEPARATOR } from '../constants/default-namespace'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache-exception'
import type { ResolvedOptions } from './resolved-options'

/**
 * Validates consumer options at module bootstrap. Throws with actionable
 * CacheException codes when invariants are violated.
 *
 * @see Spec §4.6 — Bootstrap Validation
 */
export function validateOptions(options: BymaxCacheModuleOptions): void {
  const mode = options.mode ?? 'standalone'

  if (mode === 'sentinel') {
    if (!options.sentinel || !options.sentinel.sentinels?.length || !options.sentinel.name) {
      throw new CacheException(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'cluster') {
    if (!options.cluster || !options.cluster.nodes?.length) {
      throw new CacheException(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'standalone') {
    const c = options.connection
    if (!c || (!c.url && !c.host)) {
      throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
        reason: 'missing connection.url or connection.host'
      })
    }
  }

  const namespace = options.namespace ?? DEFAULT_NAMESPACE
  const separator = options.keySeparator ?? DEFAULT_KEY_SEPARATOR
  if (!namespace || namespace.trim() === '') {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, { namespace })
  }
  if (namespace.includes(separator)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'namespace contains key separator',
      namespace,
      separator
    })
  }

  const shutdown = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  if (shutdown < MIN_SHUTDOWN_TIMEOUT_MS) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'shutdownTimeoutMs too low',
      value: shutdown,
      min: MIN_SHUTDOWN_TIMEOUT_MS
    })
  }
  const connectTimeout = options.connection?.connectTimeout
  if (connectTimeout !== undefined && connectTimeout < MIN_CONNECT_TIMEOUT_MS) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'connectTimeout too low',
      value: connectTimeout,
      min: MIN_CONNECT_TIMEOUT_MS
    })
  }
}

/**
 * Merges consumer options with library defaults.
 * Returns a deep-frozen object guaranteed to have all required fields.
 */
export function applyDefaults(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions> {
  const resolved: ResolvedOptions = {
    mode: options.mode ?? 'standalone',
    connection: options.connection,
    sentinel: options.sentinel,
    cluster: options.cluster,
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    keySeparator: options.keySeparator ?? DEFAULT_KEY_SEPARATOR,
    serializer: options.serializer,
    events: options.events,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    allowFlushInProduction: options.allowFlushInProduction ?? false,
    isGlobal: options.isGlobal ?? true,
    scripts: options.scripts
  }
  return Object.freeze(resolved)
}
```

**Skeleton — `src/server/connection/connection.manager.ts`:**

```typescript
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { Redis, Cluster, type RedisOptions } from 'ioredis'
import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_EVENTS } from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import { parseRedisUrl } from '../utils/parse-redis-url'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES_PER_REQUEST
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache-exception'

type AnyRedis = Redis | Cluster

/**
 * Owns the lifecycle of the underlying ioredis client(s).
 *
 * Responsibilities:
 *   - Build RedisOptions from BymaxCacheModuleOptions (URL parse + defaults)
 *   - Create main client at OnModuleInit (unless lazyConnect)
 *   - Provide subscriber clients lazily via createSubscriberClient()
 *   - Register event listeners and forward to ICacheEvents.onEvent
 *   - Quit gracefully on OnModuleDestroy with timeout fallback to disconnect()
 *
 * @see Spec §11 — Connection Strategy
 */
@Injectable()
export class ConnectionManager implements OnModuleInit, OnModuleDestroy {
  private client: AnyRedis | null = null
  private readonly redisOptionsResolved: RedisOptions

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) private readonly events?: ICacheEvents
  ) {
    this.redisOptionsResolved = this.buildRedisOptions(options)
  }

  async onModuleInit(): Promise<void> {
    this.client = this.createClient()
    this.registerListeners(this.client, 'main')
    if (!this.options.connection?.lazyConnect) {
      await this.waitUntilReady(this.client)
    }
  }

  getClient(): AnyRedis {
    if (!this.client) {
      this.client = this.createClient()
      this.registerListeners(this.client, 'main')
    }
    return this.client
  }

  /** Creates a NEW dedicated connection for subscriber mode. */
  createSubscriberClient(): AnyRedis {
    const client = this.createClient()
    this.registerListeners(client, 'subscriber')
    return client
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return
    const timeout = this.options.shutdownTimeoutMs
    const clientRef = this.client
    try {
      await Promise.race([
        clientRef.quit(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), timeout)
        )
      ])
    } catch {
      clientRef.disconnect()
    } finally {
      this.client = null
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private createClient(): AnyRedis {
    switch (this.options.mode ?? 'standalone') {
      case 'standalone':
        return new Redis(this.redisOptionsResolved)
      case 'sentinel':
        return new Redis({
          ...this.redisOptionsResolved,
          sentinels: this.options.sentinel!.sentinels,
          name: this.options.sentinel!.name,
          sentinelPassword: this.options.sentinel!.sentinelPassword,
          role: this.options.sentinel!.role
        })
      case 'cluster':
        return new Cluster(this.options.cluster!.nodes, this.options.cluster!.options ?? {})
      default:
        throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
          reason: 'unsupported mode',
          mode: this.options.mode
        })
    }
  }

  private buildRedisOptions(opts: ResolvedOptions): RedisOptions {
    const c = opts.connection ?? {}
    const fromUrl = c.url ? parseRedisUrl(c.url) : {}
    return {
      host: c.host,
      port: c.port,
      password: c.password,
      db: c.db,
      username: c.username,
      tls: c.tls,
      lazyConnect: c.lazyConnect ?? false,
      connectTimeout: c.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
      commandTimeout: c.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: c.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST,
      enableReadyCheck: c.enableReadyCheck ?? true,
      enableOfflineQueue: c.enableOfflineQueue ?? false,
      retryStrategy: c.retryStrategy ?? ((times: number) => Math.min(times * 50, 2000)),
      reconnectOnError: c.reconnectOnError ?? ((err: Error) => err.message.includes('READONLY')),
      keepAlive: c.keepAlive ?? 0,
      noDelay: c.noDelay ?? true,
      family: c.family ?? 4,
      ...fromUrl // URL takes priority — last-write wins
    }
  }

  private registerListeners(client: AnyRedis, role: 'main' | 'subscriber'): void {
    const safe = (event: string, data: Record<string, unknown>): void => {
      try {
        this.events?.onEvent?.(event as never, data)
      } catch {
        // Observability callback must never crash the manager
      }
    }
    client.on('connect', () => safe('connect', { role }))
    client.on('ready', () => safe('ready', { role }))
    client.on('error', (err: Error) => safe('error', { role, error: err.message }))
    client.on('close', () => safe('close', { role }))
    client.on('reconnecting', (delay: number) => safe('reconnecting', { role, delay }))
    client.on('end', () => safe('end', { role }))
  }

  private async waitUntilReady(client: AnyRedis): Promise<void> {
    if (client.status === 'ready') return
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, { error: err.message }))
      }
      const cleanup = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
      }
      client.once('ready', onReady)
      client.once('error', onError)
    })
  }
}
```

**Acceptance criteria:**

- [ ] `onModuleInit` creates standalone client with URL
- [ ] `onModuleInit` creates sentinel client when `mode === 'sentinel'`
- [ ] `onModuleInit` creates cluster client when `mode === 'cluster'`
- [ ] `getClient()` returns the same instance on repeated calls (singleton)
- [ ] `createSubscriberClient()` returns a new instance on each call
- [ ] Events `connect`/`ready`/`error`/`close`/`reconnecting`/`end` propagated to `events.onEvent` with `role`
- [ ] Exception thrown in `onEvent` is **swallowed** (does not propagate)
- [ ] `onModuleDestroy` calls `quit()` and respects the timeout
- [ ] `onModuleDestroy` forces `disconnect()` when `quit()` exceeds the timeout
- [ ] `validateOptions` throws `SENTINEL_MISCONFIGURED` for `mode: 'sentinel'` without `sentinels`
- [ ] `validateOptions` throws `CLUSTER_MISCONFIGURED` for `mode: 'cluster'` without `nodes`
- [ ] `validateOptions` throws `INVALID_NAMESPACE` for empty namespace or one containing the separator
- [ ] URL priority: discrete fields act as fallback (URL overrides)
- [ ] 95% coverage on `connection.manager.ts` and `default-options.ts`

**Validation commands:**

```bash
pnpm test src/server/connection/connection.manager.spec.ts
pnpm test src/server/config/default-options.spec.ts
pnpm test:cov
```

**Dependencies:** §2.3, §2.4, §2.5.

**Risks/Notes:**

- ⚠️ `ioredis-mock` 8.x emulates `Redis` but **does not** emulate `Cluster` — cluster mode tests use manual mocks or skip
- ⚠️ `client.off(...)` requires ioredis 5.4+ — version pinned in `package.json`
- ⚠️ `Cluster` vs `Redis` diverge in some methods — test shutdown in both modes
- ⚠️ Do not log via `console.*` in the `onEvent` fallback — silencing is correct; the consumer chooses observability
- ⚠️ `waitUntilReady` uses `once` and manual cleanup to avoid a memory leak in retry loops

### 2.8 Module skeleton (`BymaxCacheModule.forRoot` — minimal Phase 1)

**Objective:** Implement the NestJS dynamic module providing `ConnectionManager` + `KeyBuilder` + tokens. **Synchronous only** in this phase; `forRootAsync` arrives in Phase 4 (§5.1).

**Files to create:**

```
src/server/bymax-cache.module.ts
```

**Skeleton:**

```typescript
import { type DynamicModule, Module, type Provider } from '@nestjs/common'
import {
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER
} from './bymax-cache.constants'
import { applyDefaults, validateOptions } from './config/default-options'
import { ConnectionManager } from './connection/connection.manager'
import { KeyBuilder } from './utils/key-builder'
import type { BymaxCacheModuleOptions } from './interfaces/cache-module-options.interface'

/**
 * Dynamic module for @bymax-one/nest-cache.
 *
 * Phase 1 surface: forRoot() only. CacheService, PubSubService,
 * ScriptManagerService and forRootAsync arrive in Phases 2-4.
 *
 * @example
 *   BymaxCacheModule.forRoot({
 *     connection: { url: 'redis://localhost:6379' },
 *     namespace: 'app',
 *   })
 */
// §0 OVERRIDE (2026-05-30): this manual skeleton is ILLUSTRATIVE of the providers/exports to
// register. Per spec §0, implement on top of `ConfigurableModuleBuilder` — extend the generated
// base (`bymax-cache.module.builder.ts`), `override forRoot`/`forRootAsync`, and augment the
// `DynamicModule` produced by `super.forRoot()`. See tasks CACHE-015 / CACHE-040.
@Module({})
export class BymaxCacheModule {
  /** Synchronous configuration. */
  static forRoot(options: BymaxCacheModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)

    const providers: Provider[] = [
      { provide: BYMAX_CACHE_OPTIONS, useValue: resolved },
      { provide: BYMAX_CACHE_EVENTS, useValue: resolved.events ?? null },
      ConnectionManager,
      KeyBuilder,
      { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder }
    ]

    return {
      module: BymaxCacheModule,
      global: resolved.isGlobal,
      providers,
      exports: [BYMAX_CACHE_OPTIONS, BYMAX_CACHE_KEY_BUILDER, ConnectionManager, KeyBuilder]
    }
  }
}
```

**Acceptance criteria:**

- [ ] `BymaxCacheModule.forRoot(options)` returns `DynamicModule`
- [ ] Module is global by default (`isGlobal: true`)
- [ ] `isGlobal: false` respected (verifiable in e2e)
- [ ] Invalid options throw `CacheException` in `forRoot` (not at runtime)
- [ ] `ConnectionManager` and `KeyBuilder` injectable in consumer modules
- [ ] `BYMAX_CACHE_OPTIONS` token resolves to deep-frozen `ResolvedOptions`
- [ ] 95% coverage on `bymax-cache.module.ts`

**Validation commands:**

```bash
pnpm test src/server/bymax-cache.module.spec.ts
```

**Dependencies:** §2.3, §2.4, §2.6, §2.7.

**Risks/Notes:**

- ⚠️ `BYMAX_CACHE_EVENTS` provides `null` when the consumer does not pass `events` — `@Optional()` in `ConnectionManager` handles this
- ⚠️ `useExisting: KeyBuilder` vs `useClass`: we want the same instance (singleton); `useExisting` is the correct pattern

### 2.9 Barrel `src/server/index.ts` (Phase 1 surface) + phase tests

**Objective:** Expose the official public API of the server subpath **valid for Phase 1** (only Connection + KeyBuilder + types + errors). And complete the phase test suite with coverage ≥ 80% global and ≥ 95% on critical paths.

**Files to create/modify:**

```
src/server/index.ts                 # Barrel — Phase 1 surface
```

**Test files (structure):**

```
src/
├── server/
│   ├── bymax-cache.module.spec.ts
│   ├── config/
│   │   └── default-options.spec.ts
│   ├── connection/
│   │   └── connection.manager.spec.ts
│   ├── errors/
│   │   └── cache-exception.spec.ts
│   └── utils/
│       ├── parse-redis-url.spec.ts
│       └── key-builder.spec.ts
└── shared/
    └── constants/
        └── error-codes.spec.ts
```

**Skeleton — `src/server/index.ts` (Phase 1):**

```typescript
// Module
export { BymaxCacheModule } from './bymax-cache.module'

// Services / Managers exposed in Phase 1
export { ConnectionManager } from './connection/connection.manager'
export { KeyBuilder } from './utils/key-builder'

// Interfaces / contracts
export type {
  BymaxCacheModuleOptions,
  BymaxCacheModuleAsyncOptions,
  BymaxCacheStandaloneConnection,
  BymaxCacheSentinelConnection,
  BymaxCacheClusterConnection,
  ClusterNode,
  ClusterOptions,
  RedisOptions,
  SentinelAddress
} from './interfaces/cache-module-options.interface'
export type { ICacheEvents } from './interfaces/cache-events.interface'
export type { ISerializer } from './interfaces/serializer.interface'
export type { IScriptDefinition } from './interfaces/script-definition.interface'
export type { IPubSubHandler, IPubSubPatternHandler } from './interfaces/pubsub-handler.interface'

// DI tokens
export {
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_SERIALIZER,
  BYMAX_CACHE_KEY_BUILDER
} from './bymax-cache.constants'

// Errors
export { CacheException } from './errors/cache-exception'
export { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES } from './errors/cache-error-codes'
export type { CacheErrorCode } from './errors/cache-error-codes'

// Re-export ioredis core types for consumer convenience
export type { Redis, RedisKey } from 'ioredis'

// Re-export from shared
export type {
  CacheEventName,
  CacheConnectionStatus,
  CacheNamespace,
  CacheKeyPrefix,
  SerializableValue
} from '../shared'
export { CACHE_EVENT_NAMES } from '../shared'
```

**Test pattern — AAA pattern mandatory:**

```typescript
it('should <do something> when <condition>', () => {
  // Arrange — setup
  // Act     — execute
  // Assert  — verify
})
```

**Critical cases per file:**

#### `parse-redis-url.spec.ts`

```typescript
describe('parseRedisUrl', () => {
  it('should parse host and port from basic redis:// URL', () => {
    expect(parseRedisUrl('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379
    })
  })

  it('should default port to 6379 when omitted', () => {
    expect(parseRedisUrl('redis://localhost').port).toBe(6379)
  })

  it('should extract password and username', () => {
    expect(parseRedisUrl('redis://default:secret@h:6379')).toMatchObject({
      username: 'default',
      password: 'secret'
    })
  })

  it('should URL-decode password with special chars', () => {
    expect(parseRedisUrl('redis://u:p%40ss%21@h')).toMatchObject({ password: 'p@ss!' })
  })

  it('should extract db from pathname', () => {
    expect(parseRedisUrl('redis://h/3').db).toBe(3)
  })

  it('should NOT set db when pathname is empty', () => {
    expect(parseRedisUrl('redis://h').db).toBeUndefined()
  })

  it('should enable tls for rediss://', () => {
    expect(parseRedisUrl('rediss://h').tls).toEqual({})
  })

  it('should throw on unsupported protocol', () => {
    expect(() => parseRedisUrl('http://h')).toThrow(/Unsupported Redis protocol/)
  })

  it('should throw on malformed URL', () => {
    expect(() => parseRedisUrl('not-a-url')).toThrow()
  })
})
```

#### `key-builder.spec.ts`

```typescript
describe('KeyBuilder', () => {
  const make = (overrides: Partial<BymaxCacheModuleOptions> = {}): KeyBuilder => {
    const opts = applyDefaults({
      connection: { host: 'h' },
      ...overrides
    } as never)
    return new KeyBuilder(opts as ResolvedOptions)
  }

  it('should build {namespace}:{prefix}:{id} with defaults', () => {
    expect(make().build('users', 'u_1')).toBe('app:users:u_1')
  })

  it('should respect custom namespace and separator', () => {
    expect(make({ namespace: 'fitness', keySeparator: '|' }).build('w', '1')).toBe('fitness|w|1')
  })

  it('should throw INVALID_KEY on empty prefix', () => {
    expect(() => make().build('', 'id')).toThrow(CacheException)
  })

  it('should throw INVALID_KEY on empty id', () => {
    expect(() => make().build('p', '')).toThrow(CacheException)
  })

  it('should applyNamespace to bare key', () => {
    expect(make().applyNamespace('rl:u_1')).toBe('app:rl:u_1')
  })

  it('should expose namespace prefix for SCAN patterns', () => {
    expect(make().getNamespacePrefix()).toBe('app:')
  })
})
```

#### `connection.manager.spec.ts` (uses `ioredis-mock`)

```typescript
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

describe('ConnectionManager', () => {
  it('should create main client at onModuleInit', async () => {
    const events = { onEvent: jest.fn() }
    const cm = new ConnectionManager(applyDefaults({ connection: { host: 'h' }, events }), events)
    await cm.onModuleInit()
    expect(cm.getClient()).toBeDefined()
    expect(events.onEvent).toHaveBeenCalledWith('connect', { role: 'main' })
  })

  it('should not crash when onEvent throws', async () => {
    const events = {
      onEvent: jest.fn(() => {
        throw new Error('boom')
      })
    }
    const cm = new ConnectionManager(applyDefaults({ connection: { host: 'h' }, events }), events)
    await expect(cm.onModuleInit()).resolves.not.toThrow()
  })

  it('should reuse client across getClient() calls (singleton)', async () => {
    const cm = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
    await cm.onModuleInit()
    expect(cm.getClient()).toBe(cm.getClient())
  })

  it('should return fresh instance from createSubscriberClient()', async () => {
    const cm = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
    await cm.onModuleInit()
    const sub = cm.createSubscriberClient()
    expect(sub).not.toBe(cm.getClient())
  })

  it('should disconnect on shutdown timeout', async () => {
    const cm = new ConnectionManager(
      applyDefaults({
        connection: { host: 'h' },
        shutdownTimeoutMs: 100
      })
    )
    await cm.onModuleInit()
    const client = cm.getClient()
    jest.spyOn(client, 'quit').mockImplementation(() => new Promise(() => {}))
    const disconnectSpy = jest.spyOn(client, 'disconnect').mockImplementation(() => {})
    await cm.onModuleDestroy()
    expect(disconnectSpy).toHaveBeenCalled()
  })
})
```

#### `default-options.spec.ts`

```typescript
describe('validateOptions', () => {
  it('should accept valid standalone with URL', () => {
    expect(() => validateOptions({ connection: { url: 'redis://h' } })).not.toThrow()
  })

  it('should throw SENTINEL_MISCONFIGURED on missing sentinel.sentinels', () => {
    expect(() => validateOptions({ mode: 'sentinel' } as never)).toThrow(/sentinel/i)
  })

  it('should throw CLUSTER_MISCONFIGURED on missing cluster.nodes', () => {
    expect(() => validateOptions({ mode: 'cluster' } as never)).toThrow(/cluster/i)
  })

  it('should throw INVALID_NAMESPACE on empty namespace', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, namespace: '' })).toThrow(
      CacheException
    )
  })

  it('should throw INVALID_NAMESPACE when namespace contains separator', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, namespace: 'a:b' })).toThrow(
      CacheException
    )
  })

  it('should throw when shutdownTimeoutMs < MIN', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, shutdownTimeoutMs: 50 })).toThrow(
      CacheException
    )
  })
})

describe('applyDefaults', () => {
  it('should apply DEFAULT_NAMESPACE and DEFAULT_KEY_SEPARATOR', () => {
    const r = applyDefaults({ connection: { host: 'h' } })
    expect(r.namespace).toBe('app')
    expect(r.keySeparator).toBe(':')
  })

  it('should return deep-frozen object', () => {
    const r = applyDefaults({ connection: { host: 'h' } })
    expect(Object.isFrozen(r)).toBe(true)
  })

  it('should respect consumer overrides', () => {
    const r = applyDefaults({
      connection: { host: 'h' },
      namespace: 'fitness',
      isGlobal: false
    })
    expect(r.namespace).toBe('fitness')
    expect(r.isGlobal).toBe(false)
  })
})
```

#### `cache-exception.spec.ts`

```typescript
describe('CacheException', () => {
  it('should expose code and details', () => {
    const e = new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })
    expect(e.code).toBe('cache.invalid_key')
    expect(e.details).toEqual({ reason: 'empty_prefix' })
  })

  it('should map FLUSH_DISABLED_IN_PRODUCTION to HTTP 403', () => {
    expect(new CacheException(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION).getStatus()).toBe(403)
  })

  it('should map COMMAND_TIMEOUT to HTTP 504', () => {
    expect(new CacheException(CACHE_ERROR_CODES.COMMAND_TIMEOUT).getStatus()).toBe(504)
  })

  it('should allow status override', () => {
    expect(new CacheException(CACHE_ERROR_CODES.INVALID_KEY, undefined, 418).getStatus()).toBe(418)
  })

  it('should serialize payload as { error: { code, message, details } }', () => {
    const e = new CacheException(CACHE_ERROR_CODES.INVALID_KEY)
    expect(e.getResponse()).toEqual({
      error: { code: 'cache.invalid_key', message: expect.any(String), details: null }
    })
  })
})
```

#### `bymax-cache.module.spec.ts`

```typescript
describe('BymaxCacheModule', () => {
  it('should register ConnectionManager and KeyBuilder as injectable', async () => {
    const module = await Test.createTestingModule({
      imports: [BymaxCacheModule.forRoot({ connection: { host: 'h' } })]
    }).compile()

    expect(module.get(ConnectionManager)).toBeInstanceOf(ConnectionManager)
    expect(module.get(KeyBuilder)).toBeInstanceOf(KeyBuilder)
  })

  it('should be global by default', () => {
    const m = BymaxCacheModule.forRoot({ connection: { host: 'h' } })
    expect(m.global).toBe(true)
  })

  it('should respect isGlobal: false', () => {
    const m = BymaxCacheModule.forRoot({ connection: { host: 'h' }, isGlobal: false })
    expect(m.global).toBe(false)
  })

  it('should throw on invalid options before returning DynamicModule', () => {
    expect(() => BymaxCacheModule.forRoot({ namespace: '' } as never)).toThrow(CacheException)
  })
})
```

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports coverage ≥ 80% global
- [ ] Coverage per file:
  - `connection.manager.ts`: ≥ 95%
  - `parse-redis-url.ts`: ≥ 100%
  - `key-builder.ts`: ≥ 100%
  - `default-options.ts`: ≥ 95%
  - `cache-exception.ts`: ≥ 95%
  - `bymax-cache.module.ts`: ≥ 95%
- [ ] `pnpm test` zero falhas
- [ ] `clearMocks: true` and `restoreMocks: true` honored (no spillover between tests)
- [ ] Barrel `src/server/index.ts` only exports the Phase 1 surface (do not leak internals)

**Validation commands:**

```bash
pnpm test:cov
pnpm build
node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"
# Expected output includes: BYMAX_CACHE_*, BymaxCacheModule, CacheException, CACHE_ERROR_CODES,
# CACHE_ERROR_MESSAGES, CACHE_EVENT_NAMES, ConnectionManager, KeyBuilder
```

**Dependencies:** §2.7, §2.8.

**Risks/Notes:**

- ⚠️ Global `ioredis-mock` mock via `jest.mock('ioredis')` must be set up **before** the import — use `setup-mocks.ts` to guarantee that
- ⚠️ Do not test Cluster mode with `ioredis-mock` (unsupported); Cluster tests are deferred to E2E (Phase 4) with Testcontainers
- ⚠️ Mocking `quit()` to never resolve requires `new Promise(() => {})` (intentional) — use a test timeout to avoid hanging the suite

### 2.10 Phase 1 validation

**Final commands to validate the phase:**

```bash
# 1. Type safety
pnpm typecheck

# 2. Lint
pnpm lint

# 3. Tests + coverage
pnpm test:cov

# 4. Build
pnpm build

# 5. Bundle size
pnpm size

# 6. Smoke test — import and use the lib in a script
cat <<'EOF' > /tmp/cache-smoke.mjs
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { BymaxCacheModule, ConnectionManager, KeyBuilder } from './dist/server/index.mjs'

@Module({
  imports: [BymaxCacheModule.forRoot({
    connection: { url: 'redis://localhost:6379' },
    namespace: 'smoke',
    events: { onEvent: (e, d) => console.log(`[${e}]`, d) },
  })],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
const cm = app.get(ConnectionManager)
const kb = app.get(KeyBuilder)
console.log('Key:', kb.build('users', 'u_1'))  // → smoke:users:u_1
console.log('Status:', cm.getClient().status)
await app.close()
EOF
node /tmp/cache-smoke.mjs
```

**Expected:**

```
[connect] { role: 'main' }
[ready]   { role: 'main' }
Key:      smoke:users:u_1
Status:   ready
[close]   { role: 'main' }
[end]     { role: 'main' }
```

**Done criteria to close Phase 1:**

> **Status (2026-05-30): ✅ PASSED.** typecheck + lint clean; `pnpm test:cov:all` = 181 tests at
> 100% statements/branches/functions/lines; `pnpm build` + `pnpm size` green.

- [x] All commands above pass
- [x] Coverage thresholds met
- [ ] `git status` clean after commits with Conventional Commits (`feat(cache): scaffold project structure`, `feat(cache): add shared types and constants`, `feat(cache): implement ConnectionManager`, etc.)
- [ ] `/bymax-quality:code-review` executed and findings applied
- [ ] Pull request opened with the `phase-1` label

---

## 3. Phase 2 — CacheService + Typed Helpers + Serializer

> **Phase objective:** Implement `CacheService` (the public facade for typed Redis commands) with helpers for strings (`get/set/setNx/del/delMany/exists/getRaw/setRaw`), numerics (`incr/decr/expire/ttl/persist`), batch (`mget/mset`), iteration (`keys/scan`), hash (`hget/hset/hgetall/hdel`), set (`sadd/srem/smembers/sismember/scard`), raw `pipeline()` + `getClient()` escape hatch, and the default `JsonSerializer` + pluggable `ISerializer` interface. Also adds `flushNamespace()` with a production safety guard. At the end, the lib's main API is usable in consumer apps.
>
> **Complexity:** MEDIUM.
>
> **Critical paths for 95% coverage:** `src/server/services/cache.service.ts`, `src/server/utils/json-serializer.ts`.

### 3.1 `ISerializer` + `JsonSerializer` (default)

**Objective:** Implement the default JSON serializer and formalize the pluggable interface that consumers use for MsgPack/CBOR/protobuf.

**Files to create:**

```
src/server/utils/json-serializer.ts
```

**Skeleton:**

```typescript
import { Injectable } from '@nestjs/common'
import type { ISerializer } from '../interfaces/serializer.interface'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache-exception'

/**
 * Default ISerializer implementation using JSON.
 *
 * Limitations of JSON:
 *   - `Date` → string ISO (consumer rehydrates if needed)
 *   - `Map`, `Set`, `BigInt`, `undefined` are NOT preserved
 *   - `Buffer` becomes a verbose JSON object
 *
 * Consumers needing structural-preserving formats implement ISerializer
 * directly (see Spec §6.3 for MsgPack example).
 */
@Injectable()
export class JsonSerializer implements ISerializer {
  serialize<T>(value: T): string {
    try {
      return JSON.stringify(value)
    } catch (err) {
      throw new CacheException(CACHE_ERROR_CODES.SERIALIZATION_FAILED, {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  deserialize<T>(raw: string): T {
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      throw new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, {
        error: err instanceof Error ? err.message : String(err),
        preview: raw.length > 100 ? `${raw.substring(0, 100)}...` : raw
      })
    }
  }
}
```

**Acceptance criteria:**

- [ ] `serialize({ a: 1 })` returns `'{"a":1}'`
- [ ] `deserialize('{"a":1}')` returns `{ a: 1 }`
- [ ] `serialize` throws `CacheException(SERIALIZATION_FAILED)` on circular reference
- [ ] `deserialize` throws `CacheException(DESERIALIZATION_FAILED)` on malformed JSON
- [ ] `deserialize` includes `preview` of the raw in `details` (truncated to 100 chars)
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/json-serializer.spec.ts
```

**Dependencies:** §2.3 (`ISerializer`), §2.4 (codes de erro).

**Risks/Notes:**

- ⚠️ `JSON.stringify` throws on circular references — catch and wrap
- ⚠️ Do not log full `raw` in `details` (may contain PII) — truncate to 100 chars
- ⚠️ Keep `@Injectable()` for use via DI when the `serializer` option is not provided

### 3.2 `CacheService` — string/numeric/del/exists/expire/ttl

**Objective:** Implement the first slice of `CacheService` covering string/numeric commands. Subsequent slices add hash/set/scan in §3.3 and §3.4.

**Files to create:**

```
src/server/services/cache.service.ts
```

**Skeleton (Phase 2.2 — first slice):**

```typescript
import { Inject, Injectable, Optional } from '@nestjs/common'
import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER } from '../bymax-cache.constants'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { JsonSerializer } from '../utils/json-serializer'
import type { ISerializer } from '../interfaces/serializer.interface'
import type { ResolvedOptions } from '../config/resolved-options'

/**
 * Public facade for Redis commands. Each method:
 *   1. Composes the end key via KeyBuilder (applies namespace)
 *   2. Delegates to ConnectionManager.getClient() (singleton)
 *   3. Serializes/deserializes via configured ISerializer
 *
 * Errors from ioredis bubble up as-is for connection/timeout cases;
 * deserialization errors are wrapped in CacheException.
 *
 * @see Spec §5 — Main Service
 */
@Injectable()
export class CacheService {
  private readonly serializer: ISerializer

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager,
    private readonly keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer
  ) {
    // Priority: explicit serializer option > injected token > default JSON
    this.serializer = options.serializer ?? injectedSerializer ?? new JsonSerializer()
  }

  // ─── String / value commands ─────────────────────────────────────────────

  /**
   * Reads a value and deserializes via configured serializer.
   *
   * @returns Deserialized value or null if key does not exist
   * @throws CacheException(DESERIALIZATION_FAILED) on malformed cached value
   */
  async get<T>(prefix: string, id: string): Promise<T | null> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = await this.connection.getClient().get(key)
    if (raw === null) return null
    return this.serializer.deserialize<T>(raw)
  }

  /** Reads the raw string value without deserialization. */
  async getRaw(prefix: string, id: string): Promise<string | null> {
    return this.connection.getClient().get(this.keyBuilder.build(prefix, id))
  }

  /**
   * Writes a value with optional TTL (seconds).
   *
   * @param ttlSeconds Omit for in the expiration
   */
  async set<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<void> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    if (ttlSeconds !== undefined) {
      await this.connection.getClient().set(key, raw, 'EX', ttlSeconds)
    } else {
      await this.connection.getClient().set(key, raw)
    }
  }

  /** Writes a raw string without serialization. */
  async setRaw(prefix: string, id: string, value: string, ttlSeconds?: number): Promise<void> {
    const key = this.keyBuilder.build(prefix, id)
    if (ttlSeconds !== undefined) {
      await this.connection.getClient().set(key, value, 'EX', ttlSeconds)
    } else {
      await this.connection.getClient().set(key, value)
    }
  }

  /**
   * SET if Not eXists. Atomic.
   *
   * @returns true if value was stored, false if key already existed
   */
  async setNx<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    const result =
      ttlSeconds !== undefined
        ? await this.connection.getClient().set(key, raw, 'EX', ttlSeconds, 'NX')
        : await this.connection.getClient().set(key, raw, 'NX')
    return result === 'OK'
  }

  async del(prefix: string, id: string): Promise<number> {
    return this.connection.getClient().del(this.keyBuilder.build(prefix, id))
  }

  async delMany(prefix: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
    return this.connection.getClient().del(...keys)
  }

  async exists(prefix: string, id: string): Promise<boolean> {
    const count = await this.connection.getClient().exists(this.keyBuilder.build(prefix, id))
    return count > 0
  }

  // ─── Numeric commands ────────────────────────────────────────────────────

  async incr(prefix: string, id: string, by = 1): Promise<number> {
    const key = this.keyBuilder.build(prefix, id)
    return by === 1
      ? this.connection.getClient().incr(key)
      : this.connection.getClient().incrby(key, by)
  }

  async decr(prefix: string, id: string, by = 1): Promise<number> {
    const key = this.keyBuilder.build(prefix, id)
    return by === 1
      ? this.connection.getClient().decr(key)
      : this.connection.getClient().decrby(key, by)
  }

  // ─── Expiration commands ─────────────────────────────────────────────────

  async expire(prefix: string, id: string, ttlSeconds: number): Promise<boolean> {
    const r = await this.connection
      .getClient()
      .expire(this.keyBuilder.build(prefix, id), ttlSeconds)
    return r === 1
  }

  /** @returns TTL in seconds. -2 if key does not exist, -1 if in the expiration. */
  async ttl(prefix: string, id: string): Promise<number> {
    return this.connection.getClient().ttl(this.keyBuilder.build(prefix, id))
  }

  async persist(prefix: string, id: string): Promise<boolean> {
    const r = await this.connection.getClient().persist(this.keyBuilder.build(prefix, id))
    return r === 1
  }

  // ─── Batch commands ──────────────────────────────────────────────────────

  async mget<T>(prefix: string, ids: readonly string[]): Promise<Array<T | null>> {
    if (ids.length === 0) return []
    const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
    const values = await this.connection.getClient().mget(...keys)
    return values.map((v) => (v === null ? null : this.serializer.deserialize<T>(v)))
  }

  async mset<T>(prefix: string, entries: ReadonlyArray<readonly [string, T]>): Promise<void> {
    if (entries.length === 0) return
    const pairs: string[] = []
    for (const [id, value] of entries) {
      pairs.push(this.keyBuilder.build(prefix, id), this.serializer.serialize(value))
    }
    await this.connection.getClient().mset(...pairs)
  }
}
```

**Acceptance criteria:**

- [ ] `get/set` roundtrip preserves JSON values (objects, arrays, primitives, null)
- [ ] `get` returns `null` for the nonexistent key
- [ ] `set` with `ttlSeconds` applies EXPIRE (verifiable via `ttl`)
- [ ] `setNx` returns `true` on the first write, `false` on subsequent ones
- [ ] `del`/`delMany` return the count of removed keys
- [ ] `delMany([])` returns 0 without calling Redis
- [ ] `exists` returns boolean
- [ ] `incr`/`decr` aceitam custom `by`
- [ ] `expire` returns boolean (true se key existia)
- [ ] `ttl` returns `-2` for the nonexistent key, `-1` for in the expiration
- [ ] `mget`/`mset` apply the namespace to all keys
- [ ] `mget([])` returns `[]` without calling Redis
- [ ] Custom serializer (passed via options) is honored instead of the default JSON
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts
```

**Dependencies:** §2.7 (ConnectionManager), §2.6 (KeyBuilder), §3.1 (JsonSerializer).

**Risks/Notes:**

- ⚠️ ioredis accepts variadic `mset(...pairs)` or object `mset({key: val})`; use variadic to avoid a type gotcha
- ⚠️ ioredis's `setNx` return is `'OK' | null` — compare with `'OK'` (not `result !== null`)
- ⚠️ `expire` returns `0 | 1` — convert to boolean

### 3.3 `CacheService` — hash + set commands

**Objective:** Add Hash (`hget/hset/hgetall/hdel`) and Set (`sadd/srem/smembers/sismember/scard`) commands to `CacheService`.

**Files to modify:**

```
src/server/services/cache.service.ts
```

**Skeleton (continua a class):**

```typescript
// ─── Hash commands ────────────────────────────────────────────────────────

async hget<T>(prefix: string, id: string, field: string): Promise<T | null> {
  const key = this.keyBuilder.build(prefix, id)
  const raw = await this.connection.getClient().hget(key, field)
  if (raw === null) return null
  return this.serializer.deserialize<T>(raw)
}

async hset<T>(prefix: string, id: string, field: string, value: T): Promise<number> {
  const key = this.keyBuilder.build(prefix, id)
  return this.connection.getClient().hset(key, field, this.serializer.serialize(value))
}

async hgetall<T>(prefix: string, id: string): Promise<Record<string, T>> {
  const key = this.keyBuilder.build(prefix, id)
  const all = await this.connection.getClient().hgetall(key)
  const result: Record<string, T> = {}
  for (const [field, raw] of Object.entries(all)) {
    result[field] = this.serializer.deserialize<T>(raw)
  }
  return result
}

async hdel(prefix: string, id: string, ...fields: readonly string[]): Promise<number> {
  if (fields.length === 0) return 0
  const key = this.keyBuilder.build(prefix, id)
  return this.connection.getClient().hdel(key, ...fields)
}

// ─── Set commands ─────────────────────────────────────────────────────────

async sadd(prefix: string, id: string, ...members: readonly string[]): Promise<number> {
  if (members.length === 0) return 0
  return this.connection.getClient().sadd(this.keyBuilder.build(prefix, id), ...members)
}

async srem(prefix: string, id: string, ...members: readonly string[]): Promise<number> {
  if (members.length === 0) return 0
  return this.connection.getClient().srem(this.keyBuilder.build(prefix, id), ...members)
}

async smembers(prefix: string, id: string): Promise<string[]> {
  return this.connection.getClient().smembers(this.keyBuilder.build(prefix, id))
}

async sismember(prefix: string, id: string, member: string): Promise<boolean> {
  const r = await this.connection.getClient().sismember(this.keyBuilder.build(prefix, id), member)
  return r === 1
}

async scard(prefix: string, id: string): Promise<number> {
  return this.connection.getClient().scard(this.keyBuilder.build(prefix, id))
}
```

**Acceptance criteria:**

- [ ] `hset`/`hget` roundtrip preserves tipos via serializer
- [ ] `hgetall` returns an object with all fields deserialized
- [ ] `hgetall` returns `{}` for the nonexistent hash
- [ ] `hdel(...[])` returns 0 without calling Redis
- [ ] `sadd`/`srem` return the count of elements actually modified
- [ ] `sadd(...[])` and `srem(...[])` return 0 without calling Redis
- [ ] `sismember` returns boolean
- [ ] `scard` returns 0 for the nonexistent set
- [ ] Set members are **strings** (not serialized) — different from hash values
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts
```

**Dependencies:** §3.2.

**Risks/Notes:**

- ⚠️ Redis set members are always strings — do not apply the serializer here (design decision: sets store IDs, not objects)
- ⚠️ Hash field names are also strings without serialization — only values go through the serializer
- ⚠️ `sismember` returns `0 | 1` (not a native boolean) — convert

### 3.4 `CacheService` — iteration (`keys`, `scan`) + pipeline + getClient

**Objective:** Add key iteration (`keys` with a JSDoc warning, cursor-based `scan` recommended), raw pipeline, and the `getClient()` escape hatch.

**Files to modify:**

```
src/server/services/cache.service.ts
```

**Skeleton (continua a class):**

```typescript
import type { ChainableCommander } from 'ioredis'
import type { Redis } from 'ioredis'

// ... inside the CacheService class:

// ─── Iteration ────────────────────────────────────────────────────────────

/**
 * KEYS pattern is O(N) and BLOCKS Redis. Prefer scan() in production.
 *
 * @example
 *   await cache.keys('users', '*')   // → ['app:users:u_1', 'app:users:u_2']
 */
async keys(prefix: string, pattern: string): Promise<string[]> {
  const fullPattern = this.keyBuilder.build(prefix, pattern)
  return this.connection.getClient().keys(fullPattern)
}

/**
 * Cursor-based key iteration. Non-blocking, safe for production.
 *
 * @example
 *   for await (const key of cache.scan('users', '*')) {
 *     console.log(key)
 *   }
 */
async *scan(prefix: string, pattern: string, count = 100): AsyncIterable<string> {
  const fullPattern = this.keyBuilder.build(prefix, pattern)
  // scanStream is only present on Redis (standalone/sentinel) — Cluster uses a different API
  const client = this.connection.getClient() as Redis
  if (typeof client.scanStream !== 'function') {
    throw new Error('scan() requires standalone/sentinel mode (Cluster has different semantics)')
  }
  const stream = client.scanStream({ match: fullPattern, count })
  for await (const chunk of stream) {
    for (const key of chunk as string[]) yield key
  }
}

// ─── Pipeline / escape hatch ─────────────────────────────────────────────

/**
 * Returns an ioredis ChainableCommander for batching commands.
 *
 * NOTE: keys passed to pipeline commands are NOT auto-namespaced — caller
 * is responsible for composing keys via KeyBuilder.
 *
 * @example
 *   const pipe = cache.pipeline()
 *   pipe.set(kb.build('p', 'a'), '1')
 *   pipe.set(kb.build('p', 'b'), '2')
 *   await pipe.exec()
 */
pipeline(): ChainableCommander {
  return this.connection.getClient().pipeline()
}

/**
 * Returns the raw ioredis client. Keys are NOT auto-namespaced — use this
 * only when you need a command not exposed by CacheService.
 */
getClient(): Redis {
  return this.connection.getClient() as Redis
}
```

**Acceptance criteria:**

- [ ] `keys('users', '*')` returns a list of keys matching `app:users:*`
- [ ] `scan('users', '*')` returns the same list via async iteration
- [ ] `scan` respects `count` (verifiable via a spy on `scanStream`)
- [ ] `scan` throws Error in cluster mode (no `scanStream`)
- [ ] `pipeline()` returns `ChainableCommander` with chainable methods
- [ ] `getClient()` returns the raw ioredis instance
- [ ] 95% coverage (skip the cluster error line — tested in E2E Phase 4)

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts
```

**Dependencies:** §3.3.

**Risks/Notes:**

- ⚠️ `scanStream` returns chunks (`string[]`), not individual keys — flatten inline
- ⚠️ The `ChainableCommander` type comes from ioredis — import directly
- ⚠️ `getClient()` cast to `Redis` can give the wrong type in cluster mode — document the limitation

### 3.5 `CacheService` — `flushNamespace` with safety guard

**Objective:** Implement the destructive `flushNamespace()` operation that deletes all keys under the namespace via SCAN + UNLINK pipeline. Blocked by default in production via `allowFlushInProduction: false`.

**Files to modify:**

```
src/server/services/cache.service.ts
```

**Skeleton (continua a class):**

```typescript
/**
 * Deletes ALL keys under the configured namespace via SCAN + UNLINK pipeline.
 *
 * SAFETY: throws FLUSH_DISABLED_IN_PRODUCTION when NODE_ENV === 'production'
 * unless `options.allowFlushInProduction === true`.
 *
 * Uses UNLINK (async free) instead of DEL (sync) to avoid blocking the
 * server with large keysets.
 *
 * Use ONLY in tests/tooling. In production, prefer del/delMany.
 *
 * @returns Total number of keys removed
 */
async flushNamespace(): Promise<number> {
  if (process.env['NODE_ENV'] === 'production' && !this.options.allowFlushInProduction) {
    throw new CacheException(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION)
  }

  const client = this.connection.getClient() as Redis
  if (typeof client.scanStream !== 'function') {
    throw new Error('flushNamespace() requires standalone/sentinel mode')
  }

  const pattern = `${this.keyBuilder.getNamespacePrefix()}*`
  const stream = client.scanStream({ match: pattern, count: 1000 })
  let total = 0

  for await (const chunk of stream) {
    const keys = chunk as string[]
    if (keys.length > 0) {
      const removed = await client.unlink(...keys)
      total += removed
    }
  }
  return total
}
```

**Acceptance criteria:**

- [ ] `flushNamespace()` in `NODE_ENV=production` without `allowFlushInProduction` throws `CacheException(FLUSH_DISABLED_IN_PRODUCTION)`
- [ ] `flushNamespace()` in `NODE_ENV=production` with `allowFlushInProduction: true` runs
- [ ] `flushNamespace()` in `NODE_ENV=development` runs without the flag
- [ ] `SCAN` pattern uses `{namespace}:*` (does not touch keys from other namespaces)
- [ ] Returns the total count of removed keys
- [ ] Coverage 95%

**Validation commands:**

```bash
NODE_ENV=production pnpm test src/server/services/cache.service.spec.ts -- -t flushNamespace
NODE_ENV=development pnpm test src/server/services/cache.service.spec.ts -- -t flushNamespace
```

**Dependencies:** §3.4.

**Risks/Notes:**

- ⚠️ `UNLINK` returns a number (not Promise<unknown>) — direct
- ⚠️ Pattern uses wildcard `*` — exact match, in the regex
- ⚠️ In tests, mock `process.env.NODE_ENV` with `jest.replaceProperty` or manual set/restore

### 3.6 Register `CacheService` + `JsonSerializer` in the module

**Objective:** Add the new providers to `BymaxCacheModule.forRoot()` and expose them via `exports`.

**Files to modify:**

```
src/server/bymax-cache.module.ts
```

**Modification:**

```typescript
import { CacheService } from './services/cache.service'
import { JsonSerializer } from './utils/json-serializer'
import { BYMAX_CACHE_SERIALIZER } from './bymax-cache.constants'

// inside forRoot, add to providers:
{ provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer },
CacheService,

// and to exports:
CacheService,
BYMAX_CACHE_SERIALIZER,
```

**Acceptance criteria:**

- [ ] `module.get(CacheService)` returns an instance funcional
- [ ] When `options.serializer` is provided, `CacheService` uses it instead of the injected `JsonSerializer`
- [ ] `BYMAX_CACHE_SERIALIZER` token resolves to `JsonSerializer` when in the custom one is provided

### 3.7 Update `src/server/index.ts` (Phase 2 surface)

**Modification — add exports:**

```typescript
export { CacheService } from './services/cache.service'
export { JsonSerializer } from './utils/json-serializer'
```

### 3.8 Phase 2 tests + Phase 2 validation

**Files to create:**

```
src/server/
├── services/
│   └── cache.service.spec.ts
└── utils/
    └── json-serializer.spec.ts
```

**Critical cases:**

#### `json-serializer.spec.ts`

```typescript
describe('JsonSerializer', () => {
  const s = new JsonSerializer()

  it('should roundtrip primitives', () => {
    expect(s.deserialize<number>(s.serialize(42))).toBe(42)
    expect(s.deserialize<string>(s.serialize('x'))).toBe('x')
    expect(s.deserialize<boolean>(s.serialize(true))).toBe(true)
    expect(s.deserialize<null>(s.serialize(null))).toBeNull()
  })

  it('should roundtrip objects and arrays', () => {
    const v = { a: 1, b: [2, 3], c: { d: null } }
    expect(s.deserialize(s.serialize(v))).toEqual(v)
  })

  it('should throw SERIALIZATION_FAILED on circular reference', () => {
    const a: { self?: unknown } = {}
    a.self = a
    expect(() => s.serialize(a)).toThrow(CacheException)
  })

  it('should throw DESERIALIZATION_FAILED on malformed JSON', () => {
    expect(() => s.deserialize('not json')).toThrow(CacheException)
  })

  it('should include truncated preview in DESERIALIZATION_FAILED details', () => {
    const longBad = 'x'.repeat(200)
    try {
      s.deserialize(longBad)
      fail('should have thrown')
    } catch (e) {
      expect((e as CacheException).details?.['preview']).toMatch(/^x{100}\.\.\.$/)
    }
  })
})
```

#### `cache.service.spec.ts` (estrutura)

```typescript
import IORedisMock from 'ioredis-mock'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class {} }
})

describe('CacheService', () => {
  let cache: CacheService
  let connection: ConnectionManager

  beforeEach(async () => {
    const opts = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(opts)
    await connection.onModuleInit()
    const kb = new KeyBuilder(opts as ResolvedOptions)
    cache = new CacheService(opts as ResolvedOptions, connection, kb)
  })

  afterEach(async () => {
    await connection.onModuleDestroy()
  })

  describe('get/set', () => {
    it('should roundtrip a JSON object', async () => {
      await cache.set('users', 'u_1', { name: 'Alice' })
      expect(await cache.get<{ name: string }>('users', 'u_1')).toEqual({ name: 'Alice' })
    })

    it('should return null for missing key', async () => {
      expect(await cache.get('users', 'missing')).toBeNull()
    })

    it('should apply TTL when provided', async () => {
      await cache.set('users', 'u_1', 'x', 60)
      const ttl = await cache.ttl('users', 'u_1')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    })
  })

  describe('setNx', () => {
    it('should return true on first write', async () => {
      expect(await cache.setNx('p', 'k', 'v')).toBe(true)
    })

    it('should return false on subsequent writes', async () => {
      await cache.setNx('p', 'k', 'v')
      expect(await cache.setNx('p', 'k', 'v2')).toBe(false)
    })
  })

  describe('numeric', () => {
    it('should incr by 1 by default', async () => {
      expect(await cache.incr('c', 'k')).toBe(1)
      expect(await cache.incr('c', 'k')).toBe(2)
    })

    it('should incr by custom step', async () => {
      expect(await cache.incr('c', 'k', 5)).toBe(5)
    })

    it('should decr by custom step', async () => {
      await cache.incr('c', 'k', 10)
      expect(await cache.decr('c', 'k', 3)).toBe(7)
    })
  })

  describe('batch', () => {
    it('should mget multiple keys', async () => {
      await cache.mset('p', [
        ['a', 1],
        ['b', 2]
      ])
      expect(await cache.mget<number>('p', ['a', 'b', 'missing'])).toEqual([1, 2, null])
    })

    it('should return empty array for empty ids', async () => {
      expect(await cache.mget('p', [])).toEqual([])
    })
  })

  describe('hash', () => {
    it('should hset/hget roundtrip', async () => {
      await cache.hset('hp', 'h1', 'name', 'Alice')
      expect(await cache.hget<string>('hp', 'h1', 'name')).toBe('Alice')
    })

    it('should hgetall return deserialized object', async () => {
      await cache.hset('hp', 'h1', 'a', 1)
      await cache.hset('hp', 'h1', 'b', 'x')
      expect(await cache.hgetall<unknown>('hp', 'h1')).toEqual({ a: 1, b: 'x' })
    })
  })

  describe('set', () => {
    it('should sadd/sismember/scard', async () => {
      await cache.sadd('sp', 's1', 'x', 'y', 'z')
      expect(await cache.scard('sp', 's1')).toBe(3)
      expect(await cache.sismember('sp', 's1', 'x')).toBe(true)
      expect(await cache.sismember('sp', 's1', 'missing')).toBe(false)
    })
  })

  describe('flushNamespace', () => {
    it('should remove all keys under namespace', async () => {
      await cache.set('a', '1', 'x')
      await cache.set('b', '1', 'y')
      const removed = await cache.flushNamespace()
      expect(removed).toBeGreaterThanOrEqual(2)
      expect(await cache.get('a', '1')).toBeNull()
    })

    it('should throw FLUSH_DISABLED_IN_PRODUCTION when NODE_ENV=production', async () => {
      const orig = process.env['NODE_ENV']
      process.env['NODE_ENV'] = 'production'
      try {
        await expect(cache.flushNamespace()).rejects.toThrow(CacheException)
      } finally {
        process.env['NODE_ENV'] = orig
      }
    })
  })
})
```

**Acceptance criteria:**

- [ ] 95% coverage on `cache.service.ts`
- [ ] Coverage 100% in `json-serializer.ts`
- [ ] Coverage global ≥ 80%
- [ ] All commands (string/numeric/expire/batch/hash/set/scan) covered
- [ ] `flushNamespace` safety guard tested in both modes (`production` + dev)

**Validation commands (Phase 2):**

```bash
pnpm typecheck
pnpm lint
pnpm test:cov
pnpm build
pnpm size
```

**Smoke test estendido:**

```javascript
// /tmp/cache-smoke-phase2.mjs
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { BymaxCacheModule, CacheService } from './dist/server/index.mjs'

@Module({
  imports: [
    BymaxCacheModule.forRoot({ connection: { url: 'redis://localhost:6379' }, namespace: 'smoke2' })
  ]
})
class App {}

const app = await NestFactory.createApplicationContext(App, { logger: false })
const cache = app.get(CacheService)

await cache.set('users', 'u_1', { name: 'Alice', age: 30 })
const user = await cache.get('users', 'u_1')
console.log('User:', user)

const v = await cache.incr('counters', 'visits')
console.log('Counter:', v)

await cache.flushNamespace()
await app.close()
```

**Done criteria to close Phase 2:**

- [x] Smoke test works against Redis local
- [x] Coverage gates met (100% stmts/branches/funcs/lines, 158 tests)
- [ ] Commits com Conventional Commits (`feat(cache): add JsonSerializer`, `feat(cache): implement CacheService string commands`, etc.) — pending user approval
- [x] `/bymax-quality:code-review` applied (4-lens adversarial workflow; 8 findings applied, 13 rejected)
- [ ] PR `phase-2` — pending user approval

---

## 4. Phase 3 — Pub/Sub + ScriptManager + Health Check

> **Phase objective:** Add advanced capabilities: `PubSubService` (publish/subscribe/psubscribe with lazy subscriber + automatic resubscription on reconnect), `ScriptManagerService` (register Lua, load via `SCRIPT LOAD`, execute via `EVALSHA` with `NOSCRIPT` fallback), health check (`isHealthy/ping/info`) via a method on `CacheService`, and wiring of pre-registered scripts via `options.scripts`. At the end, the lib covers 100% of the spec surface except `forRootAsync` and mutation/e2e.
>
> **Complexity:** MEDIUM.
>
> **Critical paths for 95% coverage:** `src/server/services/pubsub.service.ts`, `src/server/services/script-manager.service.ts`, `src/server/services/cache.service.ts` (eval + health).

### 4.1 `PubSubService` — publish/subscribe/psubscribe

**Objective:** Implement Pub/Sub with a lazily-created subscriber. Publish uses the main client; subscribe opens a dedicated connection via `createSubscriberClient()`.

**Files to create:**

```
src/server/services/pubsub.service.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER } from '../bymax-cache.constants'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { JsonSerializer } from '../utils/json-serializer'
import type { ISerializer } from '../interfaces/serializer.interface'
import type { IPubSubHandler, IPubSubPatternHandler } from '../interfaces/pubsub-handler.interface'
import type { ResolvedOptions } from '../config/resolved-options'

type Unsubscribe = () => Promise<void>

/**
 * Pub/Sub facade over the underlying ioredis subscriber connection.
 *
 * - publish() uses the singleton main client (PUBLISH is a normal command)
 * - subscribe() / psubscribe() create a dedicated subscriber client lazily
 *   (a connection in subscriber mode cannot execute other commands)
 * - Channels are auto-namespaced (`{namespace}{sep}{channel}`)
 * - Reconnection: ioredis re-subscribes channels automatically; messages
 *   published DURING the offline window are LOST (Redis Pub/Sub is
 *   fire-and-forget — see Spec §8.3)
 *
 * @see Spec §8 — Pub/Sub
 */
@Injectable()
export class PubSubService implements OnModuleDestroy {
  private subscriber: Redis | null = null
  private readonly serializer: ISerializer

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager,
    private readonly keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer
  ) {
    this.serializer = options.serializer ?? injectedSerializer ?? new JsonSerializer()
  }

  /**
   * Publishes a message to a namespaced channel.
   *
   * @returns Number of subscribers that received the message
   */
  async publish<T>(channel: string, message: T): Promise<number> {
    const full = this.keyBuilder.applyNamespace(channel)
    const raw = this.serializer.serialize(message)
    return (this.connection.getClient() as Redis).publish(full, raw)
  }

  /**
   * Subscribes to a channel. Creates the subscriber connection lazily.
   *
   * @returns Unsubscribe function that detaches the listener and unsubscribes
   *          from the channel if in the other handlers remain
   */
  async subscribe<T>(channel: string, handler: IPubSubHandler<T>): Promise<Unsubscribe> {
    const full = this.keyBuilder.applyNamespace(channel)
    const sub = this.ensureSubscriber()
    await sub.subscribe(full)

    const listener = async (incoming: string, raw: string): Promise<void> => {
      if (incoming !== full) return
      try {
        const message = this.serializer.deserialize<T>(raw)
        await handler(message)
      } catch {
        // Handler errors must NOT crash the subscriber connection
      }
    }
    sub.on('message', listener)

    return async (): Promise<void> => {
      sub.off('message', listener)
      await sub.unsubscribe(full)
    }
  }

  /**
   * Pattern-subscribes — supports globs like `'users:*'`.
   * Pattern is auto-namespaced.
   */
  async psubscribe<T>(pattern: string, handler: IPubSubPatternHandler<T>): Promise<Unsubscribe> {
    const fullPattern = this.keyBuilder.applyNamespace(pattern)
    const sub = this.ensureSubscriber()
    await sub.psubscribe(fullPattern)

    const listener = async (
      matchedPattern: string,
      channel: string,
      raw: string
    ): Promise<void> => {
      if (matchedPattern !== fullPattern) return
      try {
        const message = this.serializer.deserialize<T>(raw)
        await handler(channel, message)
      } catch {
        // ignored — see subscribe()
      }
    }
    sub.on('pmessage', listener)

    return async (): Promise<void> => {
      sub.off('pmessage', listener)
      await sub.punsubscribe(fullPattern)
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      const sub = this.subscriber
      this.subscriber = null
      try {
        await sub.quit()
      } catch {
        sub.disconnect()
      }
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private ensureSubscriber(): Redis {
    if (this.subscriber && this.subscriber.status === 'ready') return this.subscriber
    if (!this.subscriber) {
      this.subscriber = this.connection.createSubscriberClient() as Redis
    }
    return this.subscriber
  }
}
```

**Acceptance criteria:**

- [ ] `publish()` returns the number de subscribers
- [ ] `subscribe()` creates the subscriber **once** (lazy); subsequent calls reuse it
- [ ] Multiple `subscribe()` calls on distinct channels share the same subscriber
- [ ] Published message reaches the handler with the deserialized payload
- [ ] Error thrown in the handler **does not** crash the subscriber
- [ ] Unsubscribe returned by `subscribe()` disconnects the specific listener
- [ ] `psubscribe('users:*')` receives messages from any matching channel
- [ ] `onModuleDestroy` closes subscriber gracefully
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/pubsub.service.spec.ts
```

**Dependencies:** §2.7 (ConnectionManager.createSubscriberClient), §3.1 (serializer).

**Risks/Notes:**

- ⚠️ `subscriber.status` can be `'reconnecting'` or `'connecting'` — only reuse when `'ready'`
- ⚠️ ioredis emits `'message'` for normal subscriptions and `'pmessage'` for patterns — distinct events
- ⚠️ When the handler is `async`, exceptions do not propagate out of the listener — use try/catch to avoid unhandled rejections
- ⚠️ `ioredis-mock` supports `subscribe`/`publish` but reconnect behavior is limited — deep tests go to E2E

### 4.2 `ScriptManagerService` — register/load/eval com NOSCRIPT fallback

**Objective:** Service that manages Lua scripts — carrega via `SCRIPT LOAD`, caches SHA1, executa via `EVALSHA`, reloads automatically in `NOSCRIPT`.

**Files to create:**

```
src/server/services/script-manager.service.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import { ConnectionManager } from '../connection/connection.manager'
import type { ResolvedOptions } from '../config/resolved-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache-exception'

interface ScriptEntry {
  lua: string
  sha?: string
}

/**
 * Manages Lua scripts: load → cache SHA1 → invoke via EVALSHA.
 *
 * On NOSCRIPT (server FLUSHALL'd the script cache or restarted), the
 * registry transparently reloads and retries the invocation.
 *
 * Scripts can be pre-registered via `options.scripts` and ALSO added
 * dynamically via `register()` (e.g., from another library at runtime).
 *
 * @see Spec §9 — Lua Scripts and ScriptManager
 */
@Injectable()
export class ScriptManagerService implements OnModuleInit {
  private readonly scripts = new Map<string, ScriptEntry>()

  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly connection: ConnectionManager
  ) {
    for (const def of options.scripts ?? []) {
      this.scripts.set(def.name, { lua: def.lua })
    }
  }

  /**
   * Pre-loads all registered scripts at module init.
   * Skipped when `connection.lazyConnect === true` — loading is deferred
   * to the first eval() call in that case.
   */
  async onModuleInit(): Promise<void> {
    if (this.options.connection?.lazyConnect) return
    for (const [name] of this.scripts) {
      await this.load(name)
    }
  }

  /** Registers a new script (or overrides an existing one). */
  register(name: string, lua: string): void {
    this.scripts.set(name, { lua })
  }

  /**
   * Loads the script into Redis if not already cached, and returns its SHA1.
   *
   * @throws CacheException(SCRIPT_NOT_REGISTERED) when name is unknown
   */
  async load(name: string): Promise<string> {
    const entry = this.scripts.get(name)
    if (!entry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    }
    if (!entry.sha) {
      const client = this.connection.getClient() as Redis
      entry.sha = (await client.script('LOAD', entry.lua)) as string
    }
    return entry.sha
  }

  /**
   * Executes a registered Lua script. Uses EVALSHA; on NOSCRIPT, reloads
   * and retries.
   *
   * Caller is responsible for ensuring `keys` are already namespaced
   * (CacheService.eval handles that for consumer-facing usage).
   *
   * @returns Whatever the Lua script returns — typed as unknown because
   *          Redis Lua return values are dynamic
   * @throws CacheException(SCRIPT_NOT_REGISTERED) when name is unknown
   * @throws CacheException(SCRIPT_EXECUTION_FAILED) on Redis-level errors
   */
  async eval(
    name: string,
    keys: readonly string[],
    args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    const entry = this.scripts.get(name)
    if (!entry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    }
    const client = this.connection.getClient() as Redis
    try {
      if (!entry.sha) entry.sha = await this.load(name)
      return await client.evalsha(entry.sha, keys.length, ...keys, ...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOSCRIPT')) {
        // Server cache was flushed — reload and retry once
        entry.sha = (await client.script('LOAD', entry.lua)) as string
        try {
          return await client.evalsha(entry.sha, keys.length, ...keys, ...args)
        } catch (retryErr) {
          throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
            name,
            originalError: retryErr instanceof Error ? retryErr.message : String(retryErr)
          })
        }
      }
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
        name,
        originalError: msg
      })
    }
  }
}
```

**Acceptance criteria:**

- [ ] `register(name, lua)` adds the script to the registry
- [ ] `onModuleInit` pre-loads all scripts (unless `lazyConnect`)
- [ ] `load(name)` calls `SCRIPT LOAD` and caches SHA1
- [ ] `load` is idempotent — repeated calls reuse the cached SHA1
- [ ] `load(unknown)` throws `SCRIPT_NOT_REGISTERED`
- [ ] `eval(name, keys, args)` calls `EVALSHA` com keys.length + spread
- [ ] `eval` on NOSCRIPT reloads via `SCRIPT LOAD` and retries again
- [ ] `eval(unknown)` throws `SCRIPT_NOT_REGISTERED`
- [ ] Real error (not NOSCRIPT) is wrapped as `SCRIPT_EXECUTION_FAILED`
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/script-manager.service.spec.ts
```

**Dependencies:** §2.7.

**Risks/Notes:**

- ⚠️ `ioredis-mock` 8.x **does not** fully support `evalsha`/`script` — some NOSCRIPT tests need to mock `client.evalsha` manually
- ⚠️ `evalsha(sha, numKeys, ...keys, ...args)` — mind the order: first numKeys, then keys, then args
- ⚠️ Retry on NOSCRIPT happens **once**; if the retry fails, it propagates as `SCRIPT_EXECUTION_FAILED`
- ⚠️ Do not log the `lua` source in errors — it may contain sensitive business logic

### 4.3 `CacheService.eval` — delegation to `ScriptManagerService`

**Objective:** Add an `eval` method to `CacheService` that applies the namespace to keys and delegates to `ScriptManagerService`.

**Files to modify:**

```
src/server/services/cache.service.ts
```

**Modification — add `@Optional` dependency:**

```typescript
import { ScriptManagerService } from './script-manager.service'

// constructor:
constructor(
  @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
  private readonly connection: ConnectionManager,
  private readonly keyBuilder: KeyBuilder,
  @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
  @Optional() private readonly scriptRegistry?: ScriptManagerService,
) {
  // ...
}

/**
 * Executes a Lua script registered via ScriptManagerService.
 * Keys are auto-prefixed with namespace before being sent to Redis.
 *
 * @throws CacheException(SCRIPT_REGISTRY_MISSING) if in the scripts are registered
 *
 * @example
 *   const [allowed, remaining] = (await cache.eval(
 *     'rateLimitTokenBucket',
 *     [`rl:${userId}`],
 *     [100, 1, Date.now(), 1],
 *   )) as [number, number]
 */
async eval(
  scriptName: string,
  keys: readonly string[],
  args: ReadonlyArray<string | number>,
): Promise<unknown> {
  if (!this.scriptRegistry) {
    throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
  }
  const prefixedKeys = keys.map((k) => this.keyBuilder.applyNamespace(k))
  return this.scriptRegistry.eval(scriptName, prefixedKeys, args)
}
```

**Acceptance criteria:**

- [ ] `eval` without a registered `ScriptManagerService` throws `SCRIPT_REGISTRY_MISSING`
- [ ] Keys passed to `eval` are namespaced BEFORE reaching the ScriptManager
- [ ] Args are passed without transformation
- [ ] The Lua return value propagates unchanged (type `unknown`)
- [ ] Coverage 95%

### 4.4 `CacheService` — health check (`isHealthy`/`ping`/`info`)

**Objective:** Add health methods to `CacheService`. Useful for `@nestjs/terminus` and `/health` endpoints.

**Files to modify:**

```
src/server/services/cache.service.ts
```

**Modification — add methods:**

```typescript
// ─── Health ──────────────────────────────────────────────────────────────

/**
 * Returns true if Redis responds to PING. Never throws — catches errors
 * internally and returns false. Use for health endpoints.
 */
async isHealthy(): Promise<boolean> {
  try {
    const pong = await this.connection.getClient().ping()
    return pong === 'PONG'
  } catch {
    return false
  }
}

/**
 * Raw PING. Throws on connection failure.
 * @returns 'PONG' on success
 */
async ping(): Promise<string> {
  return this.connection.getClient().ping()
}

/**
 * Returns Redis INFO output. Optionally scoped to a section
 * (e.g., 'memory', 'clients', 'replication').
 */
async info(section?: string): Promise<string> {
  const client = this.connection.getClient() as Redis
  return section ? client.info(section) : client.info()
}
```

**Acceptance criteria:**

- [ ] `isHealthy()` returns `true` when Redis responde `PONG`
- [ ] `isHealthy()` returns `false` when `ping()` throws (does not propagate)
- [ ] `ping()` returns `'PONG'` on a healthy connection
- [ ] `ping()` throws on a closed connection
- [ ] `info()` returns a string with the Redis INFO section
- [ ] `info('memory')` returns only the memory section
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts -- -t health
```

**Risks/Notes:**

- ⚠️ `ioredis-mock` returns `'PONG'` for `ping()` — healthy tests pass through directly
- ⚠️ To test `isHealthy() === false`, mock `getClient().ping` to throw

### 4.5 Register `PubSubService` + `ScriptManagerService` in the module

**Objective:** Add the new services to `BymaxCacheModule.forRoot()` and expose them via `exports`. Wiring of pre-registered scripts happens via DI of `ScriptManagerService` (which reads `options.scripts` in the constructor).

**Files to modify:**

```
src/server/bymax-cache.module.ts
```

**Modification:**

```typescript
import { PubSubService } from './services/pubsub.service'
import { ScriptManagerService } from './services/script-manager.service'
import { BYMAX_CACHE_SCRIPT_REGISTRY } from './bymax-cache.constants'

// inside forRoot, add providers:
PubSubService,
ScriptManagerService,
{ provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },

// and to exports:
PubSubService,
ScriptManagerService,
BYMAX_CACHE_SCRIPT_REGISTRY,
```

**Acceptance criteria:**

- [ ] `module.get(PubSubService)` returns an instance funcional
- [ ] `module.get(ScriptManagerService)` returns an instance with pre-registered scripts (when provided)
- [ ] `CacheService.eval` resolve `ScriptManagerService` via DI
- [ ] Coverage 95% in `bymax-cache.module.ts`

### 4.6 Update `src/server/index.ts` (Phase 3 surface)

**Modification — add exports:**

```typescript
export { PubSubService } from './services/pubsub.service'
export { ScriptManagerService } from './services/script-manager.service'
```

### 4.7 Testes of Phase 3 + Phase 3 validation

**Files to create:**

```
src/server/services/
├── pubsub.service.spec.ts
└── script-manager.service.spec.ts
```

**Critical cases:**

#### `pubsub.service.spec.ts`

```typescript
describe('PubSubService', () => {
  let pubsub: PubSubService
  let connection: ConnectionManager

  beforeEach(async () => {
    const opts = applyDefaults({ connection: { host: 'h' }, namespace: 'ps' })
    connection = new ConnectionManager(opts)
    await connection.onModuleInit()
    const kb = new KeyBuilder(opts as ResolvedOptions)
    pubsub = new PubSubService(opts as ResolvedOptions, connection, kb)
  })

  afterEach(async () => {
    await pubsub.onModuleDestroy()
    await connection.onModuleDestroy()
  })

  it('should deliver messages from publish to subscribe', async () => {
    const received: string[] = []
    const off = await pubsub.subscribe<string>('events', async (m) => {
      received.push(m)
    })
    await pubsub.publish('events', 'hello')
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toEqual(['hello'])
    await off()
  })

  it('should not crash subscriber when handler throws', async () => {
    const off = await pubsub.subscribe('events', () => {
      throw new Error('boom')
    })
    await pubsub.publish('events', 'x')
    await new Promise((r) => setTimeout(r, 50))
    // In the assertion needed — test passes if in the unhandled rejection / crash
    await off()
  })

  it('should detach listener via returned unsubscribe', async () => {
    const received: string[] = []
    const off = await pubsub.subscribe<string>('events', async (m) => received.push(m))
    await off()
    await pubsub.publish('events', 'x')
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toEqual([])
  })

  it('should namespace channels', async () => {
    const received: string[] = []
    const sub = pubsub['ensureSubscriber'].call(pubsub) // expose for verification
    sub.on('message', (ch: string) => received.push(ch))
    await pubsub.subscribe('events', async () => {})
    expect(received).toContain('ps:events') // (this is more of a behavioral check)
  })
})
```

#### `script-manager.service.spec.ts`

```typescript
describe('ScriptManagerService', () => {
  let registry: ScriptManagerService
  let connection: ConnectionManager
  let mockClient: { script: jest.Mock; evalsha: jest.Mock }

  beforeEach(async () => {
    mockClient = {
      script: jest.fn().mockResolvedValue('abc123'),
      evalsha: jest.fn().mockResolvedValue(['ok'])
    }
    connection = { getClient: () => mockClient } as never as ConnectionManager
    const opts = applyDefaults({
      connection: { host: 'h' },
      scripts: [{ name: 'cas', lua: 'return 1' }]
    })
    registry = new ScriptManagerService(opts as ResolvedOptions, connection)
  })

  it('should pre-register scripts from options', () => {
    expect(registry['scripts'].has('cas')).toBe(true)
  })

  it('should load script and cache sha', async () => {
    expect(await registry.load('cas')).toBe('abc123')
    expect(mockClient.script).toHaveBeenCalledWith('LOAD', 'return 1')
    // Second call — uses cache
    await registry.load('cas')
    expect(mockClient.script).toHaveBeenCalledTimes(1)
  })

  it('should throw SCRIPT_NOT_REGISTERED for unknown script', async () => {
    await expect(registry.load('missing')).rejects.toThrow(CacheException)
  })

  it('should eval via EVALSHA', async () => {
    await registry.eval('cas', ['k1', 'k2'], ['arg1'])
    expect(mockClient.evalsha).toHaveBeenCalledWith('abc123', 2, 'k1', 'k2', 'arg1')
  })

  it('should reload on NOSCRIPT and retry', async () => {
    mockClient.evalsha
      .mockRejectedValueOnce(new Error('NOSCRIPT In the matching script'))
      .mockResolvedValueOnce(['ok'])
    await registry.load('cas')
    mockClient.script.mockClear()
    const result = await registry.eval('cas', ['k'], [])
    expect(mockClient.script).toHaveBeenCalledWith('LOAD', 'return 1')
    expect(mockClient.evalsha).toHaveBeenCalledTimes(2)
    expect(result).toEqual(['ok'])
  })

  it('should wrap non-NOSCRIPT errors as SCRIPT_EXECUTION_FAILED', async () => {
    mockClient.evalsha.mockRejectedValueOnce(new Error('ERR random'))
    await expect(registry.eval('cas', [], [])).rejects.toThrow(CacheException)
  })

  it('should register dynamically', () => {
    registry.register('new', 'return 2')
    expect(registry['scripts'].has('new')).toBe(true)
  })
})
```

**Acceptance criteria:**

- [ ] Coverage 95% in `pubsub.service.ts` and `script-manager.service.ts`
- [ ] Coverage global ≥ 80%
- [ ] All `eval` paths (success, NOSCRIPT recovery, hard error, missing script) covered
- [ ] PubSub publish→subscribe roundtrip works via `ioredis-mock`

**Validation commands (Phase 3):**

```bash
pnpm typecheck
pnpm lint
pnpm test:cov
pnpm build
pnpm size
```

**Smoke test estendido:**

```javascript
// /tmp/cache-smoke-phase3.mjs
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { BymaxCacheModule, CacheService, PubSubService } from './dist/server/index.mjs'

const COMPARE_AND_SET_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  end
  return 0
`

@Module({
  imports: [
    BymaxCacheModule.forRoot({
      connection: { url: 'redis://localhost:6379' },
      namespace: 'smoke3',
      scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
    })
  ]
})
class App {}

const app = await NestFactory.createApplicationContext(App, { logger: false })
const cache = app.get(CacheService)
const pubsub = app.get(PubSubService)

// Health
console.log('Healthy:', await cache.isHealthy())

// Pub/Sub
const off = await pubsub.subscribe('events', async (m) => console.log('Got:', m))
await pubsub.publish('events', { type: 'created', id: '1' })
await new Promise((r) => setTimeout(r, 100))
await off()

// Lua
await cache.set('counter', 'k', '1')
const swapped = await cache.eval('cas', ['counter:k'], ['1', '2'])
console.log('Swapped:', swapped) // 1
console.log('After:', await cache.get('counter', 'k'))

await app.close()
```

**Done criteria to close Phase 3:**

- [ ] Smoke test works
- [ ] Coverage gates met
- [ ] Commits com Conventional Commits (`feat(cache): add PubSubService`, `feat(cache): add ScriptManagerService with NOSCRIPT fallback`, `feat(cache): add health check methods`)
- [ ] `/bymax-quality:code-review` applied
- [ ] PR `phase-3`

---

## 5. Phase 4 — forRootAsync + E2E + Mutation Baseline

> **Phase objective:** Add `forRootAsync()` for asynchronous configuration (canonical NestJS pattern — useful for resolving `ConfigService.getOrThrow('REDIS_URL')`), assemble the full E2E suite with `ioredis-mock` (unit-fast) **and** Testcontainers (real Redis for cluster/sentinel/reconnection scenarios), validate mutation baseline ≥ 85%, fine-tune end coverage for the release gate (100% on `test:cov:all`).
>
> **Complexity:** HIGH — `forRootAsync` changes the DI wiring (factory provider depends on imports/inject); E2E with Testcontainers requires isolation between specs; mutation testing can reveal weak tests that need reinforcement.

### 5.1 `BymaxCacheModule.forRootAsync()`

**Objective:** Add a static `forRootAsync` method that accepts `useFactory + imports + inject`, runs validation after the factory resolves, and provides everything `forRoot` provides.

**Files to modify:**

```
src/server/bymax-cache.module.ts
```

**Skeleton:**

```typescript
import type {
  BymaxCacheModuleAsyncOptions,
  BymaxCacheModuleOptions,
} from './interfaces/cache-module-options.interface'

// ... inside the class:

/**
 * Asynchronous configuration. Useful when options depend on other modules
 * (e.g., ConfigModule resolving REDIS_URL from environment).
 *
 * @example
 *   BymaxCacheModule.forRootAsync({
 *     imports: [ConfigModule],
 *     inject: [ConfigService],
 *     useFactory: (config: ConfigService) => ({
 *       connection: { url: config.getOrThrow<string>('REDIS_URL') },
 *       namespace: config.get('CACHE_NAMESPACE') ?? 'app',
 *     }),
 *   })
 */
// §0 OVERRIDE (2026-05-30): illustrative skeleton. Per spec §0, implement as
// `static override forRootAsync(options: typeof ASYNC_OPTIONS_TYPE)` on the
// ConfigurableModuleBuilder base and augment `super.forRootAsync(options)`. The
// asyncOptionsProvider logic below (validate + applyDefaults; inject BUILDER_OPTIONS_TOKEN) stays.
static forRootAsync(asyncOptions: BymaxCacheModuleAsyncOptions): DynamicModule {
  // Resolves options eagerly during NestJS factory phase
  const asyncOptionsProvider: Provider = {
    provide: BYMAX_CACHE_OPTIONS,
    useFactory: async (...args: unknown[]) => {
      const userOptions = await asyncOptions.useFactory(...args)
      validateOptions(userOptions)
      return applyDefaults(userOptions)
    },
    inject: asyncOptions.inject ?? [],
  }

  return {
    module: BymaxCacheModule,
    global: asyncOptions.isGlobal ?? true,
    imports: asyncOptions.imports ?? [],
    providers: [
      asyncOptionsProvider,
      {
        provide: BYMAX_CACHE_EVENTS,
        useFactory: (opts: ResolvedOptions) => opts.events ?? null,
        inject: [BYMAX_CACHE_OPTIONS],
      },
      {
        provide: BYMAX_CACHE_SERIALIZER,
        useClass: JsonSerializer,
      },
      ConnectionManager,
      KeyBuilder,
      CacheService,
      PubSubService,
      ScriptManagerService,
      { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder },
      { provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },
    ],
    exports: [
      BYMAX_CACHE_OPTIONS,
      BYMAX_CACHE_KEY_BUILDER,
      BYMAX_CACHE_SCRIPT_REGISTRY,
      ConnectionManager,
      KeyBuilder,
      CacheService,
      PubSubService,
      ScriptManagerService,
    ],
  }
}
```

**Acceptance criteria:**

- [ ] `forRootAsync({ useFactory })` returns a valid `DynamicModule`
- [ ] `useFactory` runs with `inject` dependencies resolved
- [ ] Options validation happens **inside** the factory (after resolve) — not directly in `forRootAsync`
- [ ] `imports` is propagated to the `DynamicModule`
- [ ] `isGlobal` respeitado (default `true`)
- [ ] All the same services/tokens from `forRoot` are provided
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/bymax-cache.module.spec.ts -- -t forRootAsync
```

**Dependencies:** §2.8, §3.6, §4.5.

**Risks/Notes:**

- ⚠️ NestJS pattern: async factory **cannot** return invalid options — validation returns `Promise.reject` which crashes bootstrap (intentional)
- ⚠️ `useExisting` on shared tokens (`BYMAX_CACHE_KEY_BUILDER`, `BYMAX_CACHE_SCRIPT_REGISTRY`) guarantees a shared singleton across subpaths

### 5.2 Refactor `forRoot` para reuso

**Objective:** Eliminate duplication between `forRoot` and `forRootAsync` by extracting the common providers list.

**Files to modify:**

```
src/server/bymax-cache.module.ts
```

**Skeleton (private static helper):**

```typescript
/**
 * Returns the set of providers shared between forRoot and forRootAsync.
 * Excluded: options provider, events provider — those differ per entry point.
 */
private static buildCommonProviders(): Provider[] {
  return [
    { provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer },
    ConnectionManager,
    KeyBuilder,
    CacheService,
    PubSubService,
    ScriptManagerService,
    { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder },
    { provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },
  ]
}

private static buildCommonExports(): unknown[] {
  return [
    BYMAX_CACHE_OPTIONS,
    BYMAX_CACHE_KEY_BUILDER,
    BYMAX_CACHE_SCRIPT_REGISTRY,
    BYMAX_CACHE_SERIALIZER,
    ConnectionManager,
    KeyBuilder,
    CacheService,
    PubSubService,
    ScriptManagerService,
  ]
}
```

`forRoot` and `forRootAsync` then prepend the options/events providers to the result of `buildCommonProviders()`.

**Acceptance criteria:**

- [ ] After the refactor, `forRoot` and `forRootAsync` call the same providers source
- [ ] The exports list is identical across both paths
- [ ] All existing tests keep passing

### 5.3 Suite E2E — `ioredis-mock` para speed + Testcontainers para realismo

**Objective:** Build the end-to-end suite that boots a real NestJS app (`Test.createTestingModule + app.init()`) and exercises the full path. Simple scenarios use `ioredis-mock` (fast, in-memory); scenarios that require real Redis behavior (cluster, reconnect, atomic EVALSHA) use Testcontainers.

**Files to create:**

```
test/
├── fixtures/
│   └── test-cache-app.module.ts
├── cache-service.e2e.spec.ts          # ioredis-mock
├── pubsub-service.e2e.spec.ts          # ioredis-mock
├── script-manager.e2e.spec.ts          # Testcontainers (EVALSHA real)
├── connection-lifecycle.e2e.spec.ts    # Testcontainers (reconnect)
└── helpers/
    ├── start-redis-container.ts        # Wrapper Testcontainers
    └── wait-for-event.ts                # Promisified event listener
```

**Skeleton — `test/helpers/start-redis-container.ts`:**

```typescript
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

/**
 * Boots a Redis 7 container with a random host port. Tests await ready
 * via the container's built-in healthcheck.
 *
 * @returns Container handle + connection URL (consumer responsible for stopping)
 */
export async function startRedisContainer(): Promise<{
  container: StartedTestContainer
  url: string
}> {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--save', ''])
    .start()
  const host = container.getHost()
  const port = container.getMappedPort(6379)
  return { container, url: `redis://${host}:${port}` }
}
```

**Skeleton — `test/script-manager.e2e.spec.ts` (Testcontainers):**

```typescript
import { Test } from '@nestjs/testing'
import type { INestApplicationContext } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { BymaxCacheModule, CacheService } from '../src/server'
import { startRedisContainer } from './helpers/start-redis-container'

const COMPARE_AND_SET_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  end
  return 0
`

describe('ScriptManagerService E2E (real Redis)', () => {
  let app: INestApplicationContext
  let container: Awaited<ReturnType<typeof startRedisContainer>>['container']
  let cache: CacheService

  beforeAll(async () => {
    const r = await startRedisContainer()
    container = r.container

    @Module({
      imports: [
        BymaxCacheModule.forRoot({
          connection: { url: r.url },
          namespace: 'e2e',
          scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
        })
      ]
    })
    class App {}

    const module = await Test.createTestingModule({ imports: [App] }).compile()
    app = await module.createNestApplicationContext()
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app.close()
    await container.stop()
  })

  it('should execute Lua script atomically (compare and set)', async () => {
    await cache.set('counter', 'k', '1')
    const result = await cache.eval('cas', ['counter:k'], ['1', '2'])
    expect(result).toBe(1)
    expect(await cache.get('counter', 'k')).toBe('2')
  })

  it('should reload script on NOSCRIPT after server FLUSHALL', async () => {
    await cache.set('counter', 'k', '5')
    // FLUSHALL via raw client (escape hatch)
    await cache.getClient().script('FLUSH')
    // Next eval should reload transparently
    const result = await cache.eval('cas', ['counter:k'], ['5', '6'])
    expect(result).toBe(1)
  })
})
```

**Acceptance criteria:**

- [ ] 4+ e2e specs, each isolated (afterAll closes app + container)
- [ ] `pnpm test:e2e` passa
- [ ] Testcontainers boota Redis in < 30s
- [ ] `ioredis-mock` specs rodam in < 5s total
- [ ] Scenarios covered: get/set roundtrip, mset/mget batch, Pub/Sub publish→subscribe, ScriptManager EVALSHA + NOSCRIPT recovery, graceful shutdown

**Validation commands:**

```bash
pnpm test:e2e
```

**Dependencies:** Phases 1-3 complete.

**Risks/Notes:**

- ⚠️ Testcontainers requires an active Docker daemon — CI workflows need `services.docker` or `actions/setup-docker`
- ⚠️ `jest.e2e.config.ts` needs `testTimeout: 60000` for the container boot
- ⚠️ Isolation between specs: each describe boots its own container (slow but deterministic) OR shares one via `globalSetup` (fast but requires careful cleanup). Recommend **one container per describe** for Phase 4.

### 5.4 Coverage 100% (release gate)

**Objective:** Achieve 100% coverage on `test:cov:all` (which uses `jest.coverage.config.ts` with raised thresholds). Focus on paths not covered by the unit tests.

**Commands:**

```bash
pnpm test:cov:all
```

**Áreas tipicamente faltando after Phases 1-3:**

- Branches in `parseRedisUrl` (URL sem username, sem password, etc.)
- Rare error paths in `ConnectionManager` (cluster without `options`, `quit` resolving within the timeout)
- `flushNamespace` in cluster mode (throw branch)
- `eval` retry on NOSCRIPT — second error path

**Acceptance criteria:**

- [ ] `jest.coverage.config.ts` thresholds atingidos: statements 100%, branches 100%, functions 100%, lines 100%
- [ ] Genuinely impossible branches ignored via `/* istanbul ignore next */` with a comment explaining why

### 5.5 Mutation testing baseline (Stryker)

**Objective:** Establish a mutation score baseline ≥ 85%. Not a CI gate, but run once at the end of Phase 4 to identify weak tests.

**Commands:**

```bash
pnpm mutation:dry-run  # first, confirm the config is OK
pnpm mutation           # full run, ~10-20 min
```

**Expected output:** `reports/mutation/mutation.html` + `reports/stryker-incremental.json`.

**Acceptance criteria:**

- [ ] Mutation score ≥ 85% global
- [ ] Mutation score ≥ 95% in paths critical identificados (`parseRedisUrl`, `KeyBuilder`, `ScriptManagerService.eval`, `CacheService.set/get`)
- [ ] Mutantes "equivalent" documentados inline with `// Stryker disable next-line <Mutator>: <reason>`
- [ ] `docs/mutation_testing_results.md` updated com timestamp + score

**Risks/Notes:**

- ⚠️ Stryker takes 10-20 min in CI — **NEVER** add it to `prepublishOnly` or per-commit CI
- ⚠️ Results may flag tests that verify side effects but not return values — reinforce with extra assertions
- ⚠️ Mutants in `ConditionalExpression` inside `compileRedisOptions` may be equivalent (e.g., swap `??` for `||` for fields where empty string is valid) — document case by case

### 5.6 Phase 4 validation

**Final commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size && pnpm mutation
```

**Done criteria para fechar Phase 4:**

- [ ] Coverage 100% (release gate)
- [ ] Bundle within budgets (verifiable in §6.5)
- [ ] Mutation score ≥ 85%
- [ ] E2E suite passa (ioredis-mock + Testcontainers)
- [ ] PR `phase-4` aprovado

---

## 6. Phase 5 — Release v0.1.0

> **Phase objective:** Complete documentation, CI workflows, end validation, tag and publication on npm.
>
> **Complexity:** LOW — predominantly mechanical (copy + adapt nest-auth configs, write README from the spec, run the release workflow). Residual risk: fine-tuning bundle budgets once the real `dist/` is measured.

### 6.1 README

**Files to create:**

- `README.md` (~10-15 KB)

**Estrutura (mirrors `nest-auth/README.md`):**

```markdown
<p align="center">badges</p>
<h1 align="center">@bymax-one/nest-cache</h1>

## Overview

## Features

## Subpath Exports

## Quick Start

- Standalone (dev)
- Sentinel (HA)
- Cluster (sharded)
- forRootAsync com ConfigService

## Configuration (link para spec §4)

## Cache API Reference (get/set/incr/scan/hash/set/Pub-Sub/eval)

## Lua Scripts (compareAndSet, rateLimitTokenBucket samples)

## Pub/Sub

## Health Check (terminus integration)

## Custom Serializer (MsgPack example)

## Default Error Codes

## Testing

## Contributing

## License
```

**Acceptance criteria:**

- [ ] 4 complete usage scenarios (copy-pasteable: standalone, sentinel, cluster, async)
- [ ] Badges npm version, CI status, coverage, mutation, scorecard, license
- [ ] Links para SECURITY.md, CHANGELOG.md, spec, plan
- [ ] Table with all `CacheService` methods
- [ ] Example de plug with `@bymax-one/nest-logger` in the `events.onEvent`

### 6.2 CHANGELOG.md

```markdown
# Changelog

## [0.1.0] - 2026-XX-XX

### Added

- Initial release
- ioredis 5 backed CacheService with namespaced typed helpers (get/set/setNx/del/exists/incr/decr/expire/ttl/mget/mset)
- Hash (hget/hset/hgetall/hdel) and Set (sadd/srem/smembers/sismember/scard) commands
- KeyBuilder with configurable namespace + separator
- ISerializer interface with default JsonSerializer
- PubSubService with lazy subscriber connection
- ScriptManagerService with EVALSHA + NOSCRIPT auto-reload
- Standalone / Sentinel / Cluster connection modes
- Graceful shutdown with configurable timeout
- Health check methods (isHealthy / ping / info)
- Connection lifecycle events via ICacheEvents callback
- flushNamespace() with production safety guard
- forRoot() and forRootAsync() module configuration
- Subpath exports: `.` (server) + `./shared`
```

### 6.3 SECURITY.md, CLAUDE.md, AGENTS.md

Copy from `nest-auth/` and adapt name + scope. Specific points for nest-cache:

- **SECURITY.md**: Disclosure policy. State that connection strings and passwords are the consumer's responsibility; the lib never logs credentials.
- **CLAUDE.md**: Quick reference para AI agents. Inclui regras critical (ioredis peer dep, namespace mandatory, in the console.log, `eval` returns `unknown`).
- **AGENTS.md**: Detailed guide (load on demand). Includes usage patterns, integration with `@bymax-one/nest-logger` via `events`, troubleshooting for cluster mode.

### 6.4 CI workflows

Copy and adapt from `nest-auth/.github/workflows/`:

- `ci.yml`
- `codeql.yml`
- `release.yml`
- `scorecard.yml`

**Adaptations:**

- Swap `nest-auth` for `nest-cache` in references
- Add Redis service to `ci.yml` (Testcontainers requires Docker — already present on GitHub-hosted runners):
  ```yaml
  - name: Run E2E tests
    run: pnpm test:e2e
  ```
- Node matrix — already Node 24 in both

### 6.5 Bundle size budgets

**File:** `scripts/check-size.mjs`

```javascript
const BUDGETS = [
  {
    name: 'server (NestJS module + ioredis adapter)',
    path: 'dist/server/index.mjs',
    brotli: 18_000
  },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 2_500 }
]
```

**Acceptance:**

- [ ] `pnpm size` shows `server` < 18 KB brotli, `shared` < 2.5 KB brotli
- [ ] If it exceeds, first confirm via `pnpm build` that `external` is correct (ioredis MUST NOT enter the bundle); adjust the budget only if the expansion is justified

### 6.6 Final mutation testing run

```bash
pnpm mutation
```

- [ ] Score ≥ 90% global, ≥ 95% paths critical
- [ ] Update `docs/mutation_testing_results.md` with timestamp and score

### 6.7 Tag + publish

```bash
# 1. Bump
pnpm version 0.1.0

# 2. Push tag
git push --follow-tags

# 3. release.yml dispara → publica com --provenance
```

**Acceptance:**

- [ ] Tag `v0.1.0` created
- [ ] Workflow `release.yml` verde
- [ ] Package available at `https://www.npmjs.com/package/@bymax-one/nest-cache`
- [ ] Badge "Provenance" aparece in the npm
- [ ] Post-publish smoke test: `pnpm dlx @bymax-one/nest-cache --version` (via consumer fixture)

---

## Appendix A — Dependency Graph

```
                  Phase 1 — Foundation
                          │
                          ▼
            ┌─────────────────────────────┐
            │  ConnectionManager           │ ← §2.7
            │  KeyBuilder                  │ ← §2.6
            │  CacheException + codes      │ ← §2.4
            │  BymaxCacheModule.forRoot    │ ← §2.8
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 2 — CacheService
                      │
            ┌─────────────────────────────┐
            │  ISerializer + JsonSerializer│ ← §3.1
            │  CacheService                │ ← §3.2 — §3.5
            │    string / numeric / hash   │
            │    set / scan / pipeline     │
            │    flushNamespace            │
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 3 — Pub/Sub + Scripts
                      │
            ┌─────────────────────────────┐
            │  PubSubService               │ ← §4.1
            │  ScriptManagerService        │ ← §4.2
            │  CacheService.eval           │ ← §4.3
            │  CacheService health         │ ← §4.4
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 4 — Production-ready
                      │
            ┌─────────────────────────────┐
            │  forRootAsync                │ ← §5.1
            │  E2E suite (mock + TC)       │ ← §5.3
            │  Coverage 100%               │ ← §5.4
            │  Mutation baseline           │ ← §5.5
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 5 — Release
```

---

## Appendix B — Complexity Matrix

| Fase | Sub-step                          | LoC est.          | Complexity | Risk                              |
| ---- | --------------------------------- | ----------------- | ---------- | --------------------------------- |
| 1    | 2.1 Scaffold                      | ~30 LoC + configs | LOW        | Tooling version                   |
| 1    | 2.2 Shared types                  | ~70 LoC           | LOW        | —                                 |
| 1    | 2.3 Interfaces                    | ~150 LoC          | LOW        | —                                 |
| 1    | 2.4 Constants + errors            | ~120 LoC          | LOW        | Mapping HttpStatus correct        |
| 1    | 2.5 parseRedisUrl                 | ~30 LoC           | MEDIUM     | Edge cases URL encoding           |
| 1    | 2.6 KeyBuilder                    | ~45 LoC           | LOW        | —                                 |
| 1    | 2.7 ConnectionManager + defaults  | ~250 LoC          | HIGH       | Lifecycle, retry, multi-mode      |
| 1    | 2.8 Module skeleton               | ~60 LoC           | LOW        | —                                 |
| 1    | 2.9 Tests Phase 1                 | ~700 LoC          | MEDIUM     | Mock ioredis isolated             |
| 2    | 3.1 JsonSerializer                | ~30 LoC           | LOW        | —                                 |
| 2    | 3.2 CacheService (string/numeric) | ~130 LoC          | MEDIUM     | TTL semantics                     |
| 2    | 3.3 CacheService (hash/set)       | ~80 LoC           | LOW        | —                                 |
| 2    | 3.4 CacheService (scan/pipeline)  | ~50 LoC           | MEDIUM     | scanStream async iterator         |
| 2    | 3.5 flushNamespace                | ~30 LoC           | LOW        | Safety guard production           |
| 2    | 3.6 Wire CacheService             | ~10 LoC           | LOW        | —                                 |
| 2    | 3.7 Barrel update                 | ~5 LoC            | LOW        | —                                 |
| 2    | 3.8 Tests Phase 2                 | ~500 LoC          | MEDIUM     | ioredis-mock comprehensive        |
| 3    | 4.1 PubSubService                 | ~120 LoC          | MEDIUM     | Lazy subscriber, listener cleanup |
| 3    | 4.2 ScriptManagerService          | ~100 LoC          | MEDIUM     | NOSCRIPT retry, SHA cache         |
| 3    | 4.3 CacheService.eval             | ~25 LoC           | LOW        | —                                 |
| 3    | 4.4 Health check                  | ~30 LoC           | LOW        | —                                 |
| 3    | 4.5 Wire services                 | ~15 LoC           | LOW        | —                                 |
| 3    | 4.6 Barrel update                 | ~3 LoC            | LOW        | —                                 |
| 3    | 4.7 Tests Phase 3                 | ~400 LoC          | MEDIUM     | Mock EVALSHA/NOSCRIPT paths       |
| 4    | 5.1 forRootAsync                  | ~80 LoC           | MEDIUM     | NestJS async DI pattern           |
| 4    | 5.2 Refator commons               | ~40 LoC           | LOW        | —                                 |
| 4    | 5.3 E2E suite                     | ~600 LoC          | HIGH       | Testcontainers isolation          |
| 4    | 5.4 Coverage 100%                 | gap-filling       | MEDIUM     | Branches escondidas               |
| 4    | 5.5 Mutation baseline             | manual            | MEDIUM     | Mutantes equivalent               |
| 5    | 6.1–6.7 Docs+CI+release           | manual            | LOW        | —                                 |

**Total LoC estimadas (source + tests):** ~3.700 LoC.

---

## Appendix C — Reference Configs (mirror de nest-auth)

| File                      | Fonte para copy (e adaptar)                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`           | [nest-auth/tsconfig.json](/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.json)                        |
| `tsconfig.build.json`     | nest-auth/tsconfig.build.json                                                                                 |
| `tsconfig.server.json`    | nest-auth/tsconfig.server.json                                                                                |
| `tsconfig.e2e.json`       | nest-auth/tsconfig.e2e.json                                                                                   |
| `tsconfig.jest.json`      | nest-auth/tsconfig.jest.json                                                                                  |
| `jest.config.ts`          | nest-auth/jest.config.ts (adaptar moduleNameMapper para 2 subpaths)                                           |
| `jest.coverage.config.ts` | nest-auth/jest.coverage.config.ts (threshold 100% release)                                                    |
| `jest.e2e.config.ts`      | nest-auth/jest.e2e.config.ts (`testTimeout: 60000` para Testcontainers)                                       |
| `jest.stryker.config.ts`  | nest-auth/jest.stryker.config.ts                                                                              |
| `stryker.config.json`     | nest-auth/stryker.config.json (threshold high 95, low 85, break 85)                                           |
| `eslint.config.mjs`       | nest-auth/eslint.config.mjs (remove regras crypto/oauth)                                                      |
| `.prettierrc`             | nest-auth/.prettierrc                                                                                         |
| `.gitignore`              | nest-auth/.gitignore                                                                                          |
| `scripts/check-size.mjs`  | nest-auth/scripts/check-size.mjs (adaptar BUDGETS para 2 entries — server 18 KB brotli, shared 2.5 KB brotli) |
| `.github/workflows/*.yml` | nest-auth/.github/workflows/\*.yml (replace repo name + remove nest-auth-specific steps)                      |
| `README.md` (template)    | nest-auth/README.md (keep structure, replace content for cache)                                               |
| `SECURITY.md`             | nest-auth/SECURITY.md (identical, replace the name)                                                           |
| `CHANGELOG.md`            | template Keep a Changelog                                                                                     |
| `CLAUDE.md`               | nest-auth/CLAUDE.md (adaptar critical rules: ioredis peer, namespace mandatory)                               |
| `AGENTS.md`               | nest-auth/AGENTS.md (carga sob demanda — patterns de cache + Pub/Sub + Lua)                                   |

---

## Appendix D — Glossary and term mapping

| Term                       | Significado neste plan                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **Phase**                  | Cohesive block of functionality delivering a vertical slice of the lib                    |
| **Sub-step**               | §N.M inside a phase — atom that turns into 1+ task in `development_tasks.md`              |
| **Acceptance criteria**    | Binary (yes/no) checklist for closing the sub-step                                        |
| **Validation command**     | Exact command to run to validate acceptance                                               |
| **Done criteria**          | Conjunto agregado de gates para fechar a fase inteira                                     |
| **AAA pattern**            | Arrange/Act/Assert — convention in tests                                                  |
| **TDD red-green-refactor** | Write a failing test → implement the minimum → refactor                                   |
| **Mutation score**         | % of mutations detected by tests (Stryker)                                                |
| **Coverage gate**          | Minimum coverage threshold per file / global                                              |
| **Singleton (client)**     | Uma unique instance do client ioredis principal, shared via DI                            |
| **Subscriber (Redis)**     | Client in dedicated mode for SUBSCRIBE/PSUBSCRIBE (does not run other commands)           |
| **EVALSHA**                | Executes a pre-loaded Lua script by SHA1 (cheaper than sending the source)                |
| **NOSCRIPT**               | Redis error indicating the script is not cached on the server (after FLUSHALL or restart) |
| **SCAN**                   | Cursor-based iteration over keys without blocking the server                              |
| **Sentinel**               | Alta disponibilidade Redis com failover automático de master para slave                   |
| **Cluster**                | Mode sharded com hash slot routing — multi-key commands exigem same slot                  |
| **Pipeline (ioredis)**     | Batch of commands in one round trip (no atomicity — use Lua for that)                     |
| **Lazy connect**           | Connection created only on the first command, not on OnModuleInit                         |
| **Testcontainers**         | Lib for spinning up Docker containers during tests (real Redis, isolated per suite)       |
| **ioredis-mock**           | In-memory ioredis implementation for fast unit tests (no full Cluster/EVALSHA support)    |

---

> **Next phase of this document:** generation of `development_tasks.md` (Layer 3 — tasks executable by AI agent) using this plan as input and the template at [`/bymax-workflow:phase-tasks`](../../../.claude/commands/bymax-workflow/phase-tasks.md).
