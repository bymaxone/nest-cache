import type { Config } from 'jest'

// Explicit `.ts` extension: Node 24 loads this config as ESM, whose relative imports need it.
import base from './jest.config.ts'

/**
 * Jest setup for `scripts/mutate-const-tables.mjs`: the base config with the type check off, so a
 * test run fails on a failed assertion only. Not part of the build or the coverage gate.
 *
 * Layer: repository tooling.
 */
const config: Config = {
  ...base,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', diagnostics: false }]
  }
}

export default config
