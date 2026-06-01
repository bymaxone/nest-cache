# Development Tasks — @bymax-one/nest-cache

> **Version:** 2.0.0
> **Last updated:** 2026-05-31 (Phase 3 complete — PubSub + ScriptManager + Health)
> **Status:** Draft for execution
> **Based on:** [`development_plan.md`](./development_plan.md) + [`technical_specification.md`](./technical_specification.md)
> **Total tasks:** 58

---

## Alignment with the Bymax Lib Standard (2026-05-30)

> These tasks predate the cross-lib standards audit. Apply the **normative overrides in
> [`technical_specification.md`](./technical_specification.md) §0** while executing:
> (1) dynamic module via `ConfigurableModuleBuilder` + `forRoot`/`forRootAsync`;
> (2) peer deps are **NOT** optional; (3) **six** DI tokens (+ `BYMAX_CACHE_SERIALIZER`,
> `BYMAX_CACHE_KEY_BUILDER`); (4) bundle budgets in **KiB brotli** (provisional —
> `14 * 1024` server / `1.5 * 1024` shared in CACHE-005); (5) **no `.gitkeep`** files
> (CACHE-006 corrected below). Where a task conflicts with §0, §0 wins.

---

## 📋 Status Control

| Status      | Task emoji | Dashboard emoji | Description                                      |
| ----------- | ---------- | --------------- | ------------------------------------------------ |
| TODO        | ⬜         | 🔴              | Not started                                      |
| IN_PROGRESS | 🔄         | 🟡              | In progress                                      |
| DONE        | ✅         | 🟢              | Completed and verified (acceptance criteria met) |
| BLOCKED     | 🚫         | ⚪              | Blocked by dependency                            |
| REVIEW      | 👀         | 🔵              | Under review                                     |
| SKIP        | ⏭️         | —               | Skipped (justification required)                 |

## 🤖 Specialist Agents

| Agent                 | When to use                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architect`           | Scaffold, dynamic module, project structure, interfaces, barrel exports, DI wiring                                                                    |
| `general-purpose`     | Initial configs, utility helpers, simple integration, docs, CI workflows                                                                              |
| `typescript-reviewer` | Type design, generics, DTOs, exhaustive checks, type-safe API contracts                                                                               |
| `code-reviewer`       | Quality NestJS patterns, services, providers, interceptors, accumulated code review                                                                   |
| `security-reviewer`   | Connection credentials handling, namespace isolation, production safety guards (flushNamespace)                                                       |
| `database-reviewer`   | Redis-specific expertise: ioredis lifecycle, retry strategy, NOSCRIPT recovery, Pub/Sub semantics, EVALSHA, SCAN iteration, cluster/sentinel topology |
| `tester`              | TDD test cases: unit specs with ioredis-mock, integration mocks, e2e fixtures with Testcontainers, mutation testing baseline                          |

## Progress Summary

> Task execution dashboard. Tasks are defined inline in this file, grouped by phase. When a task agent marks a task done, it MUST update the task header **and** this table.

> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🟢 Done · ⚪ Blocked · 🔵 In Review

> **Overall progress:** 🟡 56 / 58 tasks done (97%)

| #   | Phase                                  | Done / Total | %    | Status |
| --- | -------------------------------------- | ------------ | ---- | ------ |
| 1   | Foundation + Connection Manager        | 15 / 15      | 100% | 🟢     |
| 2   | CacheService + Typed Helpers           | 12 / 12      | 100% | 🟢     |
| 3   | Pub/Sub + ScriptManager + Health       | 12 / 12      | 100% | 🟢     |
| 4   | forRootAsync + E2E + Mutation Baseline | 9 / 9        | 100% | 🟢     |
| 5   | Release v0.1.0                         | 8 / 10       | 80%  | 🟡     |

---

## 🚀 Execution Guidance for AI Agents

> **⚠️ READ THIS SECTION BEFORE EXECUTING ANY TASK**

### Token economy — mandatory rules

1. **DO NOT load this entire file.** Navigate directly to your task ID (e.g., anchor `#cache-014`) via grep or anchor lookup. Use `Read` with `offset` and `limit` if you need to read only the specific task.
2. **DO NOT load `development_plan.md` or `technical_specification.md` in full.** Each task lists "Required reading" with specific sections — read ONLY what is listed.
3. **DO NOT load `nest-auth/*` in full.** When a task references a nest-auth pattern, copy the specific file mentioned, not the entire folder.
4. **DO NOT load `nest-logger/*` in full.** nest-logger is a reference for shared scaffold patterns — read only files explicitly listed.

### Phase execution mode

When invoked via `/bymax-workflow:task phase <N>`:

- The skill resolves all tasks in phase N in topological dependency order
- Executes one at a time (sequential within the phase)
- After each task, validates that `Status: ✅ DONE` was applied
- Phase is complete when **all** tasks in that phase are DONE

### Self-update protocol (mandatory at the end of each task)

When concluding a task successfully (acceptance criteria met + validation commands passing), the agent MUST update this file in **3 places**:

#### 1. Task status (in the task's own header)

```diff
- **Status:** ⬜ TODO
+ **Status:** ✅ DONE
```

#### 2. Progress Summary (the §"Progress Summary" table above)

For the corresponding phase row:

- Increment `Done / Total` numerator by 1
- Recalculate `%` = `(done / total) × 100%` rounded to integer
- Update `Status` emoji: 🔴 if 0%, 🟡 if partial, 🟢 if 100%
- Update the **Overall progress** line above the table

Example (Phase 1, first task complete):

```diff
- | 1  | Foundation + Connection Manager | 0 / 15 | 0% | 🔴 |
+ | 1  | Foundation + Connection Manager | 1 / 15 | 7% | 🟡 |

- > **Overall progress:** 🔴 0 / 58 tasks done (0%)
+ > **Overall progress:** 🔴 1 / 58 tasks done (2%)
```

#### 3. Commit message (Conventional Commits)

```
<type>(<scope>): <subject> (<TASK-ID>)
```

Examples:

- `feat(cache): scaffold package.json and configs (CACHE-001)`
- `test(cache): add unit tests for parseRedisUrl (CACHE-019)`
- `chore(cache): update Progress Summary after CACHE-031`

### Blocking (BLOCKED)

If the task cannot be completed due to dependency failure or external ambiguity:

1. Update `Status: 🚫 BLOCKED`
2. Add inline note: `> **Blocker:** <description>` right below the task header
3. Update dashboard (BLOCKED column +1, TODO -1)
4. **Do not** make a destructive commit

### Validation error

If acceptance criteria fail after implementation:

1. Attempt immediate fix (up to 2 red-green cycles)
2. If it persists, update `Status: 👀 REVIEW` + inline note with the problem
3. Update dashboard

### Reset / replay

To reset a task (revert to TODO):

1. Update `Status: ⬜ TODO`
2. Update dashboard
3. Do not revert code (leave it for a human reviewer to decide)

---

## Phase 1 — Foundation + Connection Manager

> **Phase objective:** Complete scaffold + public contracts (interfaces, types, constants, DI tokens) + `ConnectionManager` with lifecycle (standalone/sentinel/cluster, retry, event listeners) + `KeyBuilder` + `parseRedisUrl` + `CacheException` + minimal synchronous `BymaxCacheModule.forRoot()` (without CacheService yet). At the end, it's possible to install the lib in a NestJS fixture and see the Redis connection opening/closing via `events.onEvent`.
> **Complexity:** MEDIUM.
> **Total:** 15 tasks.

### CACHE-001: Project scaffold — package.json and pnpm init

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** None
- **Agent:** architect

**Description:** Initialize package.json with scope `@bymax-one`, canonical scripts, peer deps (ioredis + NestJS) and `"dependencies": {}` (zero direct deps).

**Required reading** (DO NOT load in full):

- `docs/development_plan.md` §2.1 (Project scaffold — including the complete `package.json` JSON)

**Prompt for the agent:**

> Create `/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/package.json` with the complete structure specified in `docs/development_plan.md` §2.1 "Detail — `package.json` for this phase". Critical fields:
>
> - `"name": "@bymax-one/nest-cache"`, `"version": "0.1.0-alpha.0"`
> - `"type": "module"`, `"sideEffects": false`
> - `"files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"]`
> - `"exports"` with 2 subpaths: `.` and `./shared` (server entry + shared types)
> - `"dependencies": {}` (zero direct deps)
> - `"peerDependencies"`: `@nestjs/common ^11.0.0`, `@nestjs/core ^11.0.0`, `ioredis ^5.0.0`, `reflect-metadata ^0.2.0`
> - `"peerDependenciesMeta"`: `@nestjs/common`, `@nestjs/core`, `reflect-metadata` marked `{ "optional": true }`
> - `"devDependencies"`: NestJS 11.x suite, jest 30, ts-jest 29, stryker 9 + jest-runner + typescript-checker, tsup 8.5, typescript 5.9, eslint 9, prettier 3.8, ioredis 5.4, ioredis-mock 8.9, testcontainers 10.30, @testcontainers/redis 10.30
> - `"scripts"`: build (tsup), lint, test, test:cov, test:e2e, test:cov:all, mutation, typecheck, size, clean, prepublishOnly, release
> - `"packageManager": "pnpm@10.8.1"`, `"engines": { "node": ">=24.0.0" }`
> - `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`
>
> After creation, run `pnpm install` in the root directory. Verify that `pnpm-lock.yaml` is generated without missing peer deps warnings.

**Acceptance criteria:**

- [x] `package.json` created with all the fields above
- [x] `pnpm install` completes without errors or warnings
- [x] `pnpm-lock.yaml` generated
- [x] `node_modules/` created with ioredis + ioredis-mock + @nestjs/\* + testcontainers installed as devDeps

**Validation commands:**

```bash
cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/
pnpm install
node -e "console.log(require('./package.json').name)"  # → @bymax-one/nest-cache
```

**Completion protocol:**

1. Validation commands above pass
2. Update `Status: ⬜ TODO` → `Status: ✅ DONE` in this file
3. Update Progress Dashboard: Phase 1 TODO 15→14, DONE 0→1, Progress 7%; TOTAL TODO 58→57, DONE 0→1, Progress 2%
4. Commit: `feat(cache): scaffold package.json (CACHE-001)`

---

### CACHE-002: Project scaffold — tsconfig + tsup config

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-001
- **Agent:** architect

**Description:** Create `tsconfig.json` + 4 variants (build/server/e2e/jest) and `tsup.config.ts` with 2 entries (server + shared).

**Required reading:**

- `docs/development_plan.md` §2.1 — "Reference content" table and the `tsup.config.ts` skeleton
- Reference files (copy and adapt):
  - `/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.json`
  - `/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.build.json`
  - `/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.server.json`
  - `/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.e2e.json`
  - `/Users/maximiliano/Documents/MyApps/nest-auth/tsconfig.jest.json`

**Prompt for the agent:**

> Copy the 5 `tsconfig.*.json` files from `/Users/maximiliano/Documents/MyApps/nest-auth/` to `/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/`. Adapt the path aliases in `tsconfig.json`:
>
> ```jsonc
> "paths": {
>   "@bymax-one/nest-cache": ["./src/server/index.ts"],
>   "@bymax-one/nest-cache/shared": ["./src/shared/index.ts"]
> }
> ```
>
> (remove the 3 extra paths from nest-auth: `/client`, `/react`, `/nextjs` — nest-cache does not have those subpaths)
>
> Create `tsup.config.ts` with 2 entries as per the skeleton in `docs/development_plan.md` §2.1 "Detail — `tsup.config.ts`". Externals of the server entry: `/^@nestjs\\//`, `reflect-metadata`, `ioredis`. Shared entry without externals (zero deps).

**Acceptance criteria:**

- [x] 5 `tsconfig.*.json` present and path aliases correct (2 subpaths)
- [x] `tsup.config.ts` with 2 entries
- [x] `pnpm typecheck` passes on `src/server/index.ts` and `src/shared/index.ts` placeholders (create empty files with `export {}`)

**Validation commands:**

```bash
echo "export {}" > src/server/index.ts
echo "export {}" > src/shared/index.ts
pnpm typecheck
```

**Completion protocol:**

1. Validation OK
2. `Status: ⬜ TODO` → `Status: ✅ DONE`
3. Dashboard: Phase 1 TODO 14→13, DONE 1→2, Progress 13%; TOTAL 57→56, 1→2, 3%
4. Commit: `feat(cache): add tsconfig and tsup build config (CACHE-002)`

---

### CACHE-003: ESLint + Prettier + .gitignore + .npmignore

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-001
- **Agent:** general-purpose

**Description:** Lint and format configs mirroring nest-auth.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/eslint.config.mjs` (flat config v9)
- `/Users/maximiliano/Documents/MyApps/nest-auth/.prettierrc`
- `/Users/maximiliano/Documents/MyApps/nest-auth/.gitignore`

**Prompt for the agent:**

> Copy `eslint.config.mjs`, `.prettierrc` and `.gitignore` from nest-auth. In `eslint.config.mjs`, remove specific rules for folders that nest-cache does NOT have (`oauth/`, `crypto/`, `nextjs/`, `react/`). Keep:
>
> - `@typescript-eslint/no-explicit-any` (error) — in the exceptions in this project
> - `eslint-plugin-security` (recommended) — relevant for Redis (injection patterns)
> - `eslint-plugin-import` (order, no-cycle)
> - `eslint-config-prettier` at the end
>
> Verify that `pnpm lint` passes in a directory with `src/server/index.ts` and `src/shared/index.ts` only (`export {}`).

**Acceptance criteria:**

- [x] `eslint.config.mjs` adapted (no oauth/crypto/nextjs/react rules)
- [x] `.prettierrc` identical to the nest-auth one
- [x] `.gitignore` covering node_modules, dist, coverage, reports, .stryker-tmp
- [x] `pnpm lint` passes

**Validation commands:**

```bash
pnpm lint
```

**Completion protocol:**

1. Lint passes
2. `Status: ⬜ TODO` → `✅ DONE`
3. Dashboard: Phase 1 13→12, DONE 2→3, Progress 20%; TOTAL 56→55, 2→3, 5%
4. Commit: `chore(cache): add eslint, prettier and gitignore (CACHE-003)`

---

### CACHE-004: Jest configs (4 variants) + Stryker config

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-002
- **Agent:** general-purpose

**Description:** `jest.config.ts` + `jest.coverage.config.ts` (100% release gate) + `jest.e2e.config.ts` (testTimeout 60s for Testcontainers) + `jest.stryker.config.ts` + `stryker.config.json`.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/jest.config.ts`
- `/Users/maximiliano/Documents/MyApps/nest-auth/jest.coverage.config.ts`
- `/Users/maximiliano/Documents/MyApps/nest-auth/jest.e2e.config.ts`
- `/Users/maximiliano/Documents/MyApps/nest-auth/jest.stryker.config.ts`
- `/Users/maximiliano/Documents/MyApps/nest-auth/stryker.config.json`

**Prompt for the agent:**

> Copy the 5 Jest/Stryker files from nest-auth. Mandatory adaptations:
>
> In `jest.config.ts`:
>
> - `moduleNameMapper`: 2 entries instead of 5
>   ```typescript
>   '^@bymax-one/nest-cache$': '<rootDir>/server/index.ts',
>   '^@bymax-one/nest-cache/shared$': '<rootDir>/shared/index.ts',
>   ```
> - `coverageThreshold`: global 80/80/80/80; **critical paths 95%**: `./src/server/connection/connection.manager.ts`, `./src/server/utils/parse-redis-url.ts`, `./src/server/utils/key-builder.ts`, `./src/server/config/default-options.ts`, `./src/server/services/cache.service.ts`, `./src/server/services/script-manager.service.ts`
>
> In `jest.coverage.config.ts`:
>
> - Same moduleNameMapper
> - Global `coverageThreshold`: 100% (release gate)
>
> In `jest.e2e.config.ts`:
>
> - `rootDir: 'test'`
> - `testTimeout: 60_000` (Testcontainers takes ~30s to boot Redis)
>
> In `stryker.config.json`: thresholds `high 95, low 85, break 85`. Keep plugins jest-runner + typescript-checker.

**Acceptance criteria:**

- [x] 5 files created with adaptations
- [x] `pnpm test` runs (with `passWithNoTests: process.env['CI'] !== 'true'`)
- [x] `pnpm test:cov` runs without errors
- [x] `pnpm mutation:dry-run` validates config without running mutants

**Validation commands:**

```bash
pnpm test
pnpm test:cov
pnpm mutation:dry-run
```

**Completion protocol:**

1. Validations OK
2. `Status` → DONE
3. Dashboard: Phase 1 12→11, DONE 3→4, Progress 27%; TOTAL 55→54, 3→4, 7%
4. Commit: `chore(cache): add jest and stryker configs (CACHE-004)`

---

### CACHE-005: scripts/check-size.mjs (zero-deps bundle size gate)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-002
- **Agent:** general-purpose

**Description:** Native Node script (zero deps) that validates brotli size for each subpath.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/scripts/check-size.mjs`
- `docs/development_plan.md` §6.5 (budgets for nest-cache)

**Prompt for the agent:**

> Copy `scripts/check-size.mjs` from nest-auth to nest-cache. Adapt the `BUDGETS` constant for 2 entries:
>
> ```javascript
> const BUDGETS = [
>   // KiB brotli (`n * 1024`) — same unit as the display. Provisional; recalibrate to the real artifact (spec §0).
>   { name: 'server (NestJS module)', path: 'dist/server/index.mjs', brotli: 14 * 1024 },
>   { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 1.5 * 1024 }
> ]
> ```
>
> Justification: server entry with NestJS module + ConnectionManager + CacheService + PubSubService + ScriptManagerService + KeyBuilder + utils ≈ ~14-17KB brotli (ioredis externalized); shared is only types + constants (~2KB).
>
> Keep `node:zlib` brotli max quality, `node:fs`, `node:url`, `node:path` only. **Zero external deps** (already protected — script runs on CI).

**Acceptance criteria:**

- [x] `scripts/check-size.mjs` created
- [x] Runs via `pnpm size` (after build) and reports the 2 subpaths
- [x] Fails with exit code 1 if subpath exceeds brotli budget

**Validation commands:**

```bash
# After the first build in phase 5, validate:
pnpm build && pnpm size
```

**Completion protocol:**

1. Script created and executable
2. `Status` → DONE
3. Dashboard: Phase 1 11→10, DONE 4→5, Progress 33%; TOTAL 54→53, 4→5, 9%
4. Commit: `chore(cache): add bundle size check script (CACHE-005)`

---

### CACHE-006: Initial folder structure (src/server and src/shared)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-002
- **Agent:** general-purpose

**Description:** Create all folders for `src/server/` and `src/shared/` as per the spec's canonical tree.

**Required reading:**

- `docs/technical_specification.md` §3.1 (full directory tree)
- `docs/development_plan.md` §1.5 (expected end structure)

**Prompt for the agent:**

> Create the directory structure in `/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/src/`:
>
> ```
> src/
> ├── server/
> │   ├── services/
> │   ├── connection/
> │   ├── interfaces/
> │   ├── constants/
> │   ├── config/
> │   ├── errors/
> │   ├── utils/
> │   └── index.ts       # only `export {}`
> └── shared/
>     ├── types/
>     ├── constants/
>     └── index.ts       # only `export {}`
> ```
>
> **No `.gitkeep` files** (project rule — spec §0): folders materialize with their real files in
> the following tasks; do not commit placeholder markers. Create `test/e2e/` when its first spec
> lands (Phase 4). Verify that `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and
> `dist/shared/index.{mjs,cjs,d.ts}` even with the minimal `export {}` source (tests tsup config).

