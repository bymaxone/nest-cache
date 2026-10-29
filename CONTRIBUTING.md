# Contributing to @bymax-one/nest-cache

Thank you for your interest in contributing! This document describes the workflow
and quality gates for this library. By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open public issues for security vulnerabilities.** Follow the private
reporting process described in [SECURITY.md](./SECURITY.md).

## Prerequisites

- Node.js >= 24
- pnpm 11.20.0 (`corepack enable`; the version is pinned by `packageManager`)

## Getting started

```bash
pnpm install
pnpm build
```

## Development workflow

This is a published npm library, not an application. Keep `dependencies` empty —
everything ships as a `peerDependency` or a `node:` builtin. Conventions live in
[CLAUDE.md](./CLAUDE.md) and [AGENTS.md](./AGENTS.md); the feature roadmap lives
in [docs/development_plan.md](./docs/development_plan.md).

1. Create a branch from `main`.
2. Make your change; add or update co-located `*.spec.ts` tests (TDD — 100%
   coverage is a hard gate, not a target). Mock Redis (`ioredis-mock`) in unit
   tests — never a real connection.
3. Run the full verification suite before opening a PR.

## Verification — run before every PR

```bash
pnpm typecheck && pnpm lint && pnpm check:admin-readonly && pnpm test:cov:all && pnpm build && pnpm size && pnpm check:exports
```

All of the following must pass:

- **Typecheck** — `tsc --noEmit` for the root and server projects (strict, zero errors)
- **Lint** — ESLint (zero `any`, import order, security rules)
- **Admin read-only** — `scripts/check-admin-readonly.mjs`: the `./admin` subpath issues no mutating Redis command
- **Coverage** — 100% statements / branches / functions / lines
- **Build** — tsup produces ESM + CJS + `.d.ts` for every subpath
- **Size** — every subpath stays within the budget in `scripts/check-size.mjs`
- **Exports** — `attw --pack .` resolves every subpath under each module-resolution mode

Mutation testing is not run on pull requests. It runs after merge on `main` and in a
weekly cold run (`mutation-full.yml`); run `pnpm mutation:full` before tagging a release.

## Commits — Conventional Commits

Commit messages are validated by commitlint via the `commit-msg` hook:

```
<type>(<scope>): <subject>
```

Types: `feat | fix | docs | refactor | perf | test | build | ci | chore | revert`.
The `pre-commit` hook runs lint-staged (ESLint + Prettier on staged files).

## Pull requests

- Keep PRs focused and small.
- Record user-facing changes in `CHANGELOG.md`. A change to a published file (`README.md`,
  `CHANGELOG.md`, `dist/`) ships as a patch release: bump `package.json` and add the numbered
  `## [x.y.z]` section in the same pull request. The tag, and with it the publish, comes later.
- The `CI passed` check (aggregating `ci`, `verify`, `e2e` and `security`) must be green;
  CodeQL and OSV-Scanner also run on pull requests.
- Do not add an `osv-scanner.toml` ignore without an expiry date and a reason.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
