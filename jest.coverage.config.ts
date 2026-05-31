import type { Config } from 'jest'

/**
 * Aggregated Jest configuration for unit + E2E coverage.
 *
 * Discovers both unit specs in `src/` and E2E specs in `test/e2e/` in a single
 * Jest run, and instruments every source file under `src/` regardless of which
 * suite touched it. Lines covered exclusively by E2E tests count toward the
 * 100% threshold, and vice-versa.
 *
 * Use this for release-time validation (`pnpm test:cov:all`) and CI gates.
 * Day-to-day development should still prefer the faster `pnpm test:cov`,
 * which only runs the unit suite.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  // This config scans the whole project (rootDir '.'), so exclude build output
  // and Stryker sandboxes: both hold copies of `src/` that share the package's
  // Haste module name, which otherwise crashes jest-haste-map with
  // "dupMap.get is not a function" on the `@bymax-one/nest-cache` alias.
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.stryker-tmp/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so tests and
  // production code resolve the same module instance — a dual-package hazard
  // would make `instanceof` checks return false across subpath boundaries.
  moduleNameMapper: {
    '^@bymax-one/nest-cache$': '<rootDir>/src/server/index.ts',
    '^@bymax-one/nest-cache/shared$': '<rootDir>/src/shared/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.e2e.json'
      }
    ]
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/**/index.ts',
    '!src/**/*.d.ts'
  ],
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  // This run includes the Testcontainers E2E specs (60s allows for container
  // boots, e.g. the real Redis Cluster).
  testTimeout: 60_000,
  // Boot the containers SERIALLY: concurrent starts starve the Docker daemon and
  // the real Redis Cluster destabilizes (CLUSTERDOWN) under parallel boots on CI
  // runners. The dedicated `test:e2e` run uses `--runInBand` for the same reason.
  maxWorkers: 1,
  // The restart/cluster/sentinel E2E leave a native ioredis handle async_hooks
  // can't track (verified via --detectOpenHandles); force a clean exit.
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: process.env['CI'] !== 'true'
}

export default config
