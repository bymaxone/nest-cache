import { defineConfig } from 'tsup'

export default defineConfig([
  // Server entry (main) — NestJS module + ioredis integration
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    external: [/^@nestjs\//, 'reflect-metadata', 'ioredis'],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Admin entry — privileged read-only administration surface.
  //
  // `@bymax-one/nest-cache` is EXTERNAL here on purpose. Bundling the server
  // modules into this entry would give the admin bundle its own copies of
  // `CacheService` and the Symbol tokens, so `@Inject(CacheService)` in an admin
  // provider would name a different class object than the one
  // `BymaxCacheModule` registered and DI would fail to resolve at a consumer's
  // runtime. Importing the package by name keeps one instance per install — the
  // same dual-package hazard the jest `moduleNameMapper` comment names.
  {
    entry: { 'admin/index': 'src/admin/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    external: [/^@nestjs\//, 'reflect-metadata', 'ioredis', '@bymax-one/nest-cache'],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Metrics entry — publishes the connection lifecycle on the application's registry.
  //
  // `@bymax-one/nest-core` and `prom-client` are optional peers and EXTERNAL: this is the only entry
  // that imports either, so a consumer that never imports it never loads them. `@bymax-one/nest-cache`
  // is external for the reason the admin entry gives: one copy of the types per install.
  {
    entry: { 'metrics/index': 'src/metrics/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    external: [
      /^@nestjs\//,
      'reflect-metadata',
      'ioredis',
      '@bymax-one/nest-cache',
      '@bymax-one/nest-core',
      'prom-client'
    ],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Observability entry — operations, Pub/Sub backlog and drops on the application's registry, a
  // readiness indicator and the library's log events.
  //
  // Same externals as the metrics entry, for the same reasons: `@bymax-one/nest-core` and
  // `prom-client` are optional peers that only this entry and `./metrics` import, and
  // `@bymax-one/nest-cache` stays external so there is one copy of the server types per install.
  {
    entry: { 'observability/index': 'src/observability/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    external: [
      /^@nestjs\//,
      'reflect-metadata',
      'ioredis',
      '@bymax-one/nest-cache',
      '@bymax-one/nest-core',
      'prom-client'
    ],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Idempotency entry — a Redis store for HTTP idempotency keys.
  //
  // `@bymax-one/nest-cache` is external for the reason the admin entry gives (one copy of
  // `ScriptManagerService`, `KeyBuilder` and the error types per install). `@bymax-one/nest-core` is
  // external and imported for types only, so the bundle holds no runtime reference to it.
  {
    entry: { 'idempotency/index': 'src/idempotency/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    external: [
      /^@nestjs\//,
      'reflect-metadata',
      'ioredis',
      '@bymax-one/nest-cache',
      '@bymax-one/nest-core'
    ],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Shared entry — types + constants (zero deps)
  {
    entry: { 'shared/index': 'src/shared/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.cjs'
    }),
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  }
])