**Acceptance criteria:**

- [x] The 7 `src/server/` folders and 2 `src/shared/` folders exist (materialized by their real files in later tasks — **no `.gitkeep`**, per spec §0)
- [x] `src/server/index.ts` and `src/shared/index.ts` with `export {}`
- [x] **No `.gitkeep` files created anywhere** (project rule — spec §0)
- [x] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}`

**Validation commands:**

```bash
find src -type d | sort
pnpm build
ls dist/server/ dist/shared/
```

**Completion protocol:**

1. Validations OK
2. `Status` → DONE
3. Dashboard: Phase 1 10→9, DONE 5→6, Progress 40%; TOTAL 53→52, 5→6, 10%
4. Commit: `chore(cache): scaffold src directory structure (CACHE-006)`

---

### CACHE-007: Shared types (CacheEventName, CacheConnectionStatus, CacheNamespace, SerializableValue)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-006
- **Agent:** typescript-reviewer

**Description:** Define public types in `src/shared/types/` — zero deps.

**Required reading:**

- `docs/development_plan.md` §2.2 (Shared types — complete skeletons)

**Prompt for the agent:**

> Create the files as per the skeletons in `docs/development_plan.md` §2.2:
>
> 1. `src/shared/types/cache-event.types.ts` — exports `CacheEventName` (union literal `'connect' | 'ready' | 'error' | 'close' | 'reconnecting' | 'end'`) and `CacheConnectionStatus` (`'wait' | 'connecting' | 'connect' | 'ready' | 'reconnecting' | 'end'`) with JSDoc referencing spec §11.2
> 2. `src/shared/types/cache-config.types.ts` — exports `CacheNamespace = string` and `CacheKeyPrefix = string` with JSDoc + `@example` for each typical use
> 3. `src/shared/types/serializable-value.types.ts` — recursive type `SerializableValue = string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue }` with JSDoc explaining that `Date`, `Map`, `Set`, `BigInt`, `undefined` are NOT included (require a custom serializer)
>
> Apply strict rules:
>
> - JSDoc with `@example` where useful
> - `import type` on all imports of other types
> - **No `any`** in any signature
> - English in all code and JSDoc

**Acceptance criteria:**

- [x] 3 files created with complete JSDoc
- [x] Zero `any` (verifiable with `grep -n ': any\\b' src/shared/`)
- [x] `import type` used where applicable
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
grep -rn ': any\b\|any\[\]' src/shared/ && echo "FAIL: any found" || echo "OK"
```

**Completion protocol:**

1. Validations OK
2. `Status` → DONE
3. Dashboard: Phase 1 9→8, DONE 6→7, Progress 47%; TOTAL 52→51, 6→7, 12%
4. Commit: `feat(cache): add shared types (CACHE-007)`

---

### CACHE-008: Shared constants (CACHE_ERROR_CODES, CACHE_EVENT_NAMES)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-006
- **Agent:** typescript-reviewer

**Description:** Public constants in `src/shared/constants/` — stable error codes and canonical event names.

**Required reading:**

- `docs/development_plan.md` §2.2 (skeletons for error-codes.ts and event-names.ts)
- `docs/technical_specification.md` §12.2 (Codes Table)

**Prompt for the agent:**

> Create:
>
> 1. `src/shared/constants/error-codes.ts` — exports `CACHE_ERROR_CODES` as `const ... as const` with **14 keys** (format `cache.<scope>_<reason>`):
>    - CONNECTION_FAILED, COMMAND_TIMEOUT, CONNECTION_LOST
>    - SERIALIZATION_FAILED, DESERIALIZATION_FAILED
>    - INVALID_NAMESPACE, INVALID_KEY
>    - SCRIPT_NOT_REGISTERED, SCRIPT_EXECUTION_FAILED, SCRIPT_REGISTRY_MISSING
>    - FLUSH_DISABLED_IN_PRODUCTION
>    - CLUSTER_MISCONFIGURED, SENTINEL_MISCONFIGURED
>    - SHUTDOWN_TIMEOUT
>      Also export `type CacheErrorCode = (typeof CACHE_ERROR_CODES)[keyof typeof CACHE_ERROR_CODES]`.
> 2. `src/shared/constants/event-names.ts` — exports `CACHE_EVENT_NAMES` `as const` mirroring the `CacheEventName` type (CONNECT, READY, ERROR, CLOSE, RECONNECTING, END).
>
> Update `src/shared/index.ts`:
>
> ```typescript
> // Types
> export type { CacheEventName, CacheConnectionStatus } from './types/cache-event.types'
> export type { CacheNamespace, CacheKeyPrefix } from './types/cache-config.types'
> export type { SerializableValue } from './types/serializable-value.types'
>
> // Constants
> export { CACHE_ERROR_CODES } from './constants/error-codes'
> export type { CacheErrorCode } from './constants/error-codes'
> export { CACHE_EVENT_NAMES } from './constants/event-names'
> ```

**Acceptance criteria:**

- [x] 2 constant files created
- [x] `CACHE_ERROR_CODES` exported `as const` with 14 entries
- [x] `CacheErrorCode` type derived
- [x] `src/shared/index.ts` updated
- [x] `pnpm build` produces `dist/shared/index.{mjs,cjs,d.ts}` listing all exports

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m).sort()))"
# Expected: ['CACHE_ERROR_CODES', 'CACHE_EVENT_NAMES']
```

**Completion protocol:**

1. node output shows 2 exports + types
2. `Status` → DONE
3. Dashboard: Phase 1 8→7, DONE 7→8, Progress 53%; TOTAL 51→50, 7→8, 14%
4. Commit: `feat(cache): add shared constants (CACHE-008)`

---

### CACHE-009: Server interfaces (BymaxCacheModuleOptions + sub-interfaces + ICacheEvents + ISerializer + IScriptDefinition + IPubSubHandler)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-007

- **Agent:** typescript-reviewer

**Description:** 5 interface files + barrel `index.ts` in `src/server/interfaces/`.

**Required reading:**

- `docs/development_plan.md` §2.3 (complete interface skeletons)
- `docs/technical_specification.md` §4 (full options reference)

**Prompt for the agent:**

> Create in `src/server/interfaces/`:
>
> 1. `cache-module-options.interface.ts` — exports:
>    - `BymaxCacheStandaloneConnection` (url?, host?, port?, password?, db?, username?, tls?, lazyConnect?, connectTimeout?, commandTimeout?, maxRetriesPerRequest?, enableReadyCheck?, enableOfflineQueue?, retryStrategy?, reconnectOnError?, keepAlive?, noDelay?, family?)
>    - `BymaxCacheSentinelConnection` (sentinels, name, sentinelPassword?, password?, role?)
>    - `BymaxCacheClusterConnection` (nodes, options?)
>    - `BymaxCacheModuleOptions` (mode?, connection?, sentinel?, cluster?, namespace?, keySeparator?, serializer?, events?, shutdownTimeoutMs?, allowFlushInProduction?, isGlobal?, scripts?)
>    - `BymaxCacheModuleAsyncOptions` (imports?, inject?, useFactory, isGlobal?)
>    - Re-export ioredis types: `ClusterNode`, `ClusterOptions`, `RedisOptions`, `SentinelAddress`
> 2. `cache-events.interface.ts` — `ICacheEvents` with `onEvent?: (event: CacheEventName, data: Record<string, unknown>) => void`. Document that callbacks must be fast + non-blocking; exceptions are swallowed by the ConnectionManager.
> 3. `serializer.interface.ts` — `ISerializer` with `serialize<T>(value: T): string` + `deserialize<T>(raw: string): T`. Document that implementations MUST be deterministic and MUST throw on malformed input (not return partial undefined).
> 4. `script-definition.interface.ts` — `IScriptDefinition` with `name: string` + `lua: string`. JSDoc explaining the cycle register → SCRIPT LOAD → EVALSHA → NOSCRIPT fallback.
> 5. `pubsub-handler.interface.ts` — `IPubSubHandler<T>` and `IPubSubPatternHandler<T>` (callback signatures with message and channel).
>
> Create `src/server/interfaces/index.ts` exporting the 10+ types via `export type { ... }`.
>
> **Zero `any` in any signature.** `readonly` on immutable properties (consistent with `exactOptionalPropertyTypes`).

**Acceptance criteria:**

- [x] 5 interface files + barrel `index.ts`
- [x] All fields documented via JSDoc
- [x] `import type` used for all external types (ioredis, @nestjs/common)
- [x] Zero `any`
- [x] ioredis re-exports (`ClusterNode`, `RedisOptions`, etc.) accessible
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
grep -n ': any\b\|any\[\]' src/server/interfaces/ && echo "FAIL" || echo "OK"
```

**Completion protocol:**

1. Typecheck OK; zero `any`
2. `Status` → DONE
3. Dashboard: Phase 1 7→6, DONE 8→9, Progress 60%; TOTAL 50→49, 8→9, 16%
4. Commit: `feat(cache): add server interfaces (CACHE-009)`

---

### CACHE-010: DI tokens (Symbol-based) + default constants

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-006
- **Agent:** architect

**Description:** Injection symbols avoiding collision + numeric defaults.

**Required reading:**

- `docs/development_plan.md` §2.4 (complete skeletons)
- `docs/technical_specification.md` §4.4 (injection tokens)

**Prompt for the agent:**

> Create 3 files:
>
> 1. `src/server/bymax-cache.constants.ts` — DI tokens:
>    ```typescript
>    export const BYMAX_CACHE_OPTIONS = Symbol('BYMAX_CACHE_OPTIONS')
>    export const BYMAX_CACHE_CONNECTION = Symbol('BYMAX_CACHE_CONNECTION')
>    export const BYMAX_CACHE_SCRIPT_REGISTRY = Symbol('BYMAX_CACHE_SCRIPT_REGISTRY')
>    export const BYMAX_CACHE_EVENTS = Symbol('BYMAX_CACHE_EVENTS')
>    export const BYMAX_CACHE_SERIALIZER = Symbol('BYMAX_CACHE_SERIALIZER')
>    export const BYMAX_CACHE_KEY_BUILDER = Symbol('BYMAX_CACHE_KEY_BUILDER')
>    ```
>    With JSDoc explaining the reason for Symbol (avoid collision with strings) — pattern inherited from `@bymax-one/nest-auth`.
> 2. `src/server/constants/default-namespace.ts` — `DEFAULT_NAMESPACE = 'app' as const`, `DEFAULT_KEY_SEPARATOR = ':' as const`.
> 3. `src/server/constants/default-timeouts.ts` — `DEFAULT_CONNECT_TIMEOUT_MS = 10_000`, `DEFAULT_COMMAND_TIMEOUT_MS = 5_000`, `DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000`, `DEFAULT_MAX_RETRIES_PER_REQUEST = 3`, `MIN_SHUTDOWN_TIMEOUT_MS = 100`, `MIN_CONNECT_TIMEOUT_MS = 100`.

**Acceptance criteria:**

- [x] 6 Symbols exported in `bymax-cache.constants.ts`
- [x] Explanatory JSDoc on each Symbol
- [x] Each Symbol is unique (`SYMBOL_A !== SYMBOL_B`)
- [x] `default-namespace.ts` and `default-timeouts.ts` created
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 1 6→5, DONE 9→10, Progress 67%; TOTAL 49→48, 9→10, 17%
4. Commit: `feat(cache): add DI tokens and default constants (CACHE-010)`

---

### CACHE-011: CacheException + cache-error-codes (server-side messages + HTTP status mapping)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-008
- **Agent:** code-reviewer

**Description:** `CacheException extends HttpException` class with `code → HttpStatus` mapping + human-readable English messages.

**Required reading:**

- `docs/development_plan.md` §2.4 (skeletons for cache-error-codes.ts and cache-exception.ts)
- `docs/technical_specification.md` §12.2 (table of when each code is thrown)

**Prompt for the agent:**

> Create 2 files:
>
> 1. `src/server/errors/cache-error-codes.ts`:
>    - Re-export `CACHE_ERROR_CODES` and `CacheErrorCode` from `'../../shared/constants/error-codes'`
>    - Export `CACHE_ERROR_MESSAGES: Record<CacheErrorCode, string>` with English message for each code (14 entries, as per the skeleton in plan §2.4)
> 2. `src/server/errors/cache-exception.ts`:
>    - Import `HttpException, HttpStatus` from `'@nestjs/common'`
>    - Internal constant `STATUS_BY_CODE: Record<CacheErrorCode, HttpStatus>` mapping each code to HTTP status:
>      - CONNECTION_FAILED, SERIALIZATION_FAILED, DESERIALIZATION_FAILED, INVALID_NAMESPACE, SCRIPT_NOT_REGISTERED, SCRIPT_EXECUTION_FAILED, SCRIPT_REGISTRY_MISSING, CLUSTER_MISCONFIGURED, SENTINEL_MISCONFIGURED, SHUTDOWN_TIMEOUT → 500
>      - COMMAND_TIMEOUT → 504
>      - CONNECTION_LOST → 503
>      - INVALID_KEY → 400
>      - FLUSH_DISABLED_IN_PRODUCTION → 403
>    - Class `CacheException extends HttpException` with:
>      - `readonly code: CacheErrorCode`
>      - `readonly details: Record<string, unknown> | null`
>      - Constructor `(code, details?, overrideStatus?)`
>      - Super-call payload: `{ error: { code, message, details: details ?? null } }`

**Acceptance criteria:**

- [x] 2 files created
- [x] `CACHE_ERROR_MESSAGES[code]` covers 100% of the 14 codes
- [x] `CacheException.code` and `.details` accessible without cast
- [x] Correct HttpStatus per code
- [x] `instanceof CacheException` returns true in catch blocks
- [x] Payload format `{ error: { code, message, details } }`
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 1 5→4, DONE 10→11, Progress 73%; TOTAL 48→47, 10→11, 19%
4. Commit: `feat(cache): add CacheException with HTTP status mapping (CACHE-011)`

---

### CACHE-012: parseRedisUrl + KeyBuilder (critical path)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-009, CACHE-010, CACHE-011
- **Agent:** database-reviewer

**Description:** Utility `parseRedisUrl` (support for `redis://` + `rediss://` + URL-encoded credentials + db) + `KeyBuilder` class (namespace strategy `{ns}:{prefix}:{id}`).

**Required reading:**

- `docs/development_plan.md` §2.5 (parse-redis-url.ts skeleton)
- `docs/development_plan.md` §2.6 (key-builder.ts skeleton)
- `docs/technical_specification.md` §7 (Namespace Strategy)

**Prompt for the agent:**

