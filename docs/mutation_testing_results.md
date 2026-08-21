# Mutation Testing Results — @bymax-one/nest-cache

> Tool: Stryker (`@stryker-mutator/core`) · Runner: Jest · `ignoreStatic: false` ·
> `thresholds.break = 100` · Runtime: **Node 24** (`nvm use 24`).
> Command: `pnpm mutation` (full) · Report: `reports/mutation/mutation.html`.

## Final — 2026-05-31 (after hardening)

**Global mutation score at the time of this pass: 100.00%** — 427 killed, 6 timeout, **0 survived** (316 compile-error mutants excluded). `pnpm mutation` exits 0 (≥ `break: 95`). Run time ~2m53s under Node 24. Every mutated file scores 100%.

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

---

## Re-run — 2026-08-06

| Metric             | Value        |
| ------------------ | ------------ |
| **Mutation score** | **99.78 %**  |
| Surviving mutants  | 1            |
| Break threshold    | 95 % -> PASS |

`findProvider` gained a spec of its own. It had only ever been exercised through the module
suites, where every lookup succeeded through one half of its disjunction or the other, so either
half could be dropped and those suites would still pass.

The one survivor is `configurable: false` on the withheld connection accessor. It is equivalent
HERE because the resolved options are `Object.freeze`d on the way out and freezing makes every
property non-configurable anyway. The flag stays: it states the guarantee where the accessor is
defined, and the storage package withholds its credentials the same way WITHOUT freezing, where
it is the only thing enforcing it.

The zero-suppressions rule above still holds. Inline directives were added during this pass and
then removed: this package documents equivalents here rather than annotating the source, and that
convention outranks a higher number.

Every equivalence claim in this section was checked by running the mutant, not by reading it.
Where a `// Stryker disable next-line` directive was found not to apply — above a `} catch {`, a
`.replace()` inside a method chain, a multi-line `sort(...)` argument, or anywhere inside a
builder chain — it was replaced with the block `disable`/`restore` form, or, where that does not
work either, with a plain comment at the line so the reasoning is visible rather than silently
ineffective.

---

## Re-run — 2026-08-10 (ioredis 6 migration)

| Metric             | Value         |
| ------------------ | ------------- |
| **Mutation score** | **100.00 %**  |
| Surviving mutants  | 0             |
| Break threshold    | 100 % -> PASS |

Cold `pnpm mutation:full` after the `ioredis ^5 → ^6` peer bump: **100.00%**, 0 survived
(441 killed, 6 timeout, 316 compile-error mutants excluded). The migration changed only the
constructor option typing (`OwnedRedisOptions` / `OwnedClusterOptions`), so no mutant moved.
The Stryker gate (`thresholds.break`/`high`/`low`) was raised from 95/99/95 to **100** in the
same change, which this run clears.

## Re-run — 2026-08-21 (1.2.0 — `./admin` subpath + namespace glob fix)

**Global mutation score: 100.00%** — 759 killed, 17 timeout, **0 survived** (570 compile-error
mutants excluded). `pnpm mutation:full` exits 0 against `break: 100`. Cold run: 6m45s under Node 24.
1346 mutants tested, up from 447 — the `./admin` subpath roughly tripled the mutated surface.

It took three cold runs to get there, and the two failures are the useful part of this record.

### Run 1 — 96.04%, 31 survivors (all in `src/admin`)

The server scored 100.00% including the 95 mutants on the reworked `default-options.ts`, so the
gap was entirely in code written that day. Grouped by what the survivor actually revealed:

| Survivors                        | What the tests were not doing                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5 — `parse-info` numeric regex   | No fixture used a negative value or **any** exponent form, so `[+-]?`, the exponent sign and its digit count were all unconstrained.                                                             |
| 5 — `parse-info` header skip     | Real `INFO` headers carry no colon, so they fall out of the `indexOf` guard anyway: skipping them and not skipping them were **indistinguishable**. Fixed with a `# Commandstats: none` fixture. |
| 1 — `?.trim()` on a value        | Nothing exercised a padded value.                                                                                                                                                                |
| 5 — option-name literals         | One shared assertion pinned only `scanLimit`; the other five names could drift to anything.                                                                                                      |
| 2 — module `exports: [...]`      | Every test resolved services **from** the admin module, which succeeds whether or not anything is exported. Needed a consumer module importing across the boundary.                              |
| 2 — endpoint guards              | The cluster and malformed-URL tests carried no connection block, so guarding and not guarding produced the same empty answer. Fixed with configs that would visibly leak a host.                 |
| 1 — `finally { clearTimeout }`   | A leaked timer is invisible in the payload. Fixed by asserting `jest.getTimerCount()` is 0 after a probe.                                                                                        |
| 1 — latency arithmetic           | The fake clock started at **zero**, where `end - start` and `end + start` agree. Base moved to 1000.                                                                                             |
| 1 — scan loop `<` vs `<=`        | No case landed exactly on the limit.                                                                                                                                                             |
| 1 — pipeline slot guard          | The errored slot carried `null`, identical to the guarded result. The slot now carries a real value.                                                                                             |
| 2 — `'ZRANGE'` / `'WITHSCORES'`  | No test asserted the command name sent through the `call` escape hatch.                                                                                                                          |
| 2 — `TTL_MISSING` and its branch | See below — resolved in the source, not the tests.                                                                                                                                               |

### Run 2 — 99.87%, 1 survivor

`parse-info.ts`, the `line.length === 0` operand of the blank-line guard. An empty line has no
separator, so the `cut <= 0` check below already skips it: the operand was a fast path **no
behaviour depends on**, and therefore one no test could ever hold to account.

### Two equivalent mutants removed rather than suppressed

Both were resolved by deleting redundant source, not by a `// Stryker disable`:

- `if (reply === TTL_MISSING)` in `read-replies.ts` was fully subsumed by the `reply < 0`
  catch-all below it. The branch and its constant are gone; the protocol knowledge (`-2` means
  "no such key") moved into the comment.
- `line.length === 0 ||` in `parse-info.ts`, as above.

This keeps the repo's standing property intact: **the production source carries no mutation
suppression directives at all.**

### Method note

Eight of the run-1 fixes were verified by hand-mutating the source and confirming the suite goes
red, then restoring byte-identical — a test written to kill a mutant is worth only as much as the
proof that it does.
