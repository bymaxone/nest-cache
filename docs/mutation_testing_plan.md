# Mutation Testing Plan — @bymax-one/nest-cache

> **Status:** Stryker installed and configured; **not yet run** — the first
> baseline is scheduled for **Phase 5** (release), per `docs/development_plan.md`.
> Until then the library ships only the foundational seed.
> **Results:** [`docs/mutation_testing_results.md`](./mutation_testing_results.md)

---

## Setup — already in place

| File                                  | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `stryker.config.json`                 | Main config — thresholds, reporters, temp dir, `ignoreStatic: false`    |
| `jest.stryker.config.ts`              | Jest config used by Stryker (separate from the normal `jest.config.ts`) |
| `@stryker-mutator/core`               | Core (devDependency)                                                    |
| `@stryker-mutator/jest-runner`        | Jest test-runner plugin                                                 |
| `@stryker-mutator/typescript-checker` | TS type-checker plugin                                                  |

No install or config steps needed — `pnpm mutation` is ready once there is engine
code to mutate.

---

## Running mutation tests

```bash
pnpm mutation              # full run (~10-20 min); writes reports/mutation/mutation.html
pnpm mutation:incremental  # faster re-run using cached results
pnpm mutation:dry-run      # validates config without running mutants
```

---

## Thresholds (`stryker.config.json`)

```json
"thresholds": { "high": 99, "low": 95, "break": 95 }
```

| Threshold   | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `break: 95` | `pnpm mutation` exits 1 if score < 95 % — hard gate           |
| `low: 95`   | Score between low and high → yellow in the HTML report        |
| `high: 99`  | Aspirational target — score ≥ 99 % → green in the HTML report |

**`ignoreStatic: false`** — the rigorous setting: mutants in module-level
constants (the error-code map, default options) are exposed to the tests instead
of being ignored. This caught a real bug in `@bymax-one/nest-auth` (a
`httpOnly: false` cookie that no test covered). Flip to `true` only if `perTest`
attribution produces irreducible false survivors.

---

## Equivalent mutants

A mutant is _equivalent_ when no test can distinguish it from the original
(identical observable behaviour). Two ways to handle them, chosen by the count
and the bundle budget:

- **Inline** `// Stryker disable next-line <Mutator>: <reason>` — keeps the reason
  next to the code (Stryker's native approach). Acceptable here: the cache bundle
  budget is generous and unminified comments cost ~0.
- **Documented** in `mutation_testing_results.md`, left to survive — only fits
  when there are few equivalents (keeps the score ≥ 95 without them).

**Rule:** minimize equivalents; **never** disable a mutant a test could kill.
Pick the approach during the Phase 5 hardening pass.

---

## Hardening workflow (Phase 5)

1. `pnpm mutation` → open `reports/mutation/mutation.html`, sort by "survived".
2. For each survivor: write the missing test, or sharpen a weak assertion
   (`toBeDefined()` → `toBe(value)`); if truly equivalent, flag it.
3. Re-run until score ≥ 95 % (break gate); aim for ≥ 99 %.
4. Record the run in `mutation_testing_results.md`.

> Rule of thumb: a hard-to-kill mutant usually means the test asserted
> _implementation_ instead of _observable behaviour_ — rewriting the assertion
> often kills several survivors at once.

---

## CI strategy — do NOT wire to per-PR CI

Mutation testing is a **manual, pre-release gate** — never in `prepublishOnly` or
`ci.yml`. A full run takes 10–20 min; per-PR CI already enforces 100 % line/branch
coverage, which is sufficient for continuous integration.

**Release checklist:**

1. `pnpm test:cov:all` → 100 % across all metrics
2. `pnpm mutation` → score ≥ 95 % (break gate); aim for ≥ 99 %
3. `pnpm prepublishOnly` → clean
4. `node scripts/dogfood-smoke-test.mjs` → all assertions green
5. Tag + publish