> Create 2 files:
>
> 1. `src/server/utils/parse-redis-url.ts` — pure function `parseRedisUrl(url: string): Partial<RedisOptions>` that:
>    - Uses global `URL` constructor (Node 24 native)
>    - Supports `redis:` (plain) and `rediss:` (TLS — sets empty `tls: {}`) protocols
>    - Extracts `host` (default `'localhost'`), `port` (default `6379`), `username`, `password` (with `decodeURIComponent`)
>    - Extracts `db` from the pathname (only if it's `\d+`)
>    - Throws `Error` on unsupported protocol or malformed URL
> 2. `src/server/utils/key-builder.ts` — `@Injectable() KeyBuilder` class:
>    - Constructor injects `@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions` (note: ResolvedOptions does not exist yet — use `BymaxCacheModuleOptions` temporarily; CACHE-014 will update to ResolvedOptions)
>    - `build(prefix: string, id: string): string` — returns `{ns}{sep}{prefix}{sep}{id}`. Throws `CacheException(INVALID_KEY)` on empty prefix/id.
>    - `applyNamespace(keyWithoutNamespace: string): string` — returns `{ns}{sep}{keyWithoutNamespace}`. Throws on empty key.
>    - `getNamespacePrefix(): string` — returns `{ns}{sep}` (for SCAN patterns).
>
> TEMPORARY NOTE: for now `KeyBuilder` accepts `BymaxCacheModuleOptions` (reads `namespace ?? 'app'`, `keySeparator ?? ':'`). In CACHE-014 we will switch to `ResolvedOptions`.

**Acceptance criteria:**

- [x] `parseRedisUrl('redis://localhost:6379')` returns `{ host, port }`
- [x] `parseRedisUrl('rediss://...')` includes `tls: {}`
- [x] User + password decoded when URL-encoded
- [x] Database extracted from pathname
- [x] Unsupported protocol throws Error
- [x] `KeyBuilder.build('users', 'u_1')` returns `'app:users:u_1'` with defaults
- [x] `KeyBuilder.build('', 'u_1')` throws `CacheException(INVALID_KEY)`
- [x] `KeyBuilder.applyNamespace('rl:u_1')` returns `'app:rl:u_1'`
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 1 4→3, DONE 11→12, Progress 80%; TOTAL 47→46, 11→12, 21%
4. Commit: `feat(cache): add parseRedisUrl and KeyBuilder utilities (CACHE-012)`

---

### CACHE-013: ResolvedOptions + applyDefaults + validateOptions

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-009, CACHE-010, CACHE-011
- **Agent:** typescript-reviewer

**Description:** `ResolvedOptions` type (defaults applied) + `applyDefaults` function (merge + freeze) + `validateOptions` function (throws with CacheException codes).

**Required reading:**

- `docs/development_plan.md` §2.7 (skeletons for resolved-options.ts and default-options.ts)
- `docs/technical_specification.md` §4.6 (initialization validation)

**Prompt for the agent:**

> Create 2 files:
>
> 1. `src/server/config/resolved-options.ts`:
>    ```typescript
>    export type ResolvedOptions = Required<
>      Pick<
>        BymaxCacheModuleOptions,
>        'namespace' | 'keySeparator' | 'shutdownTimeoutMs' | 'allowFlushInProduction' | 'isGlobal'
>      >
>    > &
>      Pick<
>        BymaxCacheModuleOptions,
>        'mode' | 'connection' | 'sentinel' | 'cluster' | 'serializer' | 'events' | 'scripts'
>      >
>    ```
> 2. `src/server/config/default-options.ts`:
>    - `validateOptions(options: BymaxCacheModuleOptions): void` — validates:
>      - `mode === 'sentinel'` → requires `sentinel.sentinels?.length > 0` and `sentinel.name`; otherwise throws `CacheException(SENTINEL_MISCONFIGURED)`
>      - `mode === 'cluster'` → requires `cluster.nodes?.length > 0`; otherwise throws `CacheException(CLUSTER_MISCONFIGURED)`
>      - `mode === 'standalone'` (default) → requires `connection.url` OR `connection.host`; otherwise throws `CacheException(CONNECTION_FAILED)`
>      - `namespace` (after default) not empty and does not contain separator → otherwise throws `CacheException(INVALID_NAMESPACE)`
>      - `shutdownTimeoutMs ?? DEFAULT` >= `MIN_SHUTDOWN_TIMEOUT_MS` → otherwise throws
>      - `connectTimeout` (if defined) >= `MIN_CONNECT_TIMEOUT_MS` → otherwise throws
>    - `applyDefaults(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions>` — merge with defaults (DEFAULT_NAMESPACE='app', DEFAULT_KEY_SEPARATOR=':', DEFAULT_SHUTDOWN_TIMEOUT_MS=5000, allowFlushInProduction=false, isGlobal=true), returns `Object.freeze(resolved)`.

**Acceptance criteria:**

- [x] 2 files created
- [x] `validateOptions({connection: {host: 'h'}})` does not throw
- [x] `validateOptions({mode: 'sentinel'})` throws `SENTINEL_MISCONFIGURED`
- [x] `validateOptions({mode: 'cluster'})` throws `CLUSTER_MISCONFIGURED`
- [x] `validateOptions({connection: {host: 'h'}, namespace: ''})` throws `INVALID_NAMESPACE`
- [x] `validateOptions({connection: {host: 'h'}, namespace: 'a:b'})` throws (contains separator)
- [x] `applyDefaults({connection: {host: 'h'}}).namespace === 'app'`
- [x] `Object.isFrozen(applyDefaults(...))` returns true
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 1 3→2, DONE 12→13, Progress 87%; TOTAL 46→45, 12→13, 22%
4. Commit: `feat(cache): add resolved options and validation (CACHE-013)`

---

### CACHE-014: ConnectionManager (lifecycle + retry + event listeners + multi-mode)

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-012, CACHE-013
- **Agent:** database-reviewer

**Description:** Phase 1 core — `ConnectionManager` manages singleton ioredis client with `OnModuleInit`/`OnModuleDestroy`, multi-mode (standalone/sentinel/cluster), retry strategy, event propagation via `ICacheEvents.onEvent`, and `createSubscriberClient()` for future Pub/Sub.

**Required reading:**

- `docs/development_plan.md` §2.7 (complete connection.manager.ts skeleton — 170+ LoC)
- `docs/technical_specification.md` §11 (connection strategy)

**Prompt for the agent:**

> Create `src/server/connection/connection.manager.ts` as per the skeleton in `docs/development_plan.md` §2.7:
>
> - `@Injectable()` implements `OnModuleInit, OnModuleDestroy`
> - Internal type `AnyRedis = Redis | Cluster`
> - Constructor injects `@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions` + `@Optional() @Inject(BYMAX_CACHE_EVENTS) events?: ICacheEvents`
> - `buildRedisOptions(opts)` private — merge defaults + URL parse (`url` has priority over discrete fields via spread at the end)
> - `createClient()` private — switch by `mode`:
>   - `'standalone'` → `new Redis(this.redisOptionsResolved)`
>   - `'sentinel'` → `new Redis({ ...resolved, sentinels, name, sentinelPassword, role })`
>   - `'cluster'` → `new Cluster(nodes, options ?? {})`
> - `onModuleInit()` — creates main client + `registerListeners` + `waitUntilReady` (unless `lazyConnect`)
> - `getClient(): AnyRedis` — returns singleton; creates lazy if still null
> - `createSubscriberClient(): AnyRedis` — always creates new instance (for Pub/Sub)
> - `onModuleDestroy()` — `Promise.race([quit(), timeout])`; on timeout, forces `disconnect()`
> - `registerListeners(client, role)` — listeners 'connect', 'ready', 'error', 'close', 'reconnecting', 'end' → `events?.onEvent?.(event, { role, ...payload })`. **Swallowing**: try/catch around the consumer callback to never crash the manager.
> - `waitUntilReady(client)` — Promise resolves on 'ready', rejects on 'error'; cleanup listeners via `client.off`.
>
> Also update `KeyBuilder` (created in CACHE-012) to inject `ResolvedOptions` instead of `BymaxCacheModuleOptions`.

**Acceptance criteria:**

- [x] `onModuleInit` creates standalone client with URL
- [x] Sentinel mode creates client with `sentinels`/`name`
- [x] Cluster mode creates `Cluster(nodes, options)`
- [x] `getClient()` returns same instance (singleton)
- [x] `createSubscriberClient()` returns new instance
- [x] Events propagated with `role: 'main' | 'subscriber'`
- [x] Exception in `onEvent` is **swallowed** (does not propagate)
- [x] `onModuleDestroy` calls `quit()` with timeout
- [x] Exceeded timeout forces `disconnect()`
- [x] URL priority: discrete fields serve as fallback
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 1 2→1, DONE 13→14, Progress 93%; TOTAL 45→44, 13→14, 24%
4. Commit: `feat(cache): add ConnectionManager with multi-mode lifecycle (CACHE-014)`

---

### CACHE-015: Synchronous BymaxCacheModule.forRoot() + barrel + Phase 1 validation

- **Phase:** 1
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-001 to CACHE-014
- **Agent:** architect

**Description:** Synchronous dynamic module Phase 1 (only Connection + KeyBuilder + tokens; CacheService arrives in Phase 2; `forRootAsync` in Phase 4). + barrel `src/server/index.ts` Phase 1 surface. + cumulative validation of the phase.

**Required reading:**

- `docs/development_plan.md` §2.8 (bymax-cache.module.ts skeleton)
- `docs/development_plan.md` §2.9 (barrel Phase 1 surface)
- `docs/development_plan.md` §2.10 (Phase 1 validation)

> **⚠️ §0 OVERRIDE — use `ConfigurableModuleBuilder`, not a manual `@Module({})`.** Per spec §0
> (Bymax standard; [[nest-logger]] pattern), implement the module on top of the builder. Add a NEW
> file `src/server/bymax-cache.module.builder.ts`. The manual skeleton below is illustrative of
> WHICH providers/exports to register — that list goes into the augment step, unchanged:
>
> ```typescript
> // bymax-cache.module.builder.ts (NEW)
> export const {
>   ConfigurableModuleClass: BymaxCacheModuleBase,
>   MODULE_OPTIONS_TOKEN: BUILDER_OPTIONS_TOKEN,
>   OPTIONS_TYPE,
>   ASYNC_OPTIONS_TYPE
> } = new ConfigurableModuleBuilder<BymaxCacheModuleOptions>()
>   .setClassMethodName('forRoot')
>   .setExtras({ isGlobal: true }, (def, extras) => ({ ...def, global: extras.isGlobal !== false }))
>   .build()
>
> // bymax-cache.module.ts
> @Module({})
> export class BymaxCacheModule extends BymaxCacheModuleBase {
>   static override forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
>     validateOptions(options)
>     return augmentCacheModule(super.forRoot(options), buildProviders(applyDefaults(options)))
>   }
> }
> ```

**Prompt for the agent:**

> 1. Create `src/server/bymax-cache.module.ts`:
>    ```typescript
>    @Module({})
>    export class BymaxCacheModule {
>      static forRoot(options: BymaxCacheModuleOptions): DynamicModule {
>        validateOptions(options)
>        const resolved = applyDefaults(options)
>        const providers: Provider[] = [
>          { provide: BYMAX_CACHE_OPTIONS, useValue: resolved },
>          { provide: BYMAX_CACHE_EVENTS, useValue: resolved.events ?? null },
>          ConnectionManager,
>          KeyBuilder,
>          { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder }
>        ]
>        return {
>          module: BymaxCacheModule,
>          global: resolved.isGlobal,
>          providers,
>          exports: [BYMAX_CACHE_OPTIONS, BYMAX_CACHE_KEY_BUILDER, ConnectionManager, KeyBuilder]
>        }
>      }
>    }
>    ```
> 2. Update `src/server/index.ts` (barrel Phase 1 surface) as per the skeleton in `docs/development_plan.md` §2.9 — export:
>    - `BymaxCacheModule`, `ConnectionManager`, `KeyBuilder`
>    - All interfaces from `./interfaces/*`
>    - DI tokens from `bymax-cache.constants`
>    - `CacheException`, `CACHE_ERROR_CODES`, `CACHE_ERROR_MESSAGES`, `CacheErrorCode`
>    - Re-export shared (`CACHE_EVENT_NAMES`, types)
>    - Re-export `Redis, RedisKey` from ioredis
> 3. Final phase validation — run:
>    ```bash
>    pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
>    ```
>    Phase 1 tests (parse-redis-url, key-builder, default-options, cache-exception, connection.manager, bymax-cache.module) are created in CACHE-017 — in this step, only typecheck/lint/build need to pass; `test:cov` may show 0% (no specs yet).
> 4. Smoke test (manual, optional): follow `docs/development_plan.md` §2.10 "Smoke test" — install fixture, import `BymaxCacheModule.forRoot({connection: {url: 'redis://localhost:6379'}})`, verify connection via `events.onEvent`. Document result in the commit body if executed.

**Acceptance criteria:**

- [x] `BymaxCacheModule.forRoot(options)` returns `DynamicModule`
- [x] Module is global by default (`isGlobal: true`)
- [x] `isGlobal: false` respected
- [x] Invalid options throw `CacheException` in `forRoot` (not at runtime)
- [x] `ConnectionManager` and `KeyBuilder` injectable into consumer modules
- [x] Barrel `src/server/index.ts` exports only the Phase 1 surface (does not leak internals)
- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm size` pass
- [x] `node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"` lists BymaxCacheModule, ConnectionManager, KeyBuilder, CacheException, etc.

**Validation commands:**

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm size
node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"
```

**Completion protocol:**

1. Validations OK
2. `Status` → DONE
3. Dashboard: Phase 1 1→0, DONE 14→15, Progress 100% ✅; TOTAL 44→43, 14→15, 26%
4. Commit: `feat(cache): wire BymaxCacheModule.forRoot and Phase 1 surface (CACHE-015)`

---

### Phase 1 — Completion Log

- CACHE-001 ✅ 2026-05-30 — package.json (zero deps, peer deps, exports, scripts) verified
- CACHE-002 ✅ 2026-05-30 — tsconfig variants + tsup 2-entry build verified
- CACHE-003 ✅ 2026-05-30 — eslint flat config + prettier + ignores verified
- CACHE-004 ✅ 2026-05-30 — jest (4 variants) + stryker configs verified
- CACHE-005 ✅ 2026-05-30 — check-size.mjs bundle gate (server 4.21/14 KB, shared 0.31/1.5 KB brotli)
- CACHE-006 ✅ 2026-05-30 — src/server + src/shared structure + barrels build to dist
- CACHE-007 ✅ 2026-05-30 — shared types (cache-event, cache-config, serializable-value)
- CACHE-008 ✅ 2026-05-30 — shared constants (CACHE_ERROR_CODES 14 codes, CACHE_EVENT_NAMES)
- CACHE-009 ✅ 2026-05-30 — server interfaces (options/events/serializer/script/pubsub) + barrel
- CACHE-010 ✅ 2026-05-30 — Symbol DI tokens + default-namespace/default-timeouts constants
- CACHE-011 ✅ 2026-05-30 — CacheException (readonly code/details) + cache-error-codes (Map-based messages + HTTP status §12.2)
- CACHE-012 ✅ 2026-05-30 — parseRedisUrl (fail-closed) + KeyBuilder (namespace strategy)
- CACHE-013 ✅ 2026-05-30 — ResolvedOptions + validateOptions + applyDefaults (frozen)
- CACHE-014 ✅ 2026-05-30 — ConnectionManager (standalone/sentinel/cluster, retry, events, graceful shutdown)
- CACHE-015 ✅ 2026-05-30 — BymaxCacheModule.forRoot (ConfigurableModuleBuilder) + Phase 1 barrel; 181 tests, 100% coverage

> **Note:** CACHE-017 (the originally-deferred "Phase 1 unit specs" task in Phase 2) was satisfied early — co-located `*.spec.ts` files were written alongside Phase 1 to honor the CLAUDE.md TDD / 100%-coverage gate.

---

## Phase 2 — CacheService + Typed Helpers + Serializer

> **Phase objective:** Implement `CacheService` (public facade) with typed helpers for strings (`get/set/setNx/del/delMany/exists/getRaw/setRaw`), numeric (`incr/decr/expire/ttl/persist`), batch (`mget/mset`), iteration (`keys/scan`), hash (`hget/hset/hgetall/hdel`), set (`sadd/srem/smembers/sismember/scard`), raw `pipeline()` + `getClient()` escape hatch, and default `JsonSerializer` + pluggable `ISerializer` interface. Adds `flushNamespace()` with production safety guard. At the end, the lib's main API is usable in consumer apps.
> **Complexity:** MEDIUM.
> **Total:** 12 tasks.

### CACHE-016: JsonSerializer (default ISerializer impl)

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-009, CACHE-011
- **Agent:** typescript-reviewer

**Description:** Default JSON serializer, throws `CacheException(SERIALIZATION_FAILED)` on circular ref and `DESERIALIZATION_FAILED` on malformed JSON.

**Required reading:**

- `docs/development_plan.md` §3.1 (json-serializer.ts skeleton)
- `docs/technical_specification.md` §6.3 (limitations of JSON serialization)

**Prompt for the agent:**

> Create `src/server/utils/json-serializer.ts` as per the skeleton in `docs/development_plan.md` §3.1:
>
> ```typescript
> @Injectable()
> export class JsonSerializer implements ISerializer {
>   serialize<T>(value: T): string {
>     try {
>       return JSON.stringify(value)
>     } catch (err) {
>       throw new CacheException(CACHE_ERROR_CODES.SERIALIZATION_FAILED, {
>         error: err instanceof Error ? err.message : String(err)
>       })
>     }
>   }
>
>   deserialize<T>(raw: string): T {
>     try {
>       return JSON.parse(raw) as T
>     } catch (err) {
>       throw new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, {
>         error: err instanceof Error ? err.message : String(err),
>         preview: raw.length > 100 ? `${raw.substring(0, 100)}...` : raw
>       })
>     }
>   }
> }
> ```
>
> JSDoc with `@example` documenting limitations (Date → ISO string, Map/Set/BigInt not preserved). Do not log full `raw` in `details` — truncate at 100 chars (PII safety).

**Acceptance criteria:**

- [x] `serialize({a:1})` returns `'{"a":1}'`
- [x] `deserialize('{"a":1}')` returns `{a:1}`
- [x] `serialize` on circular reference throws `CacheException(SERIALIZATION_FAILED)`
- [x] `deserialize` on malformed JSON throws `CacheException(DESERIALIZATION_FAILED)`
- [x] `deserialize` includes `preview` truncated at 100 chars in `details`
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 2 12→11, DONE 15→16, Progress 8%; TOTAL 43→42, 15→16, 28%
4. Commit: `feat(cache): add JsonSerializer (CACHE-016)`

---

### CACHE-017: Tests — Phase 1 unit specs (parseRedisUrl, KeyBuilder, validateOptions/applyDefaults, CacheException, ConnectionManager, BymaxCacheModule)

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-015
- **Agent:** tester

**Description:** Spec suite covering all of Phase 1. 95% coverage on critical paths (parseRedisUrl, key-builder, default-options, connection.manager, bymax-cache.module). Uses `ioredis-mock` to emulate Redis in `ConnectionManager` tests.

**Required reading:**

- `docs/development_plan.md` §2.9 (critical cases per file — complete skeletons for the 6 spec files)

**Prompt for the agent:**

> Create 6 spec files following AAA pattern as per `docs/development_plan.md` §2.9:
>
> 1. `src/server/utils/parse-redis-url.spec.ts` — 9 cases: basic URL, default port 6379, password/username, URL-decoded password, db from pathname, in the db when empty, rediss:// → tls, unsupported protocol throws, malformed URL throws.
> 2. `src/server/utils/key-builder.spec.ts` — 6 cases: build with defaults, custom namespace+separator, empty prefix throws, empty id throws, applyNamespace, getNamespacePrefix.
> 3. `src/server/connection/connection.manager.spec.ts` — uses `jest.mock('ioredis')` with `ioredis-mock`. 5+ cases: create main client in onModuleInit, onEvent throwing does not crash, singleton in getClient, subscriber always fresh, disconnect on shutdown timeout.
> 4. `src/server/config/default-options.spec.ts` — `describe('validateOptions')` with 6 cases (valid, sentinel without sentinels, cluster without nodes, empty namespace, namespace contains separator, shutdownTimeoutMs < MIN) + `describe('applyDefaults')` with 3 cases (defaults applied, frozen, overrides respected).
> 5. `src/server/errors/cache-exception.spec.ts` — 5 cases: code+details accessible, FLUSH_DISABLED_IN_PRODUCTION → 403, COMMAND_TIMEOUT → 504, status override, payload format `{error: {code, message, details}}`.
> 6. `src/server/bymax-cache.module.spec.ts` — 4 cases: register ConnectionManager+KeyBuilder, global by default, isGlobal: false respected, invalid options throws in forRoot.
>
> Critical topics:
>
> - In `connection.manager.spec.ts`, prefix with `jest.mock('ioredis', () => { const Mock = require('ioredis-mock'); return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} } })`
> - In the shutdown test, mock `quit()` to never resolve: `jest.spyOn(client, 'quit').mockImplementation(() => new Promise(() => {}))` + spyOn `disconnect` for assertion
> - Coverage gate: 95% on `parse-redis-url.ts`, `key-builder.ts`, `default-options.ts`, `connection.manager.ts`, `bymax-cache.module.ts`

**Acceptance criteria:**

- [x] 6 spec files created, AAA pattern
- [x] `pnpm test` zero failures
- [x] 95% coverage on the 5 critical paths
- [x] Global coverage ≥ 80%
- [x] `clearMocks: true` and `restoreMocks: true` honored (no spillover between tests)

**Validation commands:**

```bash
pnpm test
pnpm test:cov
```

**Completion protocol:**

1. All tests pass; coverage gates OK
2. `Status` → DONE
3. Dashboard: Phase 2 11→10, DONE 16→17, Progress 17%; TOTAL 42→41, 16→17, 29%
4. Commit: `test(cache): add Phase 1 unit specs (CACHE-017)`

---

### CACHE-018: Tests — JsonSerializer

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-016
- **Agent:** tester

**Description:** Specs covering roundtrip + error paths of the `JsonSerializer`.

**Required reading:**

- `docs/development_plan.md` §3.8 (complete sample of json-serializer.spec.ts)

**Prompt for the agent:**

> Create `src/server/utils/json-serializer.spec.ts` as per the sample in `docs/development_plan.md` §3.8:
>
> 5 cases:
>
> 1. Roundtrip primitives (number, string, boolean, null)
> 2. Roundtrip objects + arrays + nested
> 3. SERIALIZATION_FAILED on circular reference (`const a = {}; a.self = a`)
> 4. DESERIALIZATION_FAILED on malformed JSON (`'not json'`)
> 5. Preview truncated at 100 chars in error `details`
>
> 100% coverage.

**Acceptance criteria:**

- [x] 5 cases covering all paths
- [x] 100% coverage

**Validation commands:**

```bash
pnpm test src/server/utils/json-serializer.spec.ts
```

**Completion protocol:**

1. All pass; 100% coverage
2. `Status` → DONE
3. Dashboard: Phase 2 10→9, DONE 17→18, Progress 25%; TOTAL 41→40, 17→18, 31%
4. Commit: `test(cache): add JsonSerializer tests (CACHE-018)`

---

### CACHE-019: CacheService — string/numeric/del/exists/expire/ttl + batch

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-014, CACHE-016
- **Agent:** database-reviewer

**Description:** First slice of `CacheService` — string commands (get/getRaw/set/setRaw/setNx), del/delMany/exists, numeric (incr/decr), expiration (expire/ttl/persist), batch (mget/mset). All pass through `KeyBuilder.build()` and the configured serializer.

**Required reading:**

- `docs/development_plan.md` §3.2 (complete first-slice skeleton)
- `docs/technical_specification.md` §5 (main service)

**Prompt for the agent:**

> Create `src/server/services/cache.service.ts` as per the skeleton in `docs/development_plan.md` §3.2. Critical points:
>
> - `@Injectable()` with constructor:
>   - `@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions`
>   - `connection: ConnectionManager`
>   - `keyBuilder: KeyBuilder`
>   - `@Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer`
>   - Priority: `options.serializer ?? injectedSerializer ?? new JsonSerializer()`
> - String/value commands:
>   - `get<T>(prefix, id): Promise<T | null>` — returns null if key non-existent, otherwise deserializes
>   - `getRaw(prefix, id): Promise<string | null>` — raw without deserialization
>   - `set<T>(prefix, id, value, ttlSeconds?): Promise<void>` — uses `client.set(key, raw, 'EX', ttl)` when ttl provided
>   - `setRaw(prefix, id, value: string, ttlSeconds?)`
>   - `setNx<T>(prefix, id, value, ttlSeconds?): Promise<boolean>` — uses `'NX'` flag; returns `result === 'OK'`
> - `del(prefix, id): Promise<number>`, `delMany(prefix, ids: readonly string[]): Promise<number>` (returns 0 without calling Redis if ids empty)
> - `exists(prefix, id): Promise<boolean>` — converts `count > 0`
> - Numeric: `incr(prefix, id, by = 1)` (uses `incr` if by===1, otherwise `incrby`), `decr(prefix, id, by = 1)` analogous
> - Expiration: `expire(prefix, id, ttlSeconds): Promise<boolean>` (converts 0|1 → boolean), `ttl(prefix, id): Promise<number>` (-2 does not exist, -1 in the expiration), `persist(prefix, id): Promise<boolean>`
> - Batch: `mget<T>(prefix, ids): Promise<Array<T | null>>` (returns `[]` if ids empty), `mset<T>(prefix, entries: ReadonlyArray<readonly [string, T]>): Promise<void>` (variadic pairs, returns without call if entries empty)
>
> Import `Redis, ChainableCommander` from `'ioredis'` only as type — `import type`.

**Acceptance criteria:**

- [x] `get/set` roundtrip preserves JSON values
- [x] `get` returns `null` for non-existent key
- [x] `set` with `ttlSeconds` applies EX
- [x] `setNx` returns `true` on first write, `false` on subsequent
- [x] `del`/`delMany` return count
- [x] `delMany([])` returns 0 without calling Redis
- [x] `incr`/`decr` accept custom `by`
- [x] `expire` returns boolean
- [x] `ttl` returns `-2`/`-1` correctly
- [x] `mget([])` returns `[]` without calling Redis
- [x] Custom serializer (options) respected over default
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 2 9→8, DONE 18→19, Progress 33%; TOTAL 40→39, 18→19, 33%
4. Commit: `feat(cache): add CacheService string/numeric/batch commands (CACHE-019)`

---

### CACHE-020: CacheService — hash + set commands

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-019
- **Agent:** database-reviewer

**Description:** Add Hash (hget/hset/hgetall/hdel) and Set (sadd/srem/smembers/sismember/scard) commands to `CacheService`.

**Required reading:**

- `docs/development_plan.md` §3.3 (hash + set commands skeleton)

**Prompt for the agent:**

> Add to the `CacheService` class the methods as per the skeleton in `docs/development_plan.md` §3.3:
>
> Hash commands (values pass through serializer; field names are strings without serialization):
>
> - `hget<T>(prefix, id, field): Promise<T | null>`
> - `hset<T>(prefix, id, field, value): Promise<number>` — uses `client.hset(key, field, this.serializer.serialize(value))`
> - `hgetall<T>(prefix, id): Promise<Record<string, T>>` — iterates `Object.entries(all)` and deserializes each value
> - `hdel(prefix, id, ...fields: readonly string[]): Promise<number>` — returns 0 if fields empty
>
> Set commands (members are strings without serialization — design decision: sets store IDs, not objects):
>
> - `sadd(prefix, id, ...members): Promise<number>` — returns 0 if members empty
> - `srem(prefix, id, ...members): Promise<number>` — returns 0 if members empty
> - `smembers(prefix, id): Promise<string[]>`
> - `sismember(prefix, id, member): Promise<boolean>` — converts `0 | 1` → boolean
> - `scard(prefix, id): Promise<number>`
>
> JSDoc on each method explaining behavior + edge cases.

**Acceptance criteria:**

- [x] `hset`/`hget` roundtrip via serializer
- [x] `hgetall` returns `{}` for non-existent hash
- [x] `hdel(...[])` returns 0 without calling Redis
- [x] `sadd`/`srem` return count
- [x] `sadd(...[])` and `srem(...[])` return 0 without calling Redis
- [x] `sismember` returns boolean
- [x] Set members are strings (not serialized)
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 2 8→7, DONE 19→20, Progress 42%; TOTAL 39→38, 19→20, 34%
4. Commit: `feat(cache): add CacheService hash and set commands (CACHE-020)`

---

### CACHE-021: CacheService — iteration (keys, scan async iterable) + pipeline + getClient

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-020
- **Agent:** database-reviewer

**Description:** Key iteration (`keys` with warning, `scan` cursor-based recommended for production), raw pipeline, and `getClient()` escape hatch.

**Required reading:**

- `docs/development_plan.md` §3.4 (scan/keys/pipeline skeleton)

**Prompt for the agent:**

> Add to the `CacheService` class as per the skeleton in `docs/development_plan.md` §3.4:
>
> - `keys(prefix, pattern): Promise<string[]>` — JSDoc with O(N) blocking warning; `client.keys(this.keyBuilder.build(prefix, pattern))`
> - `async *scan(prefix, pattern, count = 100): AsyncIterable<string>` — cast `client as Redis`, validate `typeof client.scanStream === 'function'` (cluster mode throws Error), `scanStream({ match: fullPattern, count })`, `for await chunk of stream { yield each key }`
> - `pipeline(): ChainableCommander` — JSDoc with warning: keys passed to pipeline are NOT auto-namespaced (caller responsible)
> - `getClient(): Redis` — JSDoc explaining that keys passed via getClient are NOT auto-namespaced
>
> Import `import type { ChainableCommander, Redis } from 'ioredis'`.

**Acceptance criteria:**

- [x] `keys('users', '*')` returns matching keys
- [x] `scan` async iteration works with `for await`
- [x] `scan` throws in cluster mode (without `scanStream`)
- [x] `pipeline()` returns chainable `ChainableCommander`
- [x] `getClient()` returns raw ioredis client
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 2 7→6, DONE 20→21, Progress 50%; TOTAL 38→37, 20→21, 36%
4. Commit: `feat(cache): add scan, pipeline and getClient (CACHE-021)`

---

### CACHE-022: CacheService — flushNamespace with production safety guard

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-021
- **Agent:** security-reviewer

**Description:** Destructive operation `flushNamespace()` via SCAN + UNLINK pipeline. Blocked in production by default (`allowFlushInProduction: false`).

**Required reading:**

- `docs/development_plan.md` §3.5 (complete flushNamespace skeleton)
- `docs/technical_specification.md` §5.8 (production safety)

**Prompt for the agent:**

> Add to the `CacheService` class as per the skeleton in `docs/development_plan.md` §3.5:
>
> ```typescript
> async flushNamespace(): Promise<number> {
>   if (process.env['NODE_ENV'] === 'production' && !this.options.allowFlushInProduction) {
>     throw new CacheException(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION)
>   }
>   const client = this.connection.getClient() as Redis
>   if (typeof client.scanStream !== 'function') {
>     throw new Error('flushNamespace() requires standalone/sentinel mode')
>   }
>   const pattern = `${this.keyBuilder.getNamespacePrefix()}*`
>   const stream = client.scanStream({ match: pattern, count: 1000 })
>   let total = 0
>   for await (const chunk of stream) {
>     const keys = chunk as string[]
>     if (keys.length > 0) {
>       const removed = await client.unlink(...keys)
>       total += removed
>     }
>   }
>   return total
> }
> ```
>
> SAFETY notes in JSDoc:
>
> - Use UNLINK (async free) instead of DEL (sync) to avoid blocking server on large keysets
> - Pattern `{namespace}:*` (does not touch keys from other namespaces)
> - Use ONLY in tests/tooling — in prod, prefer del/delMany
>
> **Acceptance criteria:**

- [x] `flushNamespace()` in `NODE_ENV=production` without `allowFlushInProduction` throws `FLUSH_DISABLED_IN_PRODUCTION`
- [x] In `NODE_ENV=production` with `allowFlushInProduction: true` runs
- [x] In `NODE_ENV=development` runs without flag
- [x] SCAN pattern uses `{namespace}:*`
- [x] Returns total count
- [x] Cluster mode throws Error (scan limitation)
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 2 6→5, DONE 21→22, Progress 58%; TOTAL 37→36, 21→22, 38%
4. Commit: `feat(cache): add flushNamespace with production safety guard (CACHE-022)`

---

### CACHE-023: Wire CacheService + JsonSerializer in BymaxCacheModule + update barrel

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-022
- **Agent:** architect

**Description:** Add `CacheService` + `BYMAX_CACHE_SERIALIZER` to `BymaxCacheModule.forRoot()`. Update barrel for Phase 2 surface.

**Required reading:**

- `docs/development_plan.md` §3.6 (wire updates)
- `docs/development_plan.md` §3.7 (barrel update)

**Prompt for the agent:**

> 1. In `src/server/bymax-cache.module.ts` `forRoot()`, add to providers:
>    ```typescript
>    { provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer },
>    CacheService,
>    ```
>    And to exports:
>    ```typescript
>    CacheService,
>    BYMAX_CACHE_SERIALIZER,
>    ```
> 2. In `src/server/index.ts`, add:
>    ```typescript
>    export { CacheService } from './services/cache.service'
>    export { JsonSerializer } from './utils/json-serializer'
>    ```

**Acceptance criteria:**

- [x] `module.get(CacheService)` returns functional instance after `forRoot`
- [x] `options.serializer` (when provided) has priority over the injected `JsonSerializer`
- [x] `BYMAX_CACHE_SERIALIZER` token resolves to `JsonSerializer` when custom is not provided
- [x] Barrel updated
- [x] `pnpm typecheck && pnpm build` pass

**Validation commands:**

```bash
pnpm typecheck && pnpm build
```

**Completion protocol:**

1. Typecheck OK; build OK
2. `Status` → DONE
3. Dashboard: Phase 2 5→4, DONE 22→23, Progress 67%; TOTAL 36→35, 22→23, 40%
4. Commit: `feat(cache): wire CacheService into BymaxCacheModule (CACHE-023)`

---

### CACHE-024: Tests — CacheService string/numeric/expire/batch

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-019
- **Agent:** tester

**Description:** Specs covering the first slice of CacheService (string/numeric/expire/batch). Uses `ioredis-mock` via `jest.mock('ioredis')`.

**Required reading:**

- `docs/development_plan.md` §3.8 (cache.service.spec.ts samples)

**Prompt for the agent:**

> Create `src/server/services/cache.service.spec.ts` as per the sample in `docs/development_plan.md` §3.8.
>
> Structure:
>
> - `jest.mock('ioredis')` prefix (with ioredis-mock)
> - `beforeEach`: creates `ConnectionManager` + `KeyBuilder` + `CacheService` with opts `{connection: {host: 'h'}, namespace: 'test'}`; await `onModuleInit`
> - `afterEach`: `connection.onModuleDestroy`
>
> Critical cases (15+ tests):
>
> - `describe('get/set')`:
>   1. JSON object roundtrip
>   2. null for missing key
>   3. TTL applied when provided
> - `describe('setNx')`: 4. true on first write 5. false on subsequent
> - `describe('numeric')`: 6. incr by 1 default 7. incr by custom step 8. decr by custom step
> - `describe('batch')`: 9. mget returns array with nulls for missing 10. mget([]) returns [] without calling Redis 11. mset roundtrip
> - `describe('del/exists')`: 12. del returns count 13. exists boolean
>
> 95% coverage on cache.service.ts (these tests + those of §3.3/§3.4/§3.5 fulfill).

**Acceptance criteria:**

- [x] 15+ AAA cases
- [x] `pnpm test src/server/services/cache.service.spec.ts` passes

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts
```

