# Mutation Testing Results — @bymax-one/nest-cache

> Tool: Stryker (`@stryker-mutator/core`) · Runner: Jest · `ignoreStatic: false` ·
> `thresholds.break = 95` · Runtime: **Node 24** (`nvm use 24`).
> Command: `pnpm mutation` (full) · Report: `reports/mutation/mutation.html`.

## Final — 2026-05-31 (after hardening)

**Global mutation score: 100.00%** — 427 killed, 6 timeout, **0 survived** (316 compile-error mutants excluded). `pnpm mutation` exits 0 (≥ `break: 95`). Run time ~2m53s under Node 24. Every mutated file scores 100%.

The 50 survivors found in the baseline below were all killed by strengthening the existing unit tests (no source logic changed):

- **Throw-site `details`** (most survivors, in default-options / key-builder / json-serializer / cache.service / script-manager / connection.manager): tests asserted the exception `code` but not the `details` object, so `{}` / `''` mutants survived. Fix: assert the exact `details` payload (`toEqual`) at each throw site.
- **Boundary operators** (`shutdownTimeoutMs` / `connectTimeout` `<` MIN): added tests at exactly the minimum so a `<=` mutant is caught.
- **Optional chaining** (`cluster.nodes?.length`): added a cluster test with `nodes` undefined (the `?.` guards a TypeError).
- **URL regex** (`/^\d+$/`): added multi-digit, digit-prefixed, and digit-suffixed db-segment cases to pin `^`, `$`, and `+`.
- **Conditional/credentials** (`if (parsed.username)` / `parsed.password`, sentinel `password` spread): added absent-credential cases and a Redis-constructor-arg assertion.
- **Idempotency / lazy subscriber** (pubsub `makeUnsubscribe`, `ensureSubscriber`): assert detach (`subscriber.off`) and `createSubscriberClient` are each called exactly once.

**Zero suppressions remain** — the production source carries no coverage/mutation directives. The one would-be equivalent (`parse-redis-url` `/^\//` vs `/\//` on a URL pathname) was instead refactored to `.slice(1)`, which is regex-free and whose `slice` mutants are all killed by the db-segment tests; and the `forRootAsync` `base.providers ?? []` fallback is covered by a dedicated spec (mocking the inherited base method to omit providers) rather than ignored.

The 6 `connection.manager.ts` timeouts are detected mutants (Stryker counts a timeout as killed) — a mutated retry/backoff path that spins; they do not lower the score.

## Baseline — 2026-05-31 (first successful full run, before hardening)

**Global mutation score: 88.48%** — 378 killed, 6 timeout, 50 survived (316 compile-error mutants excluded by the TypeScript checker). Run time ~2m52s under Node 24.

> ⚠️ **This is the first time the full mutation suite has ever run successfully.** Until Phase 4 it could not run under Node 24: `jest.stryker.config.ts` imported `./jest.config` without a file extension, which Node 24's native TypeScript type-stripping (ESM mode) rejects (`ERR_MODULE_NOT_FOUND`). Phase 4 fixed that import (`./jest.config.ts`), which is what unblocked this baseline. The scores below therefore reflect **pre-existing** Phase 1–3 test strength that mutation had never measured before.

### Per-file scores

| File                                      | Score       | Survived | Timeout | Critical path? | Meets ≥95%? |
| ----------------------------------------- | ----------- | -------- | ------- | -------------- | ----------- |
| `bymax-cache.module.ts` (Phase 4)         | **100.00%** | 0        | 0       | —              | ✅          |
| `bymax-cache.module.builder.ts` (Phase 4) | **100.00%** | 0        | 0       | —              | ✅          |
| `cache-error-codes.ts`                    | 100.00%     | 0        | 0       | —              | ✅          |
| `cache.exception.ts`                      | 100.00%     | 0        | 0       | —              | ✅          |
| `cache.service.ts`                        | 95.45%      | 4        | 0       | ✅ (set/get)   | ✅          |
| `connection.manager.ts`                   | 90.74%      | 10       | 6       | —              | ❌          |
| `json-serializer.ts`                      | 90.91%      | 2        | 0       | —              | ❌          |
| `pubsub.service.ts`                       | 88.37%      | 5        | 0       | —              | ❌          |
| `script-manager.service.ts`               | 82.35%      | 3        | 0       | ✅ (`eval`)    | ❌          |
| `parse-redis-url.ts`                      | 82.35%      | 6        | 0       | ✅             | ❌          |
| `default-options.ts`                      | 78.46%      | 14       | 0       | ✅             | ❌          |
| `key-builder.ts`                          | 71.43%      | 6        | 0       | ✅             | ❌          |

(`cache-error-codes.ts` / `cache.exception.ts` / `resolve-serializer.ts` and the shared constants either score 100% or have only compile-error mutants.)

### Acceptance-criteria status at baseline (CACHE-046 / plan §5.5) — all later met, see Resolution

- [x] **Global ≥ 85%** — 88.48% ✅
- [ ] **Critical paths ≥ 95%** — only `cache.service.ts` (95.45%) clears the bar. `key-builder.ts` (71%), `parse-redis-url.ts` (82%), `default-options.ts` (78%) and `script-manager.service.ts` (82%) are **below** it. ❌
- [x] `reports/mutation/mutation.html` generated ✅
- [x] `docs/mutation_testing_results.md` updated ✅
- [ ] `pnpm mutation` exits 0 — currently **exit 1**: global 88.48% < `thresholds.break = 95`. ❌

### Interpretation

The pre-existing suite has 100% line/branch coverage but ~50 surviving mutants — paths that are executed without an assertion pinning the value they produce (side-effect-only assertions, unpinned `?? default` fallbacks, and constant/boundary mutants exposed by `ignoreStatic: false`). The run did its intended job: it **identified the weak tests**. The Phase 4 code (`forRootAsync` + the builder `setExtras`) scores 100%.

### Surviving-mutant hotspots to harden

1. `key-builder.ts` (6) — separator/namespace joins (`:47/:50/:65`); assertions check the joined key but not the exact separator placement.
2. `default-options.ts` (14) — `?? default` branches and validation thresholds; the fallback values aren't pinned by a test.
3. `parse-redis-url.ts` (6) — URL field-extraction branches (`:42/:45/:49/:50`); some may be equivalent (`??` vs `||` where empty string is valid — plan §5.5).
4. `script-manager.service.ts` (3) — `EVALSHA` arg counts and NOSCRIPT-marker handling.
5. `connection.manager.ts` (10 survived + 6 timeout) — listener wiring + shutdown race; the timeouts suggest a mutant that spins (needs investigation).
6. `pubsub.service.ts` (5), `json-serializer.ts` (2) — non-critical, worth tightening.

> Equivalent mutants must be documented inline with `// Stryker disable next-line <Mutator>: <reason>` — and only after confirming no test can kill them.

## Resolution

All 50 baseline survivors were killed in Phase 4 by strengthening the unit tests (see the Final section above). `pnpm mutation` now exits 0 at **100.00%**, clearing the `break: 95` gate and the §5.5 critical-path ≥95% rule (every critical path is 100%). Ten unit tests were added/strengthened, and the production source carries **zero** coverage/mutation suppressions (the would-be equivalent regex was refactored to `.slice(1)`; the optional-providers fallback is test-covered). No source behaviour was changed — only the leading-slash strip was rewritten as an equivalent `.slice(1)`.
