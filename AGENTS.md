# AGENTS.md — @bymax-one/nest-cache

> Architecture and working agreement for AI agents and human contributors. The
> dense quick rules live in [CLAUDE.md](./CLAUDE.md); the authoritative design
> lives in [docs/technical_specification.md](./docs/technical_specification.md).
> This library is under active scaffolding — the engine is delivered across the
> phases in [docs/development_plan.md](./docs/development_plan.md).

## Table of Contents

1. Project Overview
2. Architecture
3. Backend Patterns
4. Security Specification
5. Testing Strategy
6. Build and Publish
7. Common Pitfalls
8. Pre-Task Checklist
9. Guidelines Reference

Plus [Code Review Rules](#code-review-rules) — unnumbered, because its shared half is
replaced wholesale by the `agents-sync` workflow and the heading has to read the same in
every Bymax repository.

## 1. Project Overview

`@bymax-one/nest-cache` encapsulates a singleton `ioredis` 6 connection behind a
typed NestJS module: typed `get<T>`/`set<T>`, automatic key namespacing, Pub/Sub
on namespaced channels, and a Lua script manager (`EVALSHA` + `NOSCRIPT`
fallback). It owns connection lifecycle, reconnection, graceful shutdown, and
propagates connection events via an `events.onEvent` callback. It reads no
environment variables — everything is supplied through DI. Published as a
public, MIT, zero-runtime-dependency package.

## 2. Architecture

- **Subpaths (3):** `.` (server — NestJS module + services), `./admin` (read-only
  administration; imports the server surface by package specifier, external in the
  bundle) and `./shared`
  (zero-dependency types + constants).
- **Dynamic module:** `BymaxCacheModule.forRoot()` / `forRootAsync()` built on
  `ConfigurableModuleBuilder`, global by default via `setExtras` →
  `DynamicModule.global` (not a manual `@Global()` — see spec §0).
- **DI tokens (Symbol):** `BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`,
  `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`, `BYMAX_CACHE_SERIALIZER`,
  `BYMAX_CACHE_KEY_BUILDER`.
- **Core units:** `ConnectionManager` (singleton + lifecycle, standalone /
  sentinel / cluster), `CacheService` (typed API + namespacing), `PubSubService`,
  `ScriptManagerService`, plus `KeyBuilder` / `parseRedisUrl` / serializer utils.
- **Folder layout:**
  `src/server/{connection,services,config,interfaces,utils,errors,constants}` and
  `src/shared/{types,constants}`.

## 3. Backend Patterns

- `Symbol` injection tokens; **explicit `@Inject(TOKEN)`** on every provider and
  factory `inject: []` (tsup builds without `emitDecoratorMetadata`).
- Singletons only — no `Scope.REQUEST`. Connection lifecycle via `OnModuleInit` /
  `OnModuleDestroy`.
- Errors via `CacheException` + `CACHE_ERROR_CODES` (namespaced `cache.*`,
  append-only).
- Generics (`get<T>`, `set<T>`) with a pluggable `ISerializer`; keys always built
  through the key builder.
- Redis: offline queue disabled (fail fast), bounded `retryStrategy`,
  `reconnectOnError` on `READONLY` failover.

## 4. Security Specification

- **Key namespacing / tenant isolation** — never expose raw keys that bypass the
  builder.
- **Fail-closed deserialization** — malformed payloads throw, never return a
  partial value.
- **No secrets in `details` or events** — previews truncated.
- **Production flush guard** — `flushNamespace` disabled in prod without an
  explicit flag.
- **No untrusted input in Lua bodies.**

## 5. Testing Strategy

- TDD; **100% coverage** in both `jest.config.ts` and `jest.coverage.config.ts`.
- Unit tests mock Redis with `ioredis-mock`; E2E uses `@nestjs/testing` in
  `test/e2e/`.
- Mutation testing (Stryker, `break: 100`) is a manual release gate.
  `ignoreStatic: false` (exposes module-level constant mutants). Equivalent
  mutants are flagged inline with `// Stryker disable next-line` and a reason —
  only for genuine equivalents.

## 6. Build and Publish

- tsup → 3 subpaths, ESM + CJS + `.d.ts`/`.d.cts`, `sideEffects: false`, peers
  external. `minify: false` (readable backend bundle).
- `files` allowlist publishes only `dist` + metadata. `pnpm size` gate +
  `pnpm check:exports` + `dogfood-smoke-test.mjs` before tagging. Release via
  OIDC provenance.
- `exports` declares `types` **per condition** — `import` → `.d.ts`, `require` →
  `.d.cts`. A single shared `types` key makes CommonJS consumers resolve ESM
  declarations, because `"type": "module"` marks plain `.d.ts` as ESM.
- Subpaths need a `typesVersions` entry on top of `exports`. The
  `moduleResolution: node` algorithm predates `exports` and ignores it, so
  without `typesVersions` a consumer on that setting (the Nest CLI default when
  `module: commonjs` is set with no explicit `moduleResolution`) cannot find the
  subpath's types. `pnpm check:exports` runs the strict `attw` profile, which
  covers that mode — never weaken it with `--profile` to silence a row.

## 7. Common Pitfalls

- **Implicit DI** breaks after tsup — always `@Inject(TOKEN)`.
- **`getClient()` raw keys** bypass the namespace — only for advanced escape
  hatches, documented as an anti-pattern.
- **`KEYS`** blocks Redis in production — use `SCAN` cursors; batch with
  `pipeline()`.
- **BullMQ** needs `maxRetriesPerRequest: null` — it must create its own
  connection (`@bymax-one/nest-queue`), not reuse this one.

## 8. Pre-Task Checklist

1. Read the relevant section of `docs/technical_specification.md` and the matching
   `CACHE-xxx` task in `docs/development_tasks.md`.
2. TDD: write the failing `*.spec.ts` first; keep 100% coverage.
3. Run `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && pnpm size && pnpm check:exports`.

## 9. Guidelines Reference

- `docs/technical_specification.md` — full API, options, error catalog, Redis modes.
- `docs/development_plan.md` — phased build-out.
- `docs/development_tasks.md` — atomic `CACHE-xxx` tasks.

## Code Review Rules

<!-- shared:begin -->
<!--
  CANONICAL COPY: bymaxone/.github → agents/code-review-rules.md
  Do not edit this block in a consuming repository. It is replaced wholesale by
  the `agents-sync` reusable workflow, so a local edit is reverted on the next
  run. Change it here, cut a release, and every repository is offered the update.

  Repository-specific rules go OUTSIDE this block, below the closing marker.

  FOR WHOEVER EDITS THIS FILE, not for the reviewer who reads it:

  Codex reads one AGENTS.md per directory, root to nested, within
  project_doc_max_bytes (32 KiB default). Never name a template or fixture
  AGENTS.md below the root: a change under it is read as the repo's guidance.

  This block is charged against every consumer's budget. A rule added here must
  be worth the bytes in the smallest-headroom repository, not only in this one;
  agents-sync reports each consumer's headroom and fails when it is exceeded.

  When you scope a rule, scope every rule in its paragraph or split the
  paragraph -- an unscoped neighbour reads as deliberate.
-->

These rules hold in every Bymax repository. What is specific to this one is written after this
block, and the two are read together.

The pipeline already enforces formatting, linting, dependency policy, coverage and — where the
repository has one — the mutation gate. Do not spend a review on a **violation** of one of those: it
is a red check, not a comment. What follows is what CI cannot see.

A violation of a rule in this block is reported at **P1** at minimum. Codex surfaces only P0 and P1
on a pull request, so a rule whose violations land at P2 is a rule nobody sees.

**When a rule moves from here into a check, it leaves here.** A red check is proportionate to a
correctness failure that is invisible without it, and disproportionate to style enforced at an
inconvenient moment. Never carry both: a rule stated here _and_ enforced by CI spends a reviewer's
attention on what a gate already reports.

**A change to the enforcing configuration is the opposite case, and it is in scope.** Every gate runs
the configuration from the branch under review — that branch's lint config, its coverage thresholds,
its mutation thresholds. So a pull request that deletes a rule, lowers a threshold or widens an
ignore glob turns the check **green**, because a gate reports on the rules it was handed. For those
diffs the review is the only independent check there is, and a weakened gate needs the same
justification a suppression does.

### A finding names what it read

Every factual claim in a review — about a library's API, about this repository's history, about what
a file contains — has to come from something read in the tree under review, and the finding should
say which. A claim assembled from recollection is likely to describe a previous version of whatever
it is about.

**Safe path**, by the kind of claim:

| Claim about                             | Read this                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| A library's API **shape**               | `node_modules/<pkg>/dist/**/*.d.ts` in this tree                               |
| A library's **runtime behaviour**       | that version's changelog entry, its documentation, or a test that exercises it |
| A commit's author or committer identity | out of scope: it is not text a change introduces                               |
| What a file contains                    | the file at the revision under review, not an earlier one                      |

The first two rows are separate on purpose, and the rule below says why: a field can stay optional
in the published type while becoming mandatory in behaviour. A `.d.ts` settles what a signature
accepts and nothing about what the implementation does with it, so a behavioural claim resting on
one is unfounded.

Weight the checking by what acting on the finding would cost. A comment that asks for a reworded
sentence is cheap to be wrong about; one that asks for history to be rewritten, a merge reverted, or
a release pulled is not — verify that class before raising it, and raise it at the severity the
evidence supports rather than the severity the consequence would deserve if true.

### A dependency upgrade migrates every call site, not only the ones that fail to compile

When an upgrade tightens a contract, the compiler catches only the call sites whose **shape**
changed. A field that stays optional in the published type while becoming mandatory in behaviour
compiles, passes the unit suite, and fails in production.

A `@bymax-one/*` version number carries **no compatibility information** while the libraries are
pre-stable: breaking changes ship in minor and patch releases by explicit policy, so `^` and `~`
protect against nothing. The migration note under **Apply to a derived backend** in the library's own
changelog is the compatibility contract.

**Safe path:** read **every** changelog entry from the version being replaced up to the proposed
one, not only the proposed one's, and check every call site they name — not only the ones the
compiler rejected. Upgrades routinely skip releases, and the entry that matters is often not the
last one: adopting `@bymax-one/nest-cache` 1.1.0 → 1.2.1 skipped 1.2.0, where a namespace-validation
security fix lives; 1.2.1's own entry is a field rename. Diff the `.d.ts` of the **previously adopted** version against
the **proposed** one — `npm pack` both, and name the two versions. Reaching for "the installed
declarations" is the trap: in a checkout of the branch under review the installed tree is already
the new version, so that diff compares a release with itself and shows nothing.

### Settled decisions are not review findings

Both are settled deliberately, and reopening either costs a round trip and changes nothing:

- **Do not propose a major version bump** for a breaking change in a `@bymax-one/*` library, and do
  not assert that this ecosystem follows strict SemVer. Until an API is declared stable, breaking
  changes ship in minor and patch releases; the migration note carries the compatibility information
  the number does not. If a document claims strict SemVer, the finding is that the claim is wrong —
  not that the version should be raised.
- **Do not propose pinning `bymaxone/.github` reusable workflows to a commit SHA.** They are
  referenced by the `@v1` alias on purpose: a fix has to land once and reach every repository, the
  tag is immutable and the alias moves only on a release, and pinning was measured to cost ~58
  dependency pull requests to propagate one change. Third-party actions are the opposite case and
  **are** pinned by SHA.

**Safe path:** if you believe a settled decision is now wrong, say so as a question in the pull
request rather than as a finding.

### Suppressions are refusals, not exceptions

`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` in any form,
`as unknown as` laundering a real type error, `istanbul ignore`, and in Rust `#[allow(...)]` over a
lint gate or `unsafe` without a `// SAFETY:` comment are blocking findings.

Anything a configured gate already reports belongs to the gate, not to a review: where a repository
lints `no-explicit-any` as an error — most do — an `as any` is a red check, and raising it here only
duplicates it. Check the repository's lint configuration before reporting a suppression rather than
assuming the list is exhaustive in either direction.

A failing gate means the code is wrong, the type is wrong, or the rule is wrong. **Safe path:** fix
whichever it is. Changing a rule's configuration with a stated reason is legitimate; scattering
per-call-site silencers is not.

### Comments state constraints, never history

A comment must read as true for whoever opens the file next. Flag any comment that narrates what a
previous version did, names a phase, task, ticket or review round, or explains a change rather than
the code. **Safe path:** state the constraint that still holds, and let `git log` carry the history.

Evidence for a constraint is not history, and how the evidence was obtained does not decide which it
is. The test is whether the fact still binds the next reader. A measurement that predicts what they
will hit if they take the other path — what the alternative did when it was tried, what the cost is
in numbers — belongs beside the constraint it supports, whether it came from a deliberate trial or
from something breaking. What ages is the part that cannot recur for them: what a previous version
of this code did, a version number, a registry state, a review round, a failure that has since been
fixed. Flag those; keep the measurement.

### Size and layering

Functions over **50 lines** and nesting deeper than four levels are findings **for what a change
introduces** — a new function, or a change that pushes an existing one past the limit — in the
repository's own source and test directories. A test-suite grouping construct (`describe`, `context`,
`mod tests`, a table of cases) is not a function; the unit under the limit is the body of a single
`it`/`test`/`#[test]`. On the same terms, every non-trivial source file a change introduces opens
with a header stating its purpose and its layer, and every exported symbol a change introduces
carries a doc comment.

