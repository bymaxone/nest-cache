/**
 * Unit tests for {@link refusal} and {@link takeOwnRefusal}.
 *
 * Layer: server. Only an exception built by `refusal` is the library's own; an exception a host
 * builds with the same class, a proxy and a primitive are not, and none of them is inspected.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { takeOwnRefusal, refusal } from './own-refusals'

describe('own refusals', () => {
  // Rule: a mark is good for one pass, so a refusal the host caught and replays is no longer the library's.
  it('takes a refusal once and no longer recognises it afterwards', () => {
    const error = refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, {})

    expect(takeOwnRefusal(error)).toBe(true)
    expect(takeOwnRefusal(error)).toBe(false)
  })

  it('recognises the exception that refusal built, with its code and details', () => {
    const error = refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, { reason: 'x' })

    expect(takeOwnRefusal(error)).toBe(true)
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
    expect(takeOwnRefusal(thrown)).toBe(false)
  })

  it('answers for a proxy without running one of its traps', () => {
    const own = refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, {})
    const trap = (): never => {
      throw new Error('trap ran')
    }
    const handler = { getPrototypeOf: trap, get: trap, has: trap, ownKeys: trap }

    expect(takeOwnRefusal(new Proxy(new Error('x'), handler))).toBe(false)
    expect(takeOwnRefusal(new Proxy(own, handler))).toBe(false)
  })
})
