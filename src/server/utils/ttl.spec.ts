/**
 * Unit tests for {@link assertTtlSeconds}.
 *
 * Layer: server. Pins the TTL contract at its boundaries: what is accepted, what is
 * refused and with which structured details, for both the strict minimum of the
 * `SET ... EX` family and the integer-only rule of `EXPIRE`.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { assertTtlSeconds } from './ttl'

const catchException = (fn: () => void): CacheException => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CacheException)
    return error as CacheException
  }
  throw new Error('expected assertTtlSeconds to throw')
}

describe('assertTtlSeconds', () => {
  describe.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a float', 1.5],
    ['a float below one', 0.5],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['a string typed as a number', '10' as unknown as number]
  ])('%s', (_label, value) => {
    // A value that is not a safe integer is refused whatever the minimum, with the
    // reason that names the defect — Redis would reject it with a raw reply error.
    it.each([1, undefined])('is refused with minimum %s', (minimum) => {
      const error = catchException(() => assertTtlSeconds(value, minimum))

      expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
      expect(error.details).toEqual({ reason: 'not_a_safe_integer' })
    })
  })

  // Zero and negative integers are integers: the strict minimum refuses them and says
  // what the minimum is, while a call without a minimum leaves them to Redis.
  it.each([0, -1, -86_400])('refuses %s below a minimum of 1', (value) => {
    const error = catchException(() => assertTtlSeconds(value, 1))

    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
    expect(error.details).toEqual({ reason: 'below_minimum', minimum: 1 })
  })

  it.each([0, -1, -86_400])('accepts %s when no minimum applies', (value) => {
    expect(() => assertTtlSeconds(value, undefined)).not.toThrow()
  })

  // The boundaries that must stay valid: the smallest positive TTL and a large one.
  it.each([1, 2, 3600, 31_536_000, Number.MAX_SAFE_INTEGER])('accepts %s', (value) => {
    expect(() => assertTtlSeconds(value, 1)).not.toThrow()
  })
})
