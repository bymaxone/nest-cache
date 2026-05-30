# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding aligned to the `@bymax-one/*` library standard: tsup dual
  subpath build (`.` server + `./shared`, ESM + CJS + `.d.ts`), Jest 30 +
  Stryker 9, 100% coverage gate, ESLint + Prettier, husky + commitlint +
  lint-staged, the CI / CodeQL / Scorecard / Release (OIDC) workflows,
  dependabot, and the `check-size` + `dogfood-smoke-test` scripts.
- Foundational source seed: `CACHE_ERROR_CODES` and `CacheException`, connection
  event types (`CacheEventName`, `CacheConnectionStatus`), and the
  `Symbol`-based DI tokens (`BYMAX_CACHE_OPTIONS`, `BYMAX_CACHE_CONNECTION`,
  `BYMAX_CACHE_SCRIPT_REGISTRY`, `BYMAX_CACHE_EVENTS`).

> The cache engine itself — connection manager, `CacheService`, Pub/Sub, the Lua
> script manager, and `BymaxCacheModule.forRoot` / `forRootAsync` — is delivered
> across Phases 1-4. See [docs/development_plan.md](./docs/development_plan.md).
