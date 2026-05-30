# nest-cache — Repository Instructions

`@bymax-one/nest-cache` is a public npm library: a typed Redis cache for NestJS 11+ built on **ioredis 5**, with key namespacing, Pub/Sub, and a Lua script manager. Runtime: Node 24+. Package manager: pnpm. Status: scaffolding — see `docs/development_plan.md`.

## Commands

```bash
pnpm install          # install dev dependencies
pnpm typecheck        # tsc --noEmit (tsconfig.json + tsconfig.server.json)
pnpm lint             # ESLint on src/
pnpm test             # Jest unit tests
pnpm test:e2e         # Jest E2E tests (real NestJS bootstrap)
pnpm test:cov:all     # all tests with coverage — 100% gate (pre-publish enforced)
pnpm mutation         # Stryker mutation tests — break gate 95
pnpm build            # clean + tsup → dist/ (ESM + CJS + .d.ts for both subpaths)
pnpm size             # bundle-size gate (scripts/check-size.mjs)
```

## Source layout

```
src/
  server/     →  exported as "."          (NestJS module, services, connection manager, DI tokens, errors)
  shared/     →  exported as "./shared"   (zero-dependency types + constants shared with consumers)
```

## Non-negotiable rules

1. **`package.json → "dependencies"` must remain empty** — every runtime requirement lives in `peerDependencies` (`@nestjs/*`, `ioredis`, `reflect-metadata`). Adding a real dependency is a breaking change to the supply-chain contract.
2. **Error codes are namespaced `cache.*`** via `CACHE_ERROR_CODES` (append-only — never rename/remove without a major bump). Throw `CacheException`, never raw errors.
3. **ioredis 5 only** — the single Redis client peer. No `redis`/node-redis, no embedded logger, no metrics peer deps (consumers plug those in via `events.onEvent`).
4. **DI tokens are `Symbol`** (`BYMAX_CACHE_*`) and **`@Inject(TOKEN)` is explicit** on every provider (tsup strips decorator metadata — implicit DI breaks after publish).
5. **No `console.*` in `src/`** — surface diagnostics through the `events.onEvent` callback. ESLint enforces `no-console: warn`.
6. **JSDoc on every export** — every exported `class`, `function`, `interface`, `type`, and `const`.
7. **Conventional Commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, validated by commitlint.

## Architecture context

- One singleton `ioredis` client, owned by the connection manager; lifecycle via `OnModuleInit` / `OnModuleDestroy`. Standalone / Sentinel / Cluster modes.
- **Every key is namespaced** through the key builder — raw `getClient()` keys bypass tenant isolation and are an anti-pattern.
- Pluggable `ISerializer` (fail-closed deserialization) and `ICacheEvents` callback — core never imports concrete implementations beyond the `ioredis` peer.
- Dynamic module via `ConfigurableModuleBuilder` — `forRoot` / `forRootAsync`, global by default via `setExtras` → `DynamicModule.global` (not a manual `@Global()` — see spec §0). Singletons only.
