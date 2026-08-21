import { CACHE_ERROR_CODES } from '../../server/errors/cache-error-codes'
import { CacheException } from '../../server/errors/cache.exception'
import {
  DEFAULT_DEGRADED_ABOVE_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_SCAN_LIMIT,
  DEFAULT_COMMAND_BATCH_LIMIT,
  DEFAULT_REVEAL_LIMIT,
  DEFAULT_REVEAL_STRING_LIMIT
} from '../constants/admin-defaults'
import { resolveAdminOptions } from './resolved-admin-options'

import type { CacheScope } from '../interfaces/cache-scope.interface'

/** One valid scope, enough to get past scope validation in every case. */
const SCOPES: readonly CacheScope[] = [
  { id: 'cache', label: 'Cache', pattern: 'app:*', isReadable: true, origin: 'the namespace' }
]

/**
 * Asserts a thrown CacheException carries the expected code and exact `details`.
 * Pinning `details` kills the mutants that blank a throw site's object or its
 * string literals.
 */
const expectCode = (fn: () => void, code: string, details?: Record<string, unknown>): void => {
  expect(fn).toThrow(CacheException)
  try {
    fn()
  } catch (error) {
    expect((error as CacheException).code).toBe(code)
    if (details) {
      expect((error as CacheException).details).toEqual(details)
    }
  }
}

describe('resolveAdminOptions', () => {
  // Every threshold has a documented default so a consumer can wire the module
  // with scopes alone.
  it('applies every default when only scopes are supplied', () => {
    const resolved = resolveAdminOptions({ scopes: SCOPES })
    expect(resolved.degradedAboveMs).toBe(DEFAULT_DEGRADED_ABOVE_MS)
    expect(resolved.probeTimeoutMs).toBe(DEFAULT_PROBE_TIMEOUT_MS)
    expect(resolved.scanLimit).toBe(DEFAULT_SCAN_LIMIT)
    expect(resolved.commandBatchLimit).toBe(DEFAULT_COMMAND_BATCH_LIMIT)
    expect(resolved.revealLimit).toBe(DEFAULT_REVEAL_LIMIT)
    expect(resolved.revealStringLimit).toBe(DEFAULT_REVEAL_STRING_LIMIT)
    expect(resolved.isGlobal).toBe(false)
  })

  // An administration surface is wired where it is used, so global registration
  // is opt-in — the opposite of the cache module's default, and deliberately so.
  it('does not register globally by default', () => {
    expect(resolveAdminOptions({ scopes: SCOPES }).isGlobal).toBe(false)
  })

  // Every threshold must be overridable. A default that cannot be changed is a
  // hard-coded value with extra steps.
  it('honours every supplied override', () => {
    const resolved = resolveAdminOptions({
      scopes: SCOPES,
      degradedAboveMs: 10,
      probeTimeoutMs: 20,
      scanLimit: 30,
      commandBatchLimit: 40,
      revealLimit: 50,
      revealStringLimit: 60,
      isGlobal: true
    })
    expect(resolved).toMatchObject({
      degradedAboveMs: 10,
      probeTimeoutMs: 20,
      scanLimit: 30,
      commandBatchLimit: 40,
      revealLimit: 50,
      revealStringLimit: 60,
      isGlobal: true
    })
  })

  // Scope validation is delegated, not duplicated — a malformed scope must still
  // fail at wiring through this entry point.
  it('rejects a malformed scope list', () => {
    expect(() => resolveAdminOptions({ scopes: [] })).toThrow(CacheException)
  })

  // A non-positive threshold is not a tuning choice, it is a broken surface: a
  // zero degraded threshold marks a healthy cache degraded, and a zero probe
  // timeout reports every cache down without asking.
  it.each([
    ['degradedAboveMs', 0],
    ['degradedAboveMs', -1],
    ['probeTimeoutMs', 0],
    ['scanLimit', 0],
    ['commandBatchLimit', 0],
    ['revealLimit', 0],
    ['revealStringLimit', 0]
  ])('rejects %s of %p', (field, value) => {
    expect(() => resolveAdminOptions({ scopes: SCOPES, [field]: value })).toThrow(CacheException)
  })

  // The rejection names the option and the value, so a consumer fixes the line
  // they wrote rather than searching for it.
  it('names the offending option and value', () => {
    try {
      resolveAdminOptions({ scopes: SCOPES, scanLimit: 0 })
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_SCOPE)
      expect((error as CacheException).details).toEqual({
        reason: 'threshold must be positive',
        option: 'scanLimit',
        value: 0
      })
    }
    expect.hasAssertions()
  })

  // Each rejection must name ITS OWN option. One shared assertion would let every
  // name but the tested one drift to something else — and the name is the whole
  // value of the message to whoever has to find the line they wrote.
  it.each([
    ['degradedAboveMs'],
    ['probeTimeoutMs'],
    ['scanLimit'],
    ['commandBatchLimit'],
    ['revealLimit'],
    ['revealStringLimit']
  ])('names %s as the offending option', (option) => {
    expectCode(
      () => resolveAdminOptions({ scopes: SCOPES, [option]: 0 }),
      CACHE_ERROR_CODES.INVALID_SCOPE,
      { reason: 'threshold must be positive', option, value: 0 }
    )
  })

  // A non-integer limit would make a cap ambiguous — 2.5 keys is not a page size.
  it('rejects a fractional limit', () => {
    expect(() => resolveAdminOptions({ scopes: SCOPES, scanLimit: 2.5 })).toThrow(CacheException)
  })

  // The resolved object is frozen: thresholds decided at wiring must not be
  // editable by anything that later holds them.
  it('freezes the resolved options', () => {
    expect(Object.isFrozen(resolveAdminOptions({ scopes: SCOPES }))).toBe(true)
  })
})
