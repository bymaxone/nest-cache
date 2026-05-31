/**
 * Unit tests for the configurable-module builder.
 *
 * Layer: server. Pins the generated `MODULE_OPTIONS_TOKEN`, which the builder
 * derives from the `moduleName` option. The async `forRootAsync` factory injects
 * this exact token, so a changed or missing `moduleName` would silently repoint
 * it and break async registration — this test fails loudly if that happens.
 */
import { MODULE_OPTIONS_TOKEN } from './bymax-cache.module.builder'

describe('bymax-cache.module.builder', () => {
  // NestJS derives the options token as `${SNAKE_CASE(moduleName)}_MODULE_OPTIONS`.
  // Pinning the exact string proves `moduleName: 'BymaxCache'` is wired: an empty
  // name yields `_MODULE_OPTIONS` and a missing one throws at build time.
  it('derives MODULE_OPTIONS_TOKEN from the BymaxCache module name', () => {
    expect(MODULE_OPTIONS_TOKEN).toBe('BYMAX_CACHE_MODULE_OPTIONS')
  })
})