**Completion protocol:**

1. All pass
2. `Status` → DONE
3. Dashboard: Phase 2 4→3, DONE 23→24, Progress 75%; TOTAL 35→34, 23→24, 41%
4. Commit: `test(cache): add CacheService string/numeric/batch tests (CACHE-024)`

---

### CACHE-025: Tests — CacheService hash/set/scan/flushNamespace

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-020, CACHE-021, CACHE-022
- **Agent:** tester

**Description:** Specs covering hash + set + scan + flushNamespace (including safety guard).

**Required reading:**

- `docs/development_plan.md` §3.8 (hash/set/flushNamespace samples)

**Prompt for the agent:**

> Extend `src/server/services/cache.service.spec.ts` with additional `describe` blocks:
>
> - `describe('hash')`:
>   1. hset/hget roundtrip
>   2. hgetall returns `{}` for non-existent hash
>   3. hgetall with multiple fields deserializes
>   4. hdel(...[]) returns 0 without calling Redis
> - `describe('set')`: 5. sadd/scard/sismember happy path 6. sismember returns false for non-existent member 7. sadd(...[]) returns 0
> - `describe('scan')`: 8. scan async iteration returns matching keys 9. scan in cluster mode (mock client without scanStream) throws
> - `describe('flushNamespace')`: 10. Removes all keys under namespace, returns count > 0 11. NODE_ENV=production without allowFlushInProduction throws FLUSH_DISABLED_IN_PRODUCTION (use `jest.replaceProperty(process.env, 'NODE_ENV', 'production')` with restore) 12. NODE_ENV=production with allowFlushInProduction: true runs 13. NODE_ENV=development runs without flag
>
> 95% coverage on cache.service.ts (combined with CACHE-024).

**Acceptance criteria:**

- [x] 13 additional cases
- [x] flushNamespace safety guard tested in both modes
- [x] 95% combined coverage

**Validation commands:**

```bash
NODE_ENV=development pnpm test src/server/services/cache.service.spec.ts
NODE_ENV=production pnpm test src/server/services/cache.service.spec.ts -- -t flushNamespace
```

**Completion protocol:**

1. All pass; 95% coverage
2. `Status` → DONE
3. Dashboard: Phase 2 3→2, DONE 24→25, Progress 83%; TOTAL 34→33, 24→25, 43%
4. Commit: `test(cache): add CacheService hash/set/scan/flushNamespace tests (CACHE-025)`

---

### CACHE-026: Phase 2 smoke test + bundle size check

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-023, CACHE-024, CACHE-025
- **Agent:** general-purpose

**Description:** Manually validate that the Phase 2 lib works against local Redis + bundle within budget.

**Required reading:**

- `docs/development_plan.md` §3.8 (Extended Phase 2 smoke test)

**Prompt for the agent:**

