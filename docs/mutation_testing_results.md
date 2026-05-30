# Mutation Testing Results — @bymax-one/nest-cache

> **Status: no run yet.** Stryker is installed and configured
> (`ignoreStatic: false`, `break: 95`), but the first mutation run is scheduled
> for **Phase 5** (release), once the cache engine is implemented. See
> [`docs/mutation_testing_plan.md`](./mutation_testing_plan.md).

This document will record, after the first `pnpm mutation` run:

- **Score history** — baseline → after-hardening → final, with dates.
- **Per-area breakdown** of the mutation score (connection, services, utils, errors).
- **Configuration corrections** discovered during execution — the changes that
  make the run trustworthy (e.g. why `ignoreStatic: false`, `perTest`
  attribution caveats, `ioredis-mock` interplay).
- **Residual survivors** — every surviving mutant triaged into one of:
  - _equivalent_ — no test can kill it; flagged with `// Stryker disable next-line <Mutator>: <reason>` or documented here; or
  - _covered-but-unattributed_ — a `perTest` artifact (the killing test exists; Stryker mis-attributes it), with the fix noted.

All numbers will come from recorded Stryker runs — nothing estimated.
