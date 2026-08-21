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