**The 800-line file limit applies to what a change introduces, not to what it inherits.** A
repository that already carries a file past the line — a generator, a long end-to-end suite — would
otherwise produce a finding on every pull request touching three lines of it, which the author
cannot act on and did not cause. Raise it for a **new** file over the limit, or when a change pushes
a file past it or materially grows one already over.

Markdown, generated output and lockfiles are **out of scope**: a changelog is an append-only log that
only grows, a lockfile is generated, and neither has layers. Reporting their length is a false
positive on every dependency bump and every release note.

**Safe path:** extract by responsibility rather than by line count — the limit is a symptom, and one
file doing two jobs is the defect.

### Language and attribution

Everything published is English — source, comments, tests, commit messages, pull request titles and
bodies, `README.md`, `CHANGELOG.md` and everything under `.github/`.

Each repository states its language policy for `docs/` below this block. Report a language finding in
`docs/` only against what the repository states; where it states nothing, `docs/` is English like
everything else. A `docs/` language other than English is a repository-owner decision recorded in the
narrowings, not a convention a contributor may introduce.

No commit, pull request, comment or code may attribute authorship to an AI assistant or coding tool,
in any form. **Only text the change introduces is in scope** — a trailer, a "generated with" line, a
signature in a comment or a description.

A commit's author and committer fields are not that: they come from the contributor's git
configuration rather than from the diff, and a review reading the diff cannot see them. Never report
an identity field, and never present a command's reconstructed output as evidence for one. Measured:
eight P1 findings in a single day across four pull requests, each naming a commit SHA that does not
exist in the repository it was reported against and quoting `git log` output no review had run. What
each one asked for was a force-push rewriting published history.

