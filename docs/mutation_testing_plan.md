# Mutation Testing Plan — @bymax-one/nest-cache

> **Status:** ✅ Baseline completed 2026-05-31 — **100% global score** (427 killed, 6 timeout, 0 survived).
> Stryker exits 0 (`break: 95`). Run before every release tag.
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

## Suppression policy

An equivalent mutant — one no test can kill because the mutation preserves observable
behaviour — is documented **in the source**, on the line it applies to:

```ts
// Stryker disable next-line <Mutator>[,<Mutator>]: <why the mutant is equivalent>
```

The reason belongs next to the code it explains, where it cannot drift away from it. A
separate report can, and does: line references rot after a reformatting, and a report can
claim a score the branch no longer measures.

Four rules keep that documentation real rather than decorative:

- **The reason goes after the colon, on one line.** Stryker parses a directive with
  `/^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/`. The mutator
  list accepts letters, commas and spaces only, and the reason is captured exclusively
  after the colon and only to the end of that line. Written after `--`, or wrapped onto a
  second comment line, the reason is silently dropped and the report shows Stryker's
  fallback text, `Ignored using a comment`.
- **A directive that does not attach uses the block form.** `next-line` does not reach a
  catch-clause body, a multi-line call argument, or anything inside a builder chain. Those
  take `// Stryker disable <Mutator>` … `// Stryker restore <Mutator>` around the whole
  statement.
- **The reason must be true.** Where a mutant is not equivalent but Stryker fails to
  attribute the killing test to it, the directive says exactly that. Calling it equivalent
  would be false, and a false justification is worth less than a lower score.
- **A mutant a test could kill is never disabled.** Strengthen the test instead. The break
  threshold is never lowered to accommodate a survivor.

`pnpm check:mutants` enforces the first rule mechanically, and also rejects a mutator name
Stryker does not know — which matches nothing, so the directive silences nothing while
looking like it does. Stryker warns about that case, but only during a mutation run, which
is too late to block the change that introduced it.

These comments ship in the unminified bundle. The measured cost is small — seven directives
cost 0.10 kB brotli in a server subpath of roughly 13 kB — because brotli compresses their
repeated prefixes almost for free. Where a bundle budget is genuinely tight, the budget is
raised deliberately in the same change with the measurement recorded beside it, rather than
the documentation being dropped: a budget exists to catch code bloat, and the reason a
mutant survives is not bloat.

This policy is identical across the `@bymax-one/nest-*` libraries.

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