> Run the smoke test in `docs/development_plan.md` §3.8 against local Redis (port 6379). Complete snippet:
>
> ```javascript
> // /tmp/cache-smoke-phase2.mjs
> import { Module } from '@nestjs/common'
> import { NestFactory } from '@nestjs/core'
> import {
>   BymaxCacheModule,
>   CacheService
> } from '/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/dist/server/index.mjs'
>
> @Module({
>   imports: [
>     BymaxCacheModule.forRoot({
>       connection: { url: 'redis://localhost:6379' },
>       namespace: 'smoke2'
>     })
>   ]
> })
> class App {}
>
> const app = await NestFactory.createApplicationContext(App, { logger: false })
> const cache = app.get(CacheService)
>
> await cache.set('users', 'u_1', { name: 'Alice', age: 30 })
> console.log('User:', await cache.get('users', 'u_1'))
> console.log('Counter:', await cache.incr('counters', 'visits'))
> await cache.flushNamespace()
> await app.close()
> ```
>
> Expected: prints `User: { name: 'Alice', age: 30 }`, `Counter: 1`, without errors. Closes gracefully.
>
> Also validate bundle: `pnpm build && pnpm size` — server entry < 14 KiB brotli (probably even smaller since in the PubSub/Scripts).
>
> If local Redis is not available, skip the smoke test and mark this step as REVIEW with note indicating so.

**Acceptance criteria:**

- [x] Smoke test passes (if local Redis available) OR step marked as REVIEW
- [x] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}`
- [x] `pnpm size` server entry < 14 KiB brotli, shared < 1.5 KiB brotli

**Validation commands:**

```bash
pnpm build && pnpm size
# Optional (requires local Redis):
node /tmp/cache-smoke-phase2.mjs
```

**Completion protocol:**

1. Build + size OK; smoke if possible
2. `Status` → DONE
3. Dashboard: Phase 2 2→1, DONE 25→26, Progress 92%; TOTAL 33→32, 25→26, 45%
4. Commit: `chore(cache): Phase 2 smoke test and bundle size check (CACHE-026)`

---

### CACHE-027: Phase 2 validation (typecheck + lint + test:cov + build + size + code review)

- **Phase:** 2
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-016 to CACHE-026
- **Agent:** code-reviewer

**Description:** Consolidated phase validation: typecheck, lint, coverage, build, bundle size + `/bymax-quality:code-review`.

**Required reading:**

- `docs/development_plan.md` §3.8 (Phase 2 Done criteria)

**Prompt for the agent:**

> Run in sequence:
>
> ```bash
> cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/
> pnpm typecheck
> pnpm lint
> pnpm test:cov
> pnpm build
> pnpm size
> ```
>
> Validate:
>
> - `typecheck`: zero errors
> - `lint`: zero warnings
> - `test:cov`: global coverage ≥ 80%; critical paths (`cache.service.ts`, `connection.manager.ts`, `parse-redis-url.ts`, `key-builder.ts`, `default-options.ts`) ≥ 95%
> - `build`: `dist/{server,shared}/index.{mjs,cjs,d.ts}` present
> - `size`: server < 14 KiB brotli, shared < 1.5 KiB brotli
>
> Run `/bymax-quality:code-review` for end findings. Apply fixes in a loop until zero critical findings.
>
> If EVERYTHING passes, mark Phase 2 as Done. If something fails, list and mark individual tasks as REVIEW.

**Acceptance criteria:**

- [x] All 5 commands above pass
- [x] `/bymax-quality:code-review` executed and findings applied
- [x] In the Phase 2 task pending (all DONE)

**Validation commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

**Completion protocol:**

1. All commands pass
2. `Status` → DONE
3. Dashboard: Phase 2 1→0, DONE 26→27, Progress 100% ✅; TOTAL 32→31, 26→27, 47%
4. Commit: `chore(cache): complete Phase 2 validation (CACHE-027)`

---

### Phase 2 — Completion Log

- CACHE-016 ✅ 2026-05-31 — JsonSerializer (default ISerializer); fail-closed both directions; shared `extractErrorMessage` helper; PII-safe 100-char preview; top-level `undefined`/function rejected at write time
- CACHE-017 ✅ 2026-05-30 — satisfied early in Phase 1 (co-located Phase 1 specs were written alongside the implementation to honor the TDD / 100%-coverage gate)
- CACHE-018 ✅ 2026-05-31 — JsonSerializer specs (round-trip, circular, non-Error throw, malformed JSON with bare message, preview truncation + boundary, top-level undefined/function guard)
- CACHE-019 ✅ 2026-05-31 — CacheService string/raw/setNx + del/delMany/exists + numeric (incr/decr) + expiration (expire/ttl/persist) + batch (mget/mset)
- CACHE-020 ✅ 2026-05-31 — CacheService hash (hget/hset/hgetall/hdel) + set (sadd/srem/smembers/sismember/scard) commands
- CACHE-021 ✅ 2026-05-31 — CacheService iteration (keys + async-iterable scan) + pipeline() + getClient() escape hatches
- CACHE-022 ✅ 2026-05-31 — flushNamespace via SCAN + UNLINK with the production safety guard (allowFlushInProduction)
- CACHE-023 ✅ 2026-05-31 — wired CacheService + BYMAX_CACHE_SERIALIZER (useClass JsonSerializer) into forRoot; Phase 2 barrel surface. NOTE: CacheService uses explicit `@Inject(ConnectionManager)`/`@Inject(KeyBuilder)` — the published bundle is built without emitDecoratorMetadata, so implicit type DI breaks in dist (CLAUDE.md §5); caught by the runtime smoke test
- CACHE-024 ✅ 2026-05-31 — CacheService string/numeric/expire/batch specs (with INCR-vs-INCRBY routing assertions)
- CACHE-025 ✅ 2026-05-31 — CacheService hash/set/scan/flushNamespace specs (cluster-mode throws via scanStream shadowing; empty-chunk skip via controlled stream; env guard in all three modes)
- CACHE-026 ✅ 2026-05-31 — Phase 2 runtime smoke test PASSED against local Redis (set/get, incr, hash, scan, flushNamespace); bundle server 8.56 KB / shared 0.38 KB brotli (budgets 14 / 1.5 KB)
- CACHE-027 ✅ 2026-05-31 — Phase 2 validation: typecheck + lint (0/0) + test:cov (100% stmts/branches/funcs/lines, 158 tests) + build + size all green; `/security-review` (0 findings) + `/bymax-quality:code-review` (4-lens adversarial workflow: 8 confirmed findings applied — 1 fail-closed bug fix + 7 mutation/JSDoc hardenings — 13 false positives rejected)

> **Phase 2 verified-clean note:** the only production behavior change beyond the planned skeleton is the explicit `@Inject` DI fix (CACHE-023) and the top-level `undefined`/function guard in `JsonSerializer.serialize` (fail-closed at write time). Mutation testing (Stryker, Node 24) remains the Phase 4/5 release gate — Phase 2 tests were proactively hardened against the surviving mutants the review identified.

---

## Phase 3 — Pub/Sub + ScriptManager + Health Check

> **Phase objective:** `PubSubService` (publish/subscribe/psubscribe with lazy subscriber via `createSubscriberClient`) + `ScriptManagerService` (register/load/eval with EVALSHA + NOSCRIPT fallback) + health check (`isHealthy/ping/info`) in `CacheService` + wiring of pre-registered scripts via `options.scripts`.
> **Complexity:** MEDIUM.
> **Total:** 12 tasks.

### CACHE-028: PubSubService — publish/subscribe/psubscribe with lazy subscriber

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-014, CACHE-016
- **Agent:** database-reviewer

**Description:** Pub/Sub facade — publish via main client, subscribe via dedicated subscriber (lazy + dup connection via `createSubscriberClient`). Auto-namespacing of channels. Listener errors swallowed.

**Required reading:**

- `docs/development_plan.md` §4.1 (complete pubsub.service.ts skeleton)
- `docs/technical_specification.md` §8 (Pub/Sub)

**Prompt for the agent:**

> Create `src/server/services/pubsub.service.ts` as per the skeleton in `docs/development_plan.md` §4.1:
>
> - `@Injectable()` implements `OnModuleDestroy`
> - Constructor injects `@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions`, `connection: ConnectionManager`, `keyBuilder: KeyBuilder`, `@Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer`. Serializer priority: `options.serializer ?? injectedSerializer ?? new JsonSerializer()`.
> - `subscriber: Redis | null = null` (private, lazy)
> - `publish<T>(channel, message): Promise<number>` — `keyBuilder.applyNamespace(channel)` + `serializer.serialize(message)` + `(connection.getClient() as Redis).publish(full, raw)`
> - `subscribe<T>(channel, handler: IPubSubHandler<T>): Promise<Unsubscribe>`:
>   - `ensureSubscriber()` (creates via `connection.createSubscriberClient()` if still null)
>   - `await sub.subscribe(full)`
>   - Listener `async (incoming, raw) => {...}`:
>     - Checks `incoming === full` (ignores other channels of the same subscriber)
>     - try/catch around `deserialize` + `handler` → error is **swallowed** (a handler that crashes should not crash the subscriber)
>   - `sub.on('message', listener)`
>   - Returns `Unsubscribe = async () => { sub.off('message', listener); await sub.unsubscribe(full) }`
> - `psubscribe<T>(pattern, handler: IPubSubPatternHandler<T>)`:
>   - Analogous, but listener `(matchedPattern, channel, raw)`, `sub.on('pmessage', listener)`, `punsubscribe`
> - `onModuleDestroy()`:
>   - If subscriber exists, close with `Promise.race([quit(), timeout])`; on fallback, `disconnect()`
> - private `ensureSubscriber(): Redis`:
>   - Reuse if `subscriber.status === 'ready'`
>   - Otherwise create via `connection.createSubscriberClient() as Redis`

**Acceptance criteria:**

- [x] `publish()` returns number of subscribers
- [x] `subscribe()` creates subscriber ONCE (lazy)
- [x] Multiple `subscribe()` on distinct channels reuse the same subscriber
- [x] Published message arrives at handler with deserialized payload
- [x] Error in handler does not crash subscriber
- [x] Unsubscribe returned by `subscribe()` disconnects listener
- [x] `psubscribe('users:*')` receives matching messages
- [x] `onModuleDestroy` closes subscriber gracefully
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 3 12→11, DONE 27→28, Progress 8%; TOTAL 31→30, 27→28, 48%
4. Commit: `feat(cache): add PubSubService with lazy subscriber (CACHE-028)`

---

### CACHE-029: ScriptManagerService — register/load/eval + NOSCRIPT fallback

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-014
- **Agent:** database-reviewer

**Description:** Service that manages Lua scripts — `SCRIPT LOAD` caches SHA1, `EVALSHA` executes, on `NOSCRIPT` reloads and retries.

**Required reading:**

- `docs/development_plan.md` §4.2 (complete script-manager.service.ts skeleton)
- `docs/technical_specification.md` §9 (Lua Scripts and ScriptManager)

**Prompt for the agent:**

> Create `src/server/services/script-manager.service.ts` as per the skeleton in `docs/development_plan.md` §4.2:
>
> - `@Injectable()` implements `OnModuleInit`
> - Internal interface `ScriptEntry { lua: string; sha?: string }`
> - private `scripts: Map<string, ScriptEntry>`
> - Constructor: `@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions`, `connection: ConnectionManager`. Populates the `scripts` map with `options.scripts ?? []`.
> - `onModuleInit()`:
>   - Skip if `options.connection?.lazyConnect` (load deferred until first eval)
>   - Iterates scripts and calls `this.load(name)` for each
> - `register(name, lua): void` — `scripts.set(name, { lua })`
> - `load(name): Promise<string>`:
>   - Throws `SCRIPT_NOT_REGISTERED` if name unknown
>   - If `entry.sha` not cached, `client.script('LOAD', entry.lua)` and cache
>   - Returns SHA1
> - `eval(name, keys, args): Promise<unknown>`:
>   - Throws `SCRIPT_NOT_REGISTERED` if name unknown
>   - If `entry.sha` undefined, await `this.load(name)`
>   - try `client.evalsha(entry.sha, keys.length, ...keys, ...args)`
>   - catch:
>     - If message includes `'NOSCRIPT'` → reloads (`script LOAD`), retry once. If retry fails, throws `SCRIPT_EXECUTION_FAILED`
>     - Otherwise → throws `SCRIPT_EXECUTION_FAILED` (wrap original message in `details.originalError`)
>
> Lua return is `unknown` (intentional — Redis Lua dynamic types).

**Acceptance criteria:**

- [x] `register(name, lua)` adds to the registry
- [x] `onModuleInit` pre-loads scripts (unless lazyConnect)
- [x] `load(name)` calls SCRIPT LOAD and caches SHA1
- [x] `load` is idempotent
- [x] `load(unknown)` throws `SCRIPT_NOT_REGISTERED`
- [x] `eval` calls EVALSHA with `keys.length` + spread
- [x] `eval` on NOSCRIPT reloads and retries once
- [x] Real error (not NOSCRIPT) wrapped as `SCRIPT_EXECUTION_FAILED`
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 3 11→10, DONE 28→29, Progress 17%; TOTAL 30→29, 28→29, 50%
4. Commit: `feat(cache): add ScriptManagerService with NOSCRIPT fallback (CACHE-029)`

---

### CACHE-030: CacheService.eval — delegates to ScriptManagerService

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-022, CACHE-029
- **Agent:** code-reviewer

**Description:** Add `eval` method to `CacheService` that applies namespace to keys and delegates to `ScriptManagerService`.

**Required reading:**

- `docs/development_plan.md` §4.3 (CacheService.eval skeleton)

**Prompt for the agent:**

> Modify `src/server/services/cache.service.ts`:
>
> 1. Add `@Optional() private readonly scriptRegistry?: ScriptManagerService` to the constructor (last parameter, after `injectedSerializer`)
> 2. Add method:
>    ```typescript
>    async eval(scriptName: string, keys: readonly string[], args: ReadonlyArray<string | number>): Promise<unknown> {
>      if (!this.scriptRegistry) {
>        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
>      }
>      const prefixedKeys = keys.map((k) => this.keyBuilder.applyNamespace(k))
>      return this.scriptRegistry.eval(scriptName, prefixedKeys, args)
>    }
>    ```
>
> JSDoc with `@example` showing typical use (compare-and-set Lua).

**Acceptance criteria:**

- [x] `eval` without registered `ScriptManagerService` throws `SCRIPT_REGISTRY_MISSING`
- [x] Keys are namespaced BEFORE arriving at ScriptManager
- [x] Args passed without transformation
- [x] Return propagates unchanged (`unknown`)
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 3 10→9, DONE 29→30, Progress 25%; TOTAL 29→28, 29→30, 52%
4. Commit: `feat(cache): add CacheService.eval delegating to ScriptManagerService (CACHE-030)`

---

### CACHE-031: CacheService — health check methods (isHealthy/ping/info)

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-019
- **Agent:** database-reviewer

**Description:** Health check methods useful for `@nestjs/terminus` integration.

**Required reading:**

- `docs/development_plan.md` §4.4 (health methods skeleton)

**Prompt for the agent:**

> Add to the `CacheService` class:
>
> ```typescript
> async isHealthy(): Promise<boolean> {
>   try {
>     const pong = await this.connection.getClient().ping()
>     return pong === 'PONG'
>   } catch {
>     return false
>   }
> }
>
> async ping(): Promise<string> {
>   return this.connection.getClient().ping()
> }
>
> async info(section?: string): Promise<string> {
>   const client = this.connection.getClient() as Redis
>   return section ? client.info(section) : client.info()
> }
> ```
>
> JSDoc:
>
> - `isHealthy` **NEVER** throws (internal catch) — for health endpoints
> - `ping` throws on closed connection (low-level use)
> - `info(section?)` returns Redis INFO string; optional section (`'memory'`, `'clients'`, etc.)

**Acceptance criteria:**

- [x] `isHealthy()` returns `true` when Redis responds `PONG`
- [x] `isHealthy()` returns `false` (does not throw) when ping fails
- [x] `ping()` returns `'PONG'` on healthy connection
- [x] `ping()` throws on closed connection
- [x] `info()` returns string with Redis INFO
- [x] `info('memory')` returns only memory section
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 3 9→8, DONE 30→31, Progress 33%; TOTAL 28→27, 30→31, 53%
4. Commit: `feat(cache): add health check methods (CACHE-031)`

---

### CACHE-032: Wire PubSubService + ScriptManagerService in module + update barrel

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-028, CACHE-029, CACHE-030
- **Agent:** architect

**Description:** Add `PubSubService` + `ScriptManagerService` to `BymaxCacheModule.forRoot()`. Update barrel for Phase 3 surface.

**Required reading:**

- `docs/development_plan.md` §4.5 (wire updates)
- `docs/development_plan.md` §4.6 (barrel update)

**Prompt for the agent:**

> 1. In `src/server/bymax-cache.module.ts` `forRoot()`, add to providers:
>    ```typescript
>    PubSubService,
>    ScriptManagerService,
>    { provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },
>    ```
>    And to exports:
>    ```typescript
>    PubSubService,
>    ScriptManagerService,
>    BYMAX_CACHE_SCRIPT_REGISTRY,
>    ```
> 2. In `src/server/index.ts`, add:
>    ```typescript
>    export { PubSubService } from './services/pubsub.service'
>    export { ScriptManagerService } from './services/script-manager.service'
>    ```

**Acceptance criteria:**

- [x] `module.get(PubSubService)` functional
- [x] `module.get(ScriptManagerService)` with pre-registered scripts (when provided)
- [x] `CacheService.eval` resolves `ScriptManagerService` via DI
- [x] Barrel updated
- [x] `pnpm typecheck && pnpm build` pass

**Validation commands:**

```bash
pnpm typecheck && pnpm build
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 3 8→7, DONE 31→32, Progress 42%; TOTAL 27→26, 31→32, 55%
4. Commit: `feat(cache): wire PubSub and ScriptManager into module (CACHE-032)`

---

### CACHE-033: Tests — PubSubService (publish/subscribe roundtrip + error swallowing)

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-028
- **Agent:** tester

**Description:** Specs covering publish→subscribe roundtrip + error swallowing + listener cleanup. Uses `ioredis-mock` (which supports basic Pub/Sub).

