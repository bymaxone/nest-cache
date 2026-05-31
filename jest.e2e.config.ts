import type { Config } from 'jest'

/**
 * Jest configuration for end-to-end tests.
 *
 * Lives separately from the unit-test config (`jest.config.ts`) so that the
 * coverage thresholds enforced for the unit suite never interfere with E2E
 * runs, and so that E2E specs can be discovered under `test/e2e/` rather than
 * inside `src/`.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test/e2e',
  testMatch: ['**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so e2e tests
  // and production code resolve the same module instance.
  moduleNameMapper: {
    '^@bymax-one/nest-cache$': '<rootDir>/../../src/server/index.ts',
    '^@bymax-one/nest-cache/shared$': '<rootDir>/../../src/shared/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../../tsconfig.e2e.json'
      }
    ]
  },
  testTimeout: 30_000,
  clearMocks: true,
  restoreMocks: true,
  // The resilience spec restarts a real container; Testcontainers (dockerode) and
  // ioredis leave a native reconnect handle that `async_hooks` can't track —
  // `--detectOpenHandles` reports none, and every other suite exits cleanly. Force
  // exit so the integration run doesn't print a worker warning in CI. Scoped to
  // E2E only: the unit suite (`jest.config.ts`) carries no `forceExit`.
  forceExit: true,
  passWithNoTests: process.env['CI'] !== 'true'
}

export default config