<!-- shared:end -->

### Where this repository narrows a shared rule

The block above holds across every Bymax repository. What follows is the sharper form five of
its rules take here — not a disagreement with the shared text.

- **This repository _is_ one of the `@bymax-one/*` libraries the version rule is about.** Breaking
  changes ship in minor and patch releases by policy, and the `CHANGELOG.md` entry is the
  compatibility contract the number is not. 1.2.1 renamed `RevealedValue`'s hash entry field from
  `name` to `field` — a type-level breaking change, shipped as a patch deliberately, with the
  trade-off written out in the entry. Do not report the version as too low.

  The other half of the same rule: `files` is `["dist", "LICENSE", "README.md", "CHANGELOG.md"]`,
  so `README.md` and `CHANGELOG.md` are **published artifacts**. A fix to either needs a version
  bump and a `## [x.y.z]` section in the same pull request, because a correction that only reaches
  `main` leaves the npm page — where people read it — still wrong. A bump in a documentation-only
  pull request is the rule here, not scope creep; its absence is the finding.

- **`src/admin/` imports the server surface by package specifier, and that is correct.**
  `import { CacheService } from '@bymax-one/nest-cache'` inside `src/admin/` is not a self-import
  defect. The `./admin` tsup entry marks the package `external`, so a relative import would inline
  a second copy of `CacheService` and the DI tokens — `@Inject(CacheService)` would then name a
  different class object than `BymaxCacheModule` registered, and DI would fail in the published
  package while every unit test still passed. The `*.spec.ts` files under `src/admin/` import
  relatively on purpose: Jest runs them against the source tree, not the bundle.

  The subpath also issues **no mutating Redis command**, enforced by
  `pnpm check:admin-readonly` rather than by convention. A new Redis call there is in scope for
  review even though the gate covers it, because the gate reports on the command list it was
  handed.