**Required reading:**

- `docs/development_plan.md` §4.7 (pubsub.service.spec.ts skeleton)

**Prompt for the agent:**

> Create `src/server/services/pubsub.service.spec.ts` as per the sample in §4.7. `jest.mock('ioredis')` structure with `ioredis-mock`.
>
> Cases (5+):
>
> 1. publish → subscribe delivers deserialized message to handler
> 2. Handler that throws does **not** crash subscriber (next publish still works)
> 3. Unsubscribe returned by `subscribe()` disconnects specific listener (publish after off does not arrive)
> 4. Channels are namespaced (`ps:events` instead of `events`) — verify via spy
> 5. `onModuleDestroy` closes subscriber gracefully
>
> 95% coverage on pubsub.service.ts.

**Acceptance criteria:**

- [x] 5+ cases
- [x] 95% coverage

**Validation commands:**

```bash
pnpm test src/server/services/pubsub.service.spec.ts
```

**Completion protocol:**

1. All pass
2. `Status` → DONE
3. Dashboard: Phase 3 7→6, DONE 32→33, Progress 50%; TOTAL 26→25, 32→33, 57%
4. Commit: `test(cache): add PubSubService tests (CACHE-033)`

---

### CACHE-034: Tests — ScriptManagerService (eval happy path + NOSCRIPT recovery + errors)

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-029
- **Agent:** tester

**Description:** Specs covering all ScriptManager paths — `ioredis-mock` does not fully support evalsha, so manually mock `client.script`/`client.evalsha`.

**Required reading:**

- `docs/development_plan.md` §4.7 (script-manager.service.spec.ts skeleton)

**Prompt for the agent:**

> Create `src/server/services/script-manager.service.spec.ts` as per the sample in §4.7:
>
> Structure — mock manually:
>
> ```typescript
> mockClient = {
>   script: jest.fn().mockResolvedValue('abc123'),
>   evalsha: jest.fn().mockResolvedValue(['ok'])
> }
> connection = { getClient: () => mockClient } as never as ConnectionManager
> ```
>
> Cases (7+):
>
> 1. `onModuleInit` pre-registers scripts from the option
> 2. `load(name)` calls SCRIPT LOAD and caches SHA
> 3. `load` idempotent — second call uses cache
> 4. `load(unknown)` throws `SCRIPT_NOT_REGISTERED`
> 5. `eval(name, keys, args)` calls `evalsha(sha, keys.length, ...keys, ...args)`
> 6. NOSCRIPT recovery: first `evalsha` rejects with `Error('NOSCRIPT In the matching script')`, reloads via `script('LOAD', lua)`, retry `evalsha` resolves
> 7. Non-NOSCRIPT error wrapped as `SCRIPT_EXECUTION_FAILED`
> 8. Dynamic `register` adds to map
>
> 95% coverage.

**Acceptance criteria:**

- [x] 7+ cases
- [x] NOSCRIPT recovery path tested
- [x] 95% coverage

**Validation commands:**

```bash
pnpm test src/server/services/script-manager.service.spec.ts
```

**Completion protocol:**

1. All pass; 95% coverage
2. `Status` → DONE
3. Dashboard: Phase 3 6→5, DONE 33→34, Progress 58%; TOTAL 25→24, 33→34, 59%
4. Commit: `test(cache): add ScriptManagerService tests (CACHE-034)`

---

### CACHE-035: Tests — CacheService.eval + health methods

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-030, CACHE-031
- **Agent:** tester

**Description:** Additional specs for `cache.service.spec.ts` covering `eval` + health.

**Required reading:**

- `docs/development_plan.md` §4.7

**Prompt for the agent:**

> Extend `src/server/services/cache.service.spec.ts` with `describe` blocks:
>
> `describe('eval')`:
>
> 1. Without registered `ScriptManagerService`, throws `SCRIPT_REGISTRY_MISSING`
> 2. With mocked `ScriptManagerService`, calls `scriptRegistry.eval` with namespaced keys
> 3. Args passed without transformation
> 4. Lua return propagates
>
> `describe('health')`: 5. `isHealthy()` returns true on PONG 6. `isHealthy()` returns false (does not throw) when ping fails — mock `getClient().ping` to throw 7. `ping()` returns 'PONG' 8. `info()` returns string containing redis_version (ioredis-mock may return empty string — alternatively mock) 9. `info('memory')` only memory section
>
> 95% combined coverage.

**Acceptance criteria:**

- [x] 9 additional cases
- [x] 95% coverage

**Validation commands:**

```bash
pnpm test src/server/services/cache.service.spec.ts -- -t 'eval\|health'
```

**Completion protocol:**

1. All pass; 95% coverage
2. `Status` → DONE
3. Dashboard: Phase 3 5→4, DONE 34→35, Progress 67%; TOTAL 24→23, 34→35, 60%
4. Commit: `test(cache): add eval and health tests (CACHE-035)`

---

### CACHE-036: Phase 3 smoke test + bundle size validation

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-032, CACHE-033, CACHE-034, CACHE-035
- **Agent:** general-purpose

**Description:** Smoke test covering PubSub + Scripts + Health against local Redis.

**Required reading:**

- `docs/development_plan.md` §4.7 (Phase 3 Smoke test)

**Prompt for the agent:**

> Run the smoke test as per `docs/development_plan.md` §4.7 against local Redis (port 6379):
>
> ```javascript
> // /tmp/cache-smoke-phase3.mjs
> import { Module } from '@nestjs/common'
> import { NestFactory } from '@nestjs/core'
> import {
>   BymaxCacheModule,
>   CacheService,
>   PubSubService
> } from '/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/dist/server/index.mjs'
>
> const COMPARE_AND_SET_LUA = `
>   if redis.call('GET', KEYS[1]) == ARGV[1] then
>     redis.call('SET', KEYS[1], ARGV[2])
>     return 1
>   end
>   return 0
> `
>
> @Module({
>   imports: [
>     BymaxCacheModule.forRoot({
>       connection: { url: 'redis://localhost:6379' },
>       namespace: 'smoke3',
>       scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
>     })
>   ]
> })
> class App {}
>
> const app = await NestFactory.createApplicationContext(App, { logger: false })
> const cache = app.get(CacheService)
> const pubsub = app.get(PubSubService)
>
> console.log('Healthy:', await cache.isHealthy())
> const off = await pubsub.subscribe('events', async (m) => console.log('Got:', m))
> await pubsub.publish('events', { type: 'created', id: '1' })
> await new Promise((r) => setTimeout(r, 100))
> await off()
>
> await cache.set('counter', 'k', '1')
> const swapped = await cache.eval('cas', ['counter:k'], ['1', '2'])
> console.log('Swapped:', swapped, 'After:', await cache.get('counter', 'k'))
> await app.close()
> ```
>
> Expected:
>
> - `Healthy: true`
> - `Got: { type: 'created', id: '1' }`
> - `Swapped: 1 After: "2"`
>
> Bundle: `pnpm size` server entry < 14 KiB brotli.
>
> If local Redis not available, mark REVIEW.

**Acceptance criteria:**

- [x] Smoke test passes OR step marked REVIEW
- [x] Bundle size within budget

**Validation commands:**

```bash
pnpm build && pnpm size
node /tmp/cache-smoke-phase3.mjs  # optional
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 3 4→3, DONE 35→36, Progress 75%; TOTAL 23→22, 35→36, 62%
4. Commit: `chore(cache): Phase 3 smoke test and bundle check (CACHE-036)`

---

### CACHE-037: Phase 3 validation

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-028 to CACHE-036
- **Agent:** code-reviewer

**Description:** Consolidated validation of Phase 3.

**Required reading:**

- `docs/development_plan.md` §4.7 (Phase 3 Done criteria)

**Prompt for the agent:**

> Run in sequence:
>
> ```bash
> pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
> ```
>
> Validate:
>
> - `typecheck`: zero errors
> - `lint`: zero warnings
> - `test:cov`: global ≥ 80%; critical paths (`cache.service.ts`, `pubsub.service.ts`, `script-manager.service.ts`, `connection.manager.ts`, `key-builder.ts`, `parse-redis-url.ts`, `default-options.ts`) ≥ 95%
> - `build`: complete dist
> - `size`: server < 14 KiB brotli, shared < 1.5 KiB brotli
>
> Run `/bymax-quality:code-review` for end findings.
>
> If EVERYTHING passes, mark Phase 3 as Done.

**Acceptance criteria:**

- [x] All 5 commands pass
- [x] `/bymax-quality:code-review` executed and findings applied
- [x] In the Phase 3 task pending

**Validation commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 3 3→2, DONE 36→37, Progress 83%; TOTAL 22→21, 36→37, 64%
4. Commit: `chore(cache): complete Phase 3 validation (CACHE-037)`

---

### CACHE-038: Stub forRootAsync skeleton (Phase 4 preparation)

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** Low
- **Dependencies:** CACHE-032
- **Agent:** architect

**Description:** Add `forRootAsync` stub throwing NotImplementedError. Marks the public surface for consumers to start using in fixtures, complete in Phase 4.

**Required reading:**

- `docs/development_plan.md` §5.1 (forRootAsync skeleton)

**Prompt for the agent:**

> Add to the `BymaxCacheModule` class:
>
> ```typescript
> static forRootAsync(_asyncOptions: BymaxCacheModuleAsyncOptions): DynamicModule {
>   throw new Error('[BymaxCacheModule] forRootAsync is implemented in Phase 4 (CACHE-040)')
> }
> ```
>
> Add `BymaxCacheModuleAsyncOptions` to the barrel if not yet exported.

**Acceptance criteria:**

- [x] Stub method created with public signature
- [x] Throws documenting that real implementation is in Phase 4
- [x] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 3 2→1, DONE 37→38, Progress 92%; TOTAL 21→20, 37→38, 66%
4. Commit: `feat(cache): stub forRootAsync signature for Phase 4 (CACHE-038)`

---

### CACHE-039: Refactor — extract buildCommonProviders helper (Phase 4 preparation)

- **Phase:** 3
- **Status:** ✅ DONE
- **Priority:** Low
- **Dependencies:** CACHE-032
- **Agent:** architect

**Description:** Extract list of shared providers between `forRoot` (current) and `forRootAsync` (Phase 4) into a private static method. Reduces future duplication.

**Required reading:**

- `docs/development_plan.md` §5.2 (refactor for reuse)

**Prompt for the agent:**

> Refactor `src/server/bymax-cache.module.ts`:
>
> ```typescript
> private static buildCommonProviders(): Provider[] {
>   return [
>     { provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer },
>     ConnectionManager,
>     KeyBuilder,
>     CacheService,
>     PubSubService,
>     ScriptManagerService,
>     { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder },
>     { provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },
>   ]
> }
>
> private static buildCommonExports(): unknown[] {
>   return [
>     BYMAX_CACHE_OPTIONS,
>     BYMAX_CACHE_KEY_BUILDER,
>     BYMAX_CACHE_SCRIPT_REGISTRY,
>     BYMAX_CACHE_SERIALIZER,
>     ConnectionManager,
>     KeyBuilder,
>     CacheService,
>     PubSubService,
>     ScriptManagerService,
>   ]
> }
> ```
>
> Update `forRoot` to use `[...initial providers, ...this.buildCommonProviders()]` and `[...base exports, ...this.buildCommonExports()]`.
>
> Existing tests in `bymax-cache.module.spec.ts` must continue to pass without changes.

**Acceptance criteria:**

- [x] `buildCommonProviders` and `buildCommonExports` private/static
- [x] `forRoot` reuses both
- [x] List of providers/exports before and after refactoring is equivalent
- [x] Module tests continue to pass
- [x] `pnpm typecheck && pnpm test src/server/bymax-cache.module.spec.ts` pass

**Validation commands:**

```bash
pnpm typecheck && pnpm test src/server/bymax-cache.module.spec.ts
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 3 1→0, DONE 38→39, Progress 100% ✅; TOTAL 20→19, 38→39, 67%
4. Commit: `refactor(cache): extract common providers/exports for module reuse (CACHE-039)`

---

### Phase 3 — Completion Log

- CACHE-028 ✅ 2026-05-31 — PubSubService (publish via main client; lazy dedicated subscriber for subscribe/psubscribe; namespaced channels/patterns; handler errors swallowed AND forwarded to the `ICacheEvents` observability callback as an `error`/`handler_error` event; graceful/forced shutdown)
- CACHE-029 ✅ 2026-05-31 — ScriptManagerService (register/load via SCRIPT LOAD + cached SHA; EVALSHA with NOSCRIPT reload-and-retry-once; eager preload moved to `onApplicationBootstrap`)
- CACHE-030 ✅ 2026-05-31 — CacheService.eval (namespaces keys, delegates to ScriptManagerService via `@Optional() @Inject`; SCRIPT_REGISTRY_MISSING when unwired)
- CACHE-031 ✅ 2026-05-31 — CacheService health (isHealthy never-throws / ping / info[section])
- CACHE-032 ✅ 2026-05-31 — wired PubSubService + ScriptManagerService + BYMAX_CACHE_SCRIPT_REGISTRY into forRoot; Phase 3 barrel surface
- CACHE-033 ✅ 2026-05-31 — PubSubService specs (delivery + namespacing, error swallowing, detach, pattern match, destroy paths)
- CACHE-034 ✅ 2026-05-31 — ScriptManagerService specs (load/idempotent/unknown, EVALSHA, NOSCRIPT recovery + failed retry, error wrapping, register, bootstrap)
- CACHE-035 ✅ 2026-05-31 — CacheService eval + health specs
- CACHE-036 ✅ 2026-05-31 — Phase 3 runtime smoke PASSED against Redis (health, subscribe, psubscribe, CAS eval, NOSCRIPT recovery after SCRIPT FLUSH); bundle server 11.54 KB / shared 0.40 KB brotli
- CACHE-037 ✅ 2026-05-31 — Phase 3 validation: typecheck + lint (0/0) + test:cov (100% stmts/branches/funcs/lines, 192 tests) + build + size all green; 4-lens adversarial review (7 confirmed → 4 mutation-hardening fixes applied, 1 reject [cluster Pub/Sub guard — contradicts experimental-passthrough spec], 11 false positives rejected)
- CACHE-038 ✅ 2026-05-31 — forRootAsync stub satisfied early (the Phase-1 override already throws a Phase-4 NotImplemented error; `BymaxCacheModuleAsyncOptions` already exported)
- CACHE-039 ✅ 2026-05-31 — extracted `buildCommonProviders(resolved)` / `buildCommonExports()` (Phase-4 reuse; preserves the conditional serializer provider)

> **Phase 3 notes:** two real bugs surfaced by the runtime smoke (unit tests structurally cannot catch them): (1) eager script preload in `onModuleInit` raced ConnectionManager's connect (NestJS runs onModuleInit concurrently) → moved to `onApplicationBootstrap`; (2) the lazy subscriber wasn't writable when `subscribe()` ran (offline queue disabled) → `createSubscriberClient` now enables the subscriber's offline queue (control-plane buffering; the data-plane main client stays fail-fast). Also DRY'd the identical serializer resolution into `resolveSerializer`. Two `/bymax-quality:code-review` follow-up passes drove: PubSubService now forwards swallowed handler errors to the `ICacheEvents` callback (observability, matching ConnectionManager), and three unnecessary `as Redis` casts were removed — two in ScriptManagerService (`script`/`evalsha`) and one for the PubSub subscriber (`subscribe`/`psubscribe`/`unsubscribe`/`punsubscribe` are all typed on the `Redis | Cluster` union via RedisCommander). The two remaining `as Redis` casts (the `isScannableClient` probe and the `getClient()` escape hatch, both in cache.service.ts) are intentional documented narrowings. Mutation testing (Stryker, Node 24) remains the Phase 4/5 release gate; Phase 3 tests were proactively hardened against the surviving mutants the review identified.

---

## Phase 4 — forRootAsync + E2E + Mutation Baseline

> **Phase objective:** `BymaxCacheModule.forRootAsync()` (canonical NestJS async dynamic module pattern), complete E2E suite (ioredis-mock + Testcontainers), 100% coverage (release gate via `test:cov:all`), mutation baseline ≥ 85%.
> **Complexity:** HIGH — async DI wiring + E2E isolation + mutation testing may reveal weak tests.
> **Total:** 9 tasks.

### CACHE-040: BymaxCacheModule.forRootAsync() — async dynamic module

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-038, CACHE-039
- **Agent:** architect

**Description:** Implement real `forRootAsync` replacing the stub. Canonical NestJS pattern — async factory, `imports`, `inject`, validation after resolve.

**Required reading:**

- `docs/development_plan.md` §5.1 (complete forRootAsync skeleton)

> **⚠️ §0 OVERRIDE — `ConfigurableModuleBuilder`.** Implement `forRootAsync` as
> `static override forRootAsync(options: typeof ASYNC_OPTIONS_TYPE)` on the builder base from
> CACHE-015's `bymax-cache.module.builder.ts`: `return augmentCacheModule(super.forRootAsync(options), buildAsyncProviders())`.
> The `BYMAX_CACHE_OPTIONS` provider's `useFactory` does `validateOptions` + `applyDefaults` and
> injects `BUILDER_OPTIONS_TOKEN`. The manual async-factory skeleton below shows the provider logic.

**Prompt for the agent:**

> Replace the `BymaxCacheModule.forRootAsync` stub with the full implementation as per the skeleton in `docs/development_plan.md` §5.1:
>
> ```typescript
> static forRootAsync(asyncOptions: BymaxCacheModuleAsyncOptions): DynamicModule {
>   const asyncOptionsProvider: Provider = {
>     provide: BYMAX_CACHE_OPTIONS,
>     useFactory: async (...args: unknown[]) => {
>       const userOptions = await asyncOptions.useFactory(...args)
>       validateOptions(userOptions)
>       return applyDefaults(userOptions)
>     },
>     inject: asyncOptions.inject ?? [],
>   }
>
>   return {
>     module: BymaxCacheModule,
>     global: asyncOptions.isGlobal ?? true,
>     imports: asyncOptions.imports ?? [],
>     providers: [
>       asyncOptionsProvider,
>       {
>         provide: BYMAX_CACHE_EVENTS,
>         useFactory: (opts: ResolvedOptions) => opts.events ?? null,
>         inject: [BYMAX_CACHE_OPTIONS],
>       },
>       ...this.buildCommonProviders(),
>     ],
>     exports: this.buildCommonExports(),
>   }
> }
> ```
>
> Critical points:
>
> - Validation INSIDE useFactory (after resolve, before returning)
> - `BYMAX_CACHE_EVENTS` derived via useFactory from `BYMAX_CACHE_OPTIONS`
> - Reuse `buildCommonProviders` / `buildCommonExports` extracted in CACHE-039
> - async/await pattern for async factory (NestJS awaits Promise)
>
> Check consistency with `forRoot` — after refactoring, both entry points must provide the same services and tokens.

