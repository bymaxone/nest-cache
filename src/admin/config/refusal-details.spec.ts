/**
 * Unit tests for what a refusal of the administration options echoes of the value it refused: the
 * option's name, by position for a scope field, and the value's type, never the value.
 *
 * Layer: admin. A scope or a threshold can hold a token pasted into the wrong place, and a refusal
 * reaches logs and error reporters, so it must never carry the value itself.
 */
import { inspect } from 'node:util'

import { CACHE_ERROR_CODES } from '../../server/errors/cache-error-codes'
import { CacheException } from '../../server/errors/cache.exception'
import { resolveAdminOptions } from './resolved-admin-options'
import { validateScopes } from './validate-scopes'

import type { BymaxCacheAdminModuleOptions } from '../interfaces/admin-module-options.interface'

const SENTINEL = 'SENTINEL-secret-value'

const SCOPE = {
  id: 'cache',
  label: 'Application cache',
  pattern: 'app:*',
  isReadable: true,
  origin: 'the application namespace'
}

/** The exception `run` throws, or `undefined` when it does not throw. */
function refusal(run: () => unknown): CacheException | undefined {
  try {
    run()
  } catch (error) {
    return error as CacheException
  }
  return undefined
}

/** Fails when any rendering of the exception carries the sentinel. */
function expectNoSentinel(error: CacheException | undefined): void {
  for (const rendered of [
    JSON.stringify(error),
    String(error?.message),
    inspect(error, { depth: 9 })
  ]) {
    expect(rendered).not.toContain('SENTINEL')
  }
}

const HOLDERS: ReadonlyArray<readonly [string, unknown, number | string]> = [
  ['a string', SENTINEL, 'a string'],
  ['a symbol', Symbol(SENTINEL), 'a symbol'],
  ['a function', Object.defineProperty(() => 1, 'name', { value: SENTINEL }), 'a function'],
  ['an object', { token: SENTINEL }, 'an object'],
  ['a boolean', true, 'a boolean']
]

describe('scope field refusals', () => {
  // Scenario: a required text field of a scope holds something that is not a string.
  // Rule: INVALID_SCOPE naming the field by position and the type received, never a TypeError and
  // never the value.
  describe.each(['id', 'label', 'pattern', 'origin'])('%s', (field) => {
    it.each([
      ...HOLDERS.filter(([label]) => label !== 'a string'),
      ['undefined', undefined, 'undefined'],
      ['null', null, 'null']
    ] as ReadonlyArray<readonly [string, unknown, number | string]>)(
      'refuses %s',
      (_label, value, received) => {
        const error = refusal(() => validateScopes([{ ...SCOPE, [field]: value } as never]))

        expect(error).toBeInstanceOf(CacheException)
        expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_SCOPE)
        expect(error?.details).toEqual({
          reason: `scopes[0].${field} must be a string`,
          option: `scopes[0].${field}`,
          received
        })
        expectNoSentinel(error)
      }
    )
  })

  // Scenario: a pattern or an id carrying the sentinel is refused by the rules.
  // Rule: the position names it; the string does not appear.
  it('does not echo a refused pattern or a duplicated id', () => {
    const pattern = refusal(() => validateScopes([{ ...SCOPE, pattern: `${SENTINEL}*x` }]))
    const duplicate = refusal(() =>
      validateScopes([
        { ...SCOPE, id: SENTINEL },
        { ...SCOPE, id: SENTINEL, pattern: 'o:*' }
      ])
    )

    expect(pattern?.details).toEqual({
      reason: 'scopes[0].pattern must be a literal prefix optionally followed by *',
      option: 'scopes[0].pattern',
      received: 'a string'
    })
    expect(duplicate?.details).toEqual({
      reason: 'scopes[1].id duplicates scopes[0].id',
      option: 'scopes[1].id',
      received: 'a string'
    })
    expectNoSentinel(pattern)
    expectNoSentinel(duplicate)
  })

  // Scenario: the list, or an entry of it, is not what the types say.
  // Rule: a refusal naming the list or the entry's position, with its type.
  it.each([
    ['scopes', SENTINEL, 'a string'],
    ['scopes', Symbol(SENTINEL), 'a symbol'],
    ['scopes', { token: SENTINEL }, 'an object']
  ])('refuses %s of %s', (option, value, received) => {
    const error = refusal(() => validateScopes(value as never))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_SCOPE)
    expect(error?.details).toEqual({ reason: `${option} must be an array`, option, received })
    expectNoSentinel(error)
  })

  it.each([
    ['a string', SENTINEL, 'a string'],
    ['null', null, 'null'],
    ['a function', Object.defineProperty(() => 1, 'name', { value: SENTINEL }), 'a function']
  ])('refuses an entry that is %s', (_label, entry, received) => {
    const error = refusal(() => validateScopes([SCOPE, entry as never]))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_SCOPE)
    expect(error?.details).toEqual({
      reason: 'scopes[1] must be an object',
      option: 'scopes[1]',
      received
    })
    expectNoSentinel(error)
  })
})

describe('threshold refusals', () => {
  const OPTIONS = [
    'degradedAboveMs',
    'probeTimeoutMs',
    'scanLimit',
    'scanRoundsLimit',
    'commandBatchLimit',
    'revealLimit',
    'revealStringLimit'
  ] as const

  // Scenario: a threshold holds a string, a symbol, a function or an object.
  // Rule: INVALID_SCOPE naming the option and the type received, and no part of the value.
  describe.each(OPTIONS)('%s', (option) => {
    it.each(HOLDERS)('refuses %s', (_label, value, received) => {
      const options = {
        scopes: [SCOPE],
        [option]: value
      } as unknown as BymaxCacheAdminModuleOptions
      const error = refusal(() => resolveAdminOptions(options))

      expect(error).toBeInstanceOf(CacheException)
      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_SCOPE)
      expect(error?.details).toEqual({
        reason: `${option} must be a positive integer`,
        option,
        received
      })
      expectNoSentinel(error)
    })
  })
})