- **The admin scope pattern shape is a security boundary. Do not propose widening it.**
  `SCOPE_PATTERN_SHAPE` in `src/admin/config/validate-scopes.ts` admits one or more literal
  characters optionally followed by a single trailing `*`, and nothing else. That is what lets
  `isKeyInScope` decide membership by `startsWith` or equality instead of matching — exact by
  construction. Supporting an arbitrary glob such as `app:*:v1` means reimplementing Redis's
  `stringmatchlen`, and a matcher even slightly **more** permissive than the server's is a
  cross-scope leak that no happy-path test would show. A request to relax it looks like a
  convenience and is not one.

- **A namespace carrying a Redis glob metacharacter is rejected at bootstrap, and that is
  load-bearing.** `validateOptions` in `src/server/config/default-options.ts` refuses `*`, `?`,
  `[` and `\`, because `KeyBuilder.getNamespacePrefix()` composes the namespace into
  `flushNamespace`'s destructive `{namespace}{separator}*` pattern. `]` is accepted deliberately —
  measured against Redis 8.10.0 as a literal that neither widens nor silences the pattern, so
  rejecting it would restrict a namespace the library handles correctly. The exposed case is a
  namespace derived from input, such as multi-tenant wiring built from a tenant slug. A change
  that relaxes this set, or a new path composing a namespace into a match pattern without going
  through the key builder, is a security finding.

- **Two shapes of the events contract a reviewer reliably reads wrong.** Both are in
  `src/server/interfaces/cache-events.interface.ts`:

  - `ICacheEvents.onEvent` observes **connection lifecycle only** — `CacheEventName` is
    `connect | ready | error | close | reconnecting | end`. It carries no hit, miss or latency
    signal, so asking for cache metrics on this callback is asking for something the surface
    cannot give without wrapping `get()`. That is a feature request, not a review finding.
  - A forced disconnect during graceful shutdown surfaces as an **`'error'`** event carrying
    `{ role: 'main', reason: 'forced_disconnect', shutdownTimeoutMs }` and **no `error` field**,
    because the event union has no shutdown member. Consumer code branching on `data.reason` is
    reading the contract correctly; the absent `error` string is by design, not a missing null
    check.