**Acceptance criteria:**

- [ ] `forRootAsync({useFactory})` returns valid `DynamicModule`
- [ ] `useFactory` executed with `inject` dependencies resolved
- [ ] Validation happens inside useFactory (not at `forRootAsync` directly)
- [ ] `imports` propagated
- [ ] `isGlobal` respected (default true)
- [ ] Same services/tokens as `forRoot` provided
- [ ] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Completion protocol:**

1. Typecheck OK
2. `Status` → DONE
3. Dashboard: Phase 4 9→8, DONE 39→40, Progress 11%; TOTAL 19→18, 39→40, 69%
4. Commit: `feat(cache): implement BymaxCacheModule.forRootAsync (CACHE-040)`

---

### CACHE-041: Tests — forRootAsync (with ConfigService stub + async factory + imports)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-040
- **Agent:** tester

**Description:** Specs covering `forRootAsync` — factory resolution, inject, imports, validation throws.

**Required reading:**

- `docs/development_plan.md` §5.1

**Prompt for the agent:**

> Create `src/server/bymax-cache.module.async.spec.ts` (separate from `bymax-cache.module.spec.ts` for clarity).
>
> Cases (5+):
>
> 1. `forRootAsync({useFactory: async () => ({connection: {host: 'h'}})})` instantiates ConnectionManager + CacheService
> 2. `useFactory` with `inject: [ConfigService]` — ConfigService stub provided via `imports`, options resolved correctly
> 3. `imports` propagated to the DynamicModule
> 4. Factory that returns invalid options (`namespace: ''`) makes bootstrap reject (promise rejection captured)
> 5. `isGlobal: false` respected
> 6. Logs/events of `BYMAX_CACHE_EVENTS` derived via useFactory work
>
> 95% coverage on `bymax-cache.module.ts` (combined with `bymax-cache.module.spec.ts`).

**Acceptance criteria:**

- [ ] 5+ scenarios
- [ ] 95% coverage

**Validation commands:**

```bash
pnpm test src/server/bymax-cache.module.async.spec.ts
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 8→7, DONE 40→41, Progress 22%; TOTAL 18→17, 40→41, 71%
4. Commit: `test(cache): add forRootAsync tests (CACHE-041)`

---

### CACHE-042: E2E fixtures — test-cache-app.module + helpers (Testcontainers wrapper)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-040
- **Agent:** tester

**Description:** E2E suite setup — NestJS fixture app module + Testcontainers wrapper for spawning isolated Redis 7.

**Required reading:**

- `docs/development_plan.md` §5.3 (helper + fixture skeletons)

**Prompt for the agent:**

> Create:
>
> 1. `test/helpers/start-redis-container.ts`:
>
>    ```typescript
>    import { GenericContainer, type StartedTestContainer } from 'testcontainers'
>
>    export async function startRedisContainer(): Promise<{
>      container: StartedTestContainer
>      url: string
>    }> {
>      const container = await new GenericContainer('redis:7-alpine')
>        .withExposedPorts(6379)
>        .withCommand(['redis-server', '--save', ''])
>        .start()
>      const host = container.getHost()
>      const port = container.getMappedPort(6379)
>      return { container, url: `redis://${host}:${port}` }
>    }
>    ```
>
> 2. `test/helpers/wait-for-event.ts` — utility to `await` ioredis events in tests (promisifies `client.once`).
> 3. `test/fixtures/test-cache-app.module.ts` — module factory that accepts a Redis URL and creates a NestJS fixture app with `BymaxCacheModule.forRoot({connection: {url}, namespace: 'e2e', scripts: [...]})`.
>
> Validate that `pnpm test:e2e` still passes with 0 tests (no specs yet — confirms config).

**Acceptance criteria:**

- [ ] 3 files created
- [ ] Testcontainers wrapper boots Redis in < 30s
- [ ] `pnpm test:e2e` passes with 0 tests (config validation)

**Validation commands:**

```bash
pnpm test:e2e
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 7→6, DONE 41→42, Progress 33%; TOTAL 17→16, 41→42, 72%
4. Commit: `test(cache): add E2E fixtures and helpers (CACHE-042)`

---

### CACHE-043: E2E specs — CacheService + PubSubService (ioredis-mock unit-fast)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-042
- **Agent:** tester

**Description:** Fast E2E suite using `ioredis-mock` (simple scenarios).

**Required reading:**

- `docs/development_plan.md` §5.3

**Prompt for the agent:**

> Create 2 spec files in `test/`:
>
> 1. `test/cache-service.e2e.spec.ts` — uses `ioredis-mock` (fast). Scenarios:
>    - get/set/incr/expire/ttl roundtrip
>    - mget/mset batch
>    - hash hget/hset/hgetall
>    - set sadd/smembers/sismember
>    - scan async iteration
>    - flushNamespace dev mode
>    - flushNamespace production without allowFlushInProduction throws
> 2. `test/pubsub-service.e2e.spec.ts` — `ioredis-mock`. Scenarios:
>    - publish→subscribe roundtrip
>    - psubscribe pattern matching
>    - Handler error swallowing
>    - Multiple subscribers on the same subscriber client
>    - Unsubscribe via returned function
>    - onModuleDestroy closes gracefully
>
> Each spec boots its own NestJS app via `Test.createTestingModule().compile().createNestApplicationContext()` + `afterAll(async () => app.close())`.

**Acceptance criteria:**

- [ ] 2 spec files
- [ ] `pnpm test:e2e` passes in < 10s
- [ ] Covers end-to-end scenarios (not unit) — every call goes through the full Nest stack

**Validation commands:**

```bash
pnpm test:e2e
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 6→5, DONE 42→43, Progress 44%; TOTAL 16→15, 42→43, 74%
4. Commit: `test(cache): add E2E specs for CacheService and PubSubService (CACHE-043)`

---

### CACHE-044: E2E specs — ScriptManager + connection lifecycle (Testcontainers — real Redis)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-042
- **Agent:** tester

**Description:** E2E suite with real Redis (Testcontainers) for scenarios that `ioredis-mock` does not support — real EVALSHA, NOSCRIPT recovery, reconnection.

**Required reading:**

- `docs/development_plan.md` §5.3 (script-manager.e2e.spec.ts skeleton)

**Prompt for the agent:**

> Create 2 spec files in `test/`:
>
> 1. `test/script-manager.e2e.spec.ts` — Testcontainers (real Redis 7):
>    - `beforeAll` (timeout 60_000ms): `startRedisContainer()` + boot NestJS app with `forRoot({connection: {url}, scripts: [{name: 'cas', lua: COMPARE_AND_SET_LUA}]})`
>    - `afterAll`: `app.close() + container.stop()`
>    - Cases:
>      a. Execute Lua atomically (compare-and-set: set k=1, eval cas with [1, 2], verify k=2)
>      b. NOSCRIPT recovery: set k=5, run `cache.getClient().script('FLUSH')`, next eval reloads transparently
>      c. Initial EVALSHA uses cached SHA (verify via spy on client.script)
> 2. `test/connection-lifecycle.e2e.spec.ts` — Testcontainers:
>    - Boot + ready event received via `events.onEvent`
>    - Pause container (`container.stop()`) → reconnecting event → restart container → reconnect
>    - Graceful shutdown: `app.close()` → close/end events received
>
> Each describe boots its own container (slow but deterministic).

**Acceptance criteria:**

- [ ] 2 spec files
- [ ] `pnpm test:e2e` (including Testcontainers) passes
- [ ] Total e2e suite time < 5 min (mostly contained boots)

**Validation commands:**

```bash
pnpm test:e2e
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 5→4, DONE 43→44, Progress 56%; TOTAL 15→14, 43→44, 76%
4. Commit: `test(cache): add E2E specs with Testcontainers (CACHE-044)`

---

### CACHE-045: 100% coverage release gate (test:cov:all)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-041 to CACHE-044
- **Agent:** tester

**Description:** Reach 100% coverage in `test:cov:all` (release gate). Focus on paths not covered by unit tests.

**Required reading:**

- `docs/development_plan.md` §5.4 (typically missing areas)

**Prompt for the agent:**

> Run:
>
> ```bash
> pnpm test:cov:all
> ```
>
> Typically missing areas after Phases 1-3:
>
> - Branches in `parseRedisUrl` (URL without username, without password, without db, with complex path)
> - Rare error paths in `ConnectionManager` (cluster without options, quit resolving within the timeout, all 6 listeners firing)
> - `flushNamespace` in cluster mode (throw branch)
> - `eval` NOSCRIPT retry — second error path (`SCRIPT_EXECUTION_FAILED` on retry)
> - `PubSubService.psubscribe` (paths separated from `subscribe`)
> - `ScriptManagerService.onModuleInit` with lazyConnect: true (skip path)
> - `applyDefaults` with each option varying
>
> For each missing branch, add a test case OR ignore via `/* istanbul ignore next */` with comment explaining why it's impossible.
>
> Validate:
>
> - `jest.coverage.config.ts` thresholds reached: statements 100%, branches 100%, functions 100%, lines 100%

**Acceptance criteria:**

- [ ] `pnpm test:cov:all` passes with 100% on the 4 thresholds
- [ ] Ignorations documented with inline comment

**Validation commands:**

```bash
pnpm test:cov:all
```

**Completion protocol:**

1. 100% coverage
2. `Status` → DONE
3. Dashboard: Phase 4 4→3, DONE 44→45, Progress 67%; TOTAL 14→13, 44→45, 78%
4. Commit: `test(cache): reach 100% coverage release gate (CACHE-045)`

---

### CACHE-046: Mutation testing baseline (Stryker)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-045
- **Agent:** code-reviewer

**Description:** Run Stryker and validate baseline ≥ 85% global, ≥ 95% critical paths.

**Required reading:**

- `docs/development_plan.md` §5.5

**Prompt for the agent:**

