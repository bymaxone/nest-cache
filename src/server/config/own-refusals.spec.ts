/**
 * Unit tests for {@link refusal} and {@link isOwnRefusal}.
 *
 * Layer: server. Only an exception built by `refusal` is the library's own; an exception a host
 * builds with the same class, a proxy and a primitive are not, and none of them is inspected.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { isOwnRefusal, refusal } from './own-refusals'

describe('own refusals', () => {
  it('recognises the exception that refusal built, with its code and details', () => {
    const error = refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, { reason: 'x' })

    expect(isOwnRefusal(error)).toBe(true)
    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({ reason: 'x' })
  })

  // Scenario: a host builds a CacheException with the public class, or throws something odd.
  // Rule: none of them is the library's own.
  it.each([
    ['a CacheException the host built', new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {})],
    ['a plain error', new Error('x')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 7]
  ])('does not take %s for its own', (_name, thrown) => {
    expect(isOwnRefusal(thrown)).toBe(false)
  })

  it('answers for a proxy without running one of its traps', () => {
    const own = refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, {})
    const trap = (): never => {
      throw new Error('trap ran')
    }
    const handler = { getPrototypeOf: trap, get: trap, has: trap, ownKeys: trap }

    expect(isOwnRefusal(new Proxy(new Error('x'), handler))).toBe(false)
    expect(isOwnRefusal(new Proxy(own, handler))).toBe(false)
  })
})