> Run:
>
> ```bash
> pnpm mutation:dry-run  # validates config
> pnpm mutation          # full run, ~10-20 min
> ```
>
> Validate:
>
> - Global mutation score ≥ 85%
> - Critical paths ≥ 95%: `parse-redis-url.ts`, `key-builder.ts`, `default-options.ts`, `cache.service.ts`, `script-manager.service.ts`
>
> For equivalent mutants, document inline with:
>
> ```typescript
> // Stryker disable next-line ArithmeticOperator: N+0 == N (equivalent)
> ```
>
> Save report to `reports/mutation/mutation.html`. Update `docs/mutation_testing_results.md` (create if it doesn't exist) with timestamp + score + observations.

**Acceptance criteria:**

- [ ] Global mutation ≥ 85%
- [ ] Critical paths ≥ 95%
- [ ] `reports/mutation/mutation.html` generated
- [ ] `docs/mutation_testing_results.md` created/updated

**Validation commands:**

```bash
pnpm mutation
```

**Completion protocol:**

1. Score reached
2. `Status` → DONE
3. Dashboard: Phase 4 3→2, DONE 45→46, Progress 78%; TOTAL 13→12, 45→46, 79%
4. Commit: `test(cache): mutation testing baseline (CACHE-046)`

---

### CACHE-047: Final bundle size validation + budgets tuning

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-040
- **Agent:** general-purpose

**Description:** Validate real bundle and adjust budgets in `scripts/check-size.mjs` if necessary.

**Required reading:**

- `docs/development_plan.md` §6.5

**Prompt for the agent:**

> Run `pnpm build && pnpm size`. Measures real brotli:
>
> - If `server` > 14 KiB brotli → investigate (probably improper bundling of peer dep like ioredis or @nestjs)
> - If `shared` > 1.5 KiB brotli → investigate (should be ~1.5-2KB of pure constants)
>
> If real values are consistently smaller, **tighten** budgets by ~10-15% (do not leave excessive headroom — favors bloat detection).
>
> Document end values in the commit message + update `scripts/check-size.mjs` if applicable.

**Acceptance criteria:**

- [ ] Real bundle within budgets
- [ ] Budgets calibrated (not over-permissive)

**Validation commands:**

```bash
pnpm build && pnpm size
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 2→1, DONE 46→47, Progress 89%; TOTAL 12→11, 46→47, 81%
4. Commit: `chore(cache): tune bundle size budgets (CACHE-047)`

---

### CACHE-048: Phase 4 validation (end release gate)

- **Phase:** 4
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-040 to CACHE-047
- **Agent:** code-reviewer

**Description:** Consolidated validation with full release gate.

**Required reading:**

- `docs/development_plan.md` §5.6

**Prompt for the agent:**

> Run in sequence:
>
> ```bash
> pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size
> ```
>
> - `test:cov:all` = 100% global (release gate)
> - `test:e2e`: ioredis-mock + Testcontainers pass
> - `size`: server ≤ 14 KiB brotli, shared ≤ 1.5 KiB brotli
>
> Run `/bymax-quality:code-review` for end findings. Apply fixes in a loop.
>
> If EVERYTHING passes, phase complete.

**Acceptance criteria:**

- [ ] Commands above pass
- [ ] 100% coverage in test:cov:all
- [ ] Bundle within budgets
- [ ] Mutation score ≥ 85%
- [ ] code-review applied

**Validation commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size
```

**Completion protocol:**

1. OK
2. `Status` → DONE
3. Dashboard: Phase 4 1→0, DONE 47→48, Progress 100% ✅; TOTAL 11→10, 47→48, 83%
4. Commit: `chore(cache): complete Phase 4 validation (CACHE-048)`

---

## Phase 5 — Release v0.1.0

> **Objective:** Complete documentation, CI workflows, tag, and npm publish.
> **Complexity:** LOW — predominantly mechanical.
> **Total:** 10 tasks.
>
> **⚠️ Scaffold note (2026-05-30):** the repo scaffold ALREADY created README, CHANGELOG, SECURITY,
> CLAUDE, AGENTS, CONTRIBUTING, CODE_OF_CONDUCT, the CI workflows (ci/codeql/scorecard/release),
> dependabot, issue templates, `check-size.mjs`, and `dogfood-smoke-test.mjs`. The Phase 5 tasks
> below should **reconcile/update** these existing files (real usage examples, final budgets,
> changelog entries, version bump) — **not create them from scratch** — and must preserve spec §0.

### CACHE-049: README.md with badges + quick start + 4 scenarios

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-048
- **Agent:** general-purpose

**Description:** README mirroring nest-auth pattern, with 4 complete scenarios (standalone, sentinel, cluster, async).

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/README.md` (template)
- `docs/development_plan.md` §6.1

**Prompt for the agent:**

> Create `README.md` in `/Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/` mirroring the structure of `nest-auth/README.md`:
>
> - Badges: npm version, downloads, CI status, coverage, mutation score, OpenSSF Scorecard, license, TypeScript, Node 24+
> - `## ✨ Overview` — explanation of what the lib is
> - `## 🔥 Features` — bullets of main features (multi-mode connection, namespaced typed helpers, lazy Pub/Sub, Lua scripts with NOSCRIPT fallback, health check, pluggable serializer)
> - `## 📦 Subpath Exports` — table with 2 subpaths (`.` and `./shared`)
> - `## 🚀 Quick Start` — 4 complete copy-pasteable scenarios:
>   1. Standalone (dev) — `BymaxCacheModule.forRoot({connection: {url}})`
>   2. Sentinel (HA) — `mode: 'sentinel'` with sentinels + name
>   3. Cluster (sharded) — `mode: 'cluster'` with nodes
>   4. forRootAsync with `ConfigService` resolving `REDIS_URL`
> - `## 🧩 Configuration` — link to spec §4
> - `## 📖 Cache API Reference` — table with all CacheService methods
> - `## 🪶 Lua Scripts` — example `compareAndSet` + `rateLimitTokenBucket`
> - `## 📡 Pub/Sub` — publish/subscribe example
> - `## ❤️ Health Check (terminus integration)` — snippet `@HealthCheck` using `cache.isHealthy()`
> - `## 🔁 Custom Serializer` — MsgPack example
> - `## 🪪 Default Error Codes` — link to spec §12
> - `## 🧪 Testing` — pnpm commands
> - `## 🔗 Plug with @bymax-one/nest-logger` — example `events.onEvent: (e, d) => logger.log(e, d)`
> - `## 🤝 Contributing` — link SECURITY.md
> - `## 📜 License` — MIT

**Acceptance criteria:**

- [ ] README with all sections
- [ ] 4 copy-pasteable scenarios
- [ ] Badges configured (URLs `bymaxone/nest-cache`)
- [ ] Valid Markdown (no broken links)

**Validation commands:**

```bash
npx markdownlint-cli README.md --no-config || true
```

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 10→9, DONE 48→49, Progress 10%; TOTAL 10→9, 48→49, 84%. Commit: `docs(cache): add README with badges and quick start (CACHE-049)`.

---

### CACHE-050: CHANGELOG.md + SECURITY.md

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-001
- **Agent:** general-purpose

**Description:** Canonical versioning + security policy documents.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/CHANGELOG.md` (structure)
- `/Users/maximiliano/Documents/MyApps/nest-auth/SECURITY.md`
- `docs/development_plan.md` §6.2 + §6.3

**Prompt for the agent:**

> 1. `CHANGELOG.md` — Keep a Changelog format:
>
>    ```markdown
>    # Changelog
>
>    All notable changes to this project will be documented in this file.
>    The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
>    and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
>
>    ## [Unreleased]
>
>    ## [0.1.0] - 2026-XX-XX
>
>    ### Added
>
>    - Initial release
>    - ioredis 5 backed CacheService with namespaced typed helpers (get/set/setNx/del/exists/incr/decr/expire/ttl/mget/mset)
>    - Hash (hget/hset/hgetall/hdel) and Set (sadd/srem/smembers/sismember/scard) commands
>    - KeyBuilder with configurable namespace + separator
>    - ISerializer interface with default JsonSerializer
>    - PubSubService with lazy subscriber connection
>    - ScriptManagerService with EVALSHA + NOSCRIPT auto-reload
>    - Standalone / Sentinel / Cluster connection modes
>    - Graceful shutdown with configurable timeout
>    - Health check methods (isHealthy / ping / info)
>    - Connection lifecycle events via ICacheEvents callback
>    - flushNamespace() with production safety guard
>    - forRoot() and forRootAsync() module configuration
>    - Subpath exports: `.` (server) + `./shared`
>    ```
>
> 2. `SECURITY.md` — copy from nest-auth, adapt:
>    - Responsible disclosure policy
>    - Connection strings and passwords are consumer's responsibility
>    - Lib does NOT log credentials — `events.onEvent` receives `error.message` but without ioredis stack with URLs
>    - Change email/name to `support@bymax.one`

**Acceptance criteria:**

- [ ] CHANGELOG.md with complete 0.1.0 entry
- [ ] SECURITY.md present

**Validation commands:** N/A

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 9→8, DONE 49→50, Progress 20%; TOTAL 9→8, 49→50, 86%. Commit: `docs(cache): add CHANGELOG and SECURITY policy (CACHE-050)`.

---

### CACHE-051: CLAUDE.md + AGENTS.md

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-001
- **Agent:** general-purpose

**Description:** Quick reference for AI agents + detailed usage guide.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/CLAUDE.md`
- `/Users/maximiliano/Documents/MyApps/nest-auth/AGENTS.md`
- `docs/development_plan.md` §6.3

**Prompt for the agent:**

> Copy `CLAUDE.md` and `AGENTS.md` from nest-auth. Adapt:
>
> - Replace `nest-auth` → `nest-cache`
> - Change the Critical Rules list to reflect nest-cache:
>   - ioredis 5 is a peer dep (do not bundle)
>   - Mandatory namespace — every key passes through `KeyBuilder.build()`
>   - Raw strings ONLY via `getClient()` escape hatch
>   - `eval()` return is `unknown` (dynamic Redis Lua)
>   - flushNamespace blocked in production by default
>   - Pub/Sub is fire-and-forget — messages published during offline window are LOST
>   - NOSCRIPT recovery is automatic (consumer doesn't need to deal with it)
>   - Subscriber connection is separate from main (dedicated mode)
> - Subpaths: 2 instead of 5 (`.`, `./shared`)
> - Guidelines Table: add IOREDIS, REDIS-PUB-SUB, REDIS-LUA, NAMESPACE-STRATEGY; remove CRYPTO, JWT, OAUTH
>
> AGENTS.md includes usage patterns, integration with `@bymax-one/nest-logger` via `events.onEvent`, troubleshooting of cluster mode.

**Acceptance criteria:**

- [ ] 2 files created
- [ ] Content reflecting ioredis + Pub/Sub + Lua
- [ ] Correct subpaths

**Validation commands:** N/A

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 8→7, DONE 50→51, Progress 30%; TOTAL 8→7, 50→51, 88%. Commit: `docs(cache): add CLAUDE.md and AGENTS.md (CACHE-051)`.

---

### CACHE-052: CI workflow — ci.yml (typecheck + lint + test + e2e + build + dependency-review)

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-001
- **Agent:** general-purpose

**Description:** GitHub Actions CI workflow running all gates + E2E with Testcontainers.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/.github/workflows/ci.yml`
- `docs/development_plan.md` §6.4

**Prompt for the agent:**

> Copy `.github/workflows/ci.yml` from nest-auth. Adaptations:
>
> - Replace repo name `nest-auth` → `nest-cache`
> - Matrix `node-version: [24.x]`
> - Steps: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm test:e2e`, `pnpm build`, `pnpm size`
> - **Important:** `pnpm test:e2e` requires Docker — GitHub-hosted runners have Docker daemon natively, in the additional setup needed
> - `dependency-review-action` on `pull_request` only
> - `permissions: contents: read` (least privilege)
> - `concurrency: ci-${{ github.ref }} cancel-in-progress: true`

**Acceptance criteria:**

- [ ] `.github/workflows/ci.yml` created
- [ ] `test:e2e` step included
- [ ] Valid syntax

**Validation commands:** N/A (CI validates on push)

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 7→6, DONE 51→52, Progress 40%; TOTAL 7→6, 51→52, 90%. Commit: `ci(cache): add ci.yml workflow (CACHE-052)`.

---

### CACHE-053: CI workflows — codeql.yml + scorecard.yml + release.yml

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-052
- **Agent:** general-purpose

**Description:** 3 additional workflows (security scans + release with provenance).

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/.github/workflows/codeql.yml`
- `/Users/maximiliano/Documents/MyApps/nest-auth/.github/workflows/scorecard.yml`
- `/Users/maximiliano/Documents/MyApps/nest-auth/.github/workflows/release.yml`

**Prompt for the agent:**

> Copy the 3 workflows from nest-auth:
>
> - `codeql.yml` — weekly static analysis + per PR (TypeScript language)
> - `scorecard.yml` — weekly OpenSSF Scorecard + branch_protection_rule
> - `release.yml` — triggered on tag `v*`, runs `pnpm prepublishOnly` + `pnpm publish --provenance` + creates GitHub Release
>
> Adapt `nest-auth` → `nest-cache` references. Keep restrictive `permissions`. In `release.yml`, validate that `id-token: write` is enabled (needed for `--provenance`).

**Acceptance criteria:**

- [ ] 3 workflows created
- [ ] Valid syntax
- [ ] `release.yml` configured for `--provenance`

**Validation commands:** N/A

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 6→5, DONE 52→53, Progress 50%; TOTAL 6→5, 52→53, 91%. Commit: `ci(cache): add codeql, scorecard and release workflows (CACHE-053)`.

---

### CACHE-054: docs/mutation_testing_plan.md + results

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** Medium
- **Dependencies:** CACHE-046
- **Agent:** general-purpose

**Description:** Mutation testing documentation.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/docs/mutation_testing_plan.md`

**Prompt for the agent:**

> Create 2 files in `docs/`:
>
> 1. `mutation_testing_plan.md` — adapted from nest-auth:
>    - Strategy: thresholds high 95 / low 85 / break 85
>    - Run command: `pnpm mutation` (manual, pre-release)
>    - **DO NOT** run in CI per commit (high cost, ~10-20min)
>    - Equivalent mutants documented inline
>    - Reports at `reports/mutation/mutation.html`
> 2. `mutation_testing_results.md` — placeholder with section per release:
>
>    ```markdown
>    # Mutation Testing Results
>
>    ## v0.1.0 (2026-XX-XX)
>
>    - Global score: TBD after CACHE-046
>    - Critical paths:
>      - parse-redis-url.ts: TBD
>      - key-builder.ts: TBD
>      - default-options.ts: TBD
>      - cache.service.ts: TBD
>      - script-manager.service.ts: TBD
>    ```

**Acceptance criteria:**

- [ ] 2 files created
- [ ] mutation_testing_plan.md explains process
- [ ] mutation_testing_results.md ready to fill

**Validation commands:** N/A

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 5→4, DONE 53→54, Progress 60%; TOTAL 5→4, 53→54, 93%. Commit: `docs(cache): add mutation testing plan and results (CACHE-054)`.

---

### CACHE-055: LICENSE (MIT) + .npmignore

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-001
- **Agent:** general-purpose

**Description:** License and npm exclusion files.

**Required reading:**

- `/Users/maximiliano/Documents/MyApps/nest-auth/LICENSE`
- `/Users/maximiliano/Documents/MyApps/nest-auth/.npmignore`

**Prompt for the agent:**

> 1. `LICENSE` — copy from nest-auth (MIT), change copyright to "Copyright (c) 2026 Bymax One"
> 2. `.npmignore` — exclude from publish:
>    - `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`
>    - `*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`
>    - `.eslintrc*`, `.prettierrc`, `eslint.config.mjs`
>    - `pnpm-lock.yaml`
>
>    Only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` stay in the tarball.

**Acceptance criteria:**

- [ ] MIT LICENSE present
- [ ] `.npmignore` excluding source and tooling

**Validation commands:**

```bash
pnpm pack --dry-run
# Verify list shows only dist/ + meta files
```

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 4→3, DONE 54→55, Progress 70%; TOTAL 4→3, 54→55, 95%. Commit: `chore(cache): add LICENSE and .npmignore (CACHE-055)`.

---

### CACHE-056: Final pre-publish gate

- **Phase:** 5
- **Status:** ✅ DONE
- **Priority:** High
- **Dependencies:** CACHE-049 to CACHE-055
- **Agent:** code-reviewer

**Description:** Last audit before tag.

**Required reading:**

- `docs/development_plan.md` §6.6

**Prompt for the agent:**

> Run the full pipeline locally (simulating CI + release):
>
> ```bash
> pnpm prepublishOnly  # = clean + typecheck + lint + test:cov:all + build
> pnpm size
> pnpm test:e2e        # validates Testcontainers + ioredis-mock
> pnpm mutation        # optional — last pre-release validation
> ```
>
> Final checklist:
>
> - [ ] All commands pass
> - [ ] `dist/` contains `server/index.{mjs,cjs,d.ts}` and `shared/index.{mjs,cjs,d.ts}`
> - [ ] `package.json` `"version": "0.1.0-alpha.0"` → change to `"version": "0.1.0"`
> - [ ] `CHANGELOG.md` entry 0.1.0 has date filled
> - [ ] Bundle size within budgets
> - [ ] Mutation score ≥ 85% global, ≥ 95% critical paths
> - [ ] `git status` clean (all commits made)
> - [ ] `/bymax-quality:code-review` run one last time, findings applied
> - [ ] Subpaths work via `pnpm pack --dry-run` (tarball contains only dist + meta files)

**Acceptance criteria:**

- [ ] Full checklist
- [ ] Final version 0.1.0 in package.json

**Validation commands:**

```bash
pnpm prepublishOnly && pnpm size && pnpm test:e2e
```

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 3→2, DONE 55→56, Progress 80%; TOTAL 3→2, 55→56, 97%. Commit: `chore(cache): end pre-publish gate (CACHE-056)`.

---

### CACHE-057: Tag v0.1.0 + npm publish --provenance

- **Phase:** 5
- **Status:** ⬜ TODO
- **Priority:** High
- **Dependencies:** CACHE-056
- **Agent:** general-purpose

**Description:** Create annotated tag, push, and validate that the release workflow publishes with provenance.

**Required reading:**

- `docs/development_plan.md` §6.7

**Prompt for the agent:**

> Run:
>
> ```bash
> cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-cache/
>
> # Ensure on main and up to date
> git status  # clean
> git pull --ff-only origin main
>
> # Create annotated tag
> git tag -a v0.1.0 -m "Release v0.1.0 — initial release"
>
> # Push commit + tag
> git push origin main --follow-tags
> ```
>
> The workflow `.github/workflows/release.yml` triggers automatically on push of tag `v*`:
>
> 1. Runs `pnpm prepublishOnly` (CI)
> 2. Executes `pnpm publish --provenance`
> 3. Creates GitHub Release with changelog
>
> Validate:
>
> - Workflow `release` in the GitHub Actions tab shows green
> - Page `https://www.npmjs.com/package/@bymax-one/nest-cache` shows v0.1.0
> - "Provenance" badge appears on npm
> - GitHub Release created at `https://github.com/bymaxone/nest-cache/releases`
>
> If it fails, read workflow logs, fix issue, create `v0.1.0` tag again (deleting the previous one locally + remotely if needed) **only after confirming root cause**.

**Acceptance criteria:**

- [ ] Tag `v0.1.0` created and pushed
- [ ] Release workflow green
- [ ] Package available on npm
- [ ] Provenance badge present
- [ ] GitHub Release created

**Validation commands:**

```bash
gh release view v0.1.0
gh api repos/bymaxone/nest-cache/releases/tags/v0.1.0 --jq '.body'
npm view @bymax-one/nest-cache version  # → 0.1.0
```

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 2→1, DONE 56→57, Progress 90%; TOTAL 2→1, 56→57, 98%. Commit: `chore(cache): release v0.1.0 (CACHE-057)`.

---

### CACHE-058: Post-publish smoke test + consumer fixture

- **Phase:** 5
- **Status:** ⬜ TODO
- **Priority:** Medium
- **Dependencies:** CACHE-057
- **Agent:** general-purpose

**Description:** Validate that the published package works in a real consumer via `pnpm dlx` or isolated install fixture.

**Required reading:**

- `docs/development_plan.md` §6.7

**Prompt for the agent:**

> In a temporary directory (outside the monorepo), create a consumer fixture:
>
> ```bash
> mkdir /tmp/cache-consumer && cd /tmp/cache-consumer
> pnpm init
> pnpm add @bymax-one/nest-cache @nestjs/common @nestjs/core ioredis reflect-metadata rxjs
> ```
>
> Create `index.mjs`:
>
> ```javascript
> import 'reflect-metadata'
> import { Module } from '@nestjs/common'
> import { NestFactory } from '@nestjs/core'
> import { BymaxCacheModule, CacheService } from '@bymax-one/nest-cache'
>
> @Module({
>   imports: [
>     BymaxCacheModule.forRoot({
>       connection: { url: 'redis://localhost:6379' },
>       namespace: 'post-publish'
>     })
>   ]
> })
> class App {}
>
> const app = await NestFactory.createApplicationContext(App, { logger: false })
> const cache = app.get(CacheService)
> await cache.set('test', '1', { ok: true })
> console.log('Roundtrip:', await cache.get('test', '1'))
> await cache.flushNamespace()
> await app.close()
> ```
>
> Run with local Redis running. Expected: `Roundtrip: { ok: true }` without errors.
>
> Additionally, validate via `npm pack` output that tarball contains only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` (does not leak `src/`, `test/`, configs).
>
> If error, mark as REVIEW and investigate (probably missing peer dep or subpath resolution).

**Acceptance criteria:**

- [ ] Consumer fixture installs without warnings
- [ ] Smoke test roundtrip works
- [ ] npm tarball contains only expected files

**Validation commands:**

```bash
cd /tmp/cache-consumer && node index.mjs
# And:
cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-cache && pnpm pack --dry-run
```

**Completion protocol:** Status ✅ DONE; Dashboard Phase 5 1→0, DONE 57→58, Progress 100% ✅; TOTAL 1→0, 57→58, 100% ✅. Commit: `chore(cache): post-publish smoke validation (CACHE-058)`.

---

## 🎯 Critical Path

Minimum execution order to reach release v0.1.0 (longest topological dependency path):

```
CACHE-001 → CACHE-002 → CACHE-006 → CACHE-007 → CACHE-008 → CACHE-009 →
CACHE-010 → CACHE-011 → CACHE-012 → CACHE-013 → CACHE-014 → CACHE-015 →
CACHE-016 → CACHE-019 → CACHE-022 → CACHE-023 → CACHE-028 → CACHE-029 →
CACHE-030 → CACHE-032 → CACHE-040 → CACHE-045 → CACHE-048 → CACHE-049 →
CACHE-052 → CACHE-056 → CACHE-057
```

**~27 tasks in the critical path** (out of 58 total). The other 31 can be executed in parallel within each phase.

## ⚡ Parallelizable Tasks

Tasks that can be executed in parallel (after dependencies are resolved):

**Phase 1:**

- CACHE-003 (eslint) ∥ CACHE-004 (jest) ∥ CACHE-005 (size script) after CACHE-001
- CACHE-007 (types) ∥ CACHE-008 (constants) ∥ CACHE-010 (DI tokens) after CACHE-006
- CACHE-009 (interfaces) ∥ CACHE-010 (DI tokens) after CACHE-007
- CACHE-011 (CacheException) ∥ CACHE-012 (parseRedisUrl + KeyBuilder) can run in parallel after dependencies

**Phase 2:**

- CACHE-016 (JsonSerializer) ∥ CACHE-017 (Phase 1 tests) ∥ CACHE-018 (JsonSerializer tests) — tests do not depend on the following implementation
- CACHE-020 (hash/set) ∥ CACHE-021 (scan/pipeline) after CACHE-019
- CACHE-024 (cache.service string tests) ∥ CACHE-025 (cache.service hash/set/flush tests) in parallel

**Phase 3:**

- CACHE-028 (PubSubService) ∥ CACHE-029 (ScriptManagerService) ∥ CACHE-031 (health methods) in parallel after CACHE-014/CACHE-016
- CACHE-033 (PubSub tests) ∥ CACHE-034 (ScriptManager tests) ∥ CACHE-035 (eval+health tests) in parallel
- CACHE-038 (forRootAsync stub) ∥ CACHE-039 (refactor commons) can run in parallel after CACHE-032

**Phase 4:**

- CACHE-042 (E2E fixtures) ∥ CACHE-041 (forRootAsync tests) in parallel after CACHE-040
- CACHE-043 (E2E ioredis-mock) ∥ CACHE-044 (E2E Testcontainers) in parallel after CACHE-042
- CACHE-046 (mutation) ∥ CACHE-047 (size budgets) in parallel after CACHE-045

**Phase 5:**

- CACHE-049 ∥ CACHE-050 ∥ CACHE-051 ∥ CACHE-052 ∥ CACHE-053 ∥ CACHE-054 ∥ CACHE-055 — all docs/CI/license in parallel

**Recommendation:** when run via `/bymax-workflow:task phase <N>`, the skill resolves dependencies automatically and parallelizes compatible tasks within the phase.

---

## 📚 Reference — quick anchor lookup

For efficient navigation without loading the entire file:

```bash
# Find task by ID
grep -n "^### CACHE-014:" docs/development_tasks.md

# Read only task X (line N to N+50)
Read offset=N limit=50 file_path=docs/development_tasks.md

# List all tasks of a phase
grep -n "^### CACHE-" docs/development_tasks.md | awk -F: '{print $0}' | sed -n '/Phase 3/,/Phase 4/p'

# Current dashboard status
sed -n '/^## 📊 Progress Dashboard/,/^---/p' docs/development_tasks.md
```

**Final:** this file, together with `development_plan.md` and `technical_specification.md`, form the complete set for autonomous execution by AI agents. Next step: invoke `/bymax-workflow:task phase 1` to begin.
