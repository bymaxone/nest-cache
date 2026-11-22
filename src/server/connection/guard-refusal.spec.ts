/**
 * The refusal of the guard on `Object.prototype` is the same exception the throw sites build, made without a
 * built-in that is looked up when it runs.
 *
 * Layer: server.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { BUILTINS_REASON, guardRefusal, KEYS_REASON } from './guard-refusal'

describe('guardRefusal', () => {
  // Scenario: a refusal for a count of three.
  // Rule: it reads as a CacheException built the ordinary way with the same code and details.
  it('matches the exception the constructor builds for the same code and details', () => {
    const details = {
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 3
    }
    const expected = new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, details)

    const refusal = guardRefusal(KEYS_REASON, 3)

    expect(refusal).toBeInstanceOf(CacheException)
    expect(refusal).toBeInstanceOf(Error)
    expect(refusal.code).toBe(expected.code)
    expect(refusal.details).toEqual(details)
    expect(refusal.message).toBe(expected.message)
    expect(refusal.getStatus()).toBe(expected.getStatus())
    expect(refusal.getResponse()).toEqual(expected.getResponse())
    expect(typeof refusal.stack).toBe('string')
  })

  // Rule: each refusal carries its own count.
  it('carries the count of its own call', () => {
    expect(guardRefusal(KEYS_REASON, 1).details).toEqual(expect.objectContaining({ count: 1 }))
    expect(guardRefusal(BUILTINS_REASON, 7).details).toEqual(expect.objectContaining({ count: 7 }))
  })

  // Rule: the two reasons are different texts, so a host can tell a planted key from a replaced built-in.
  it('names a different reason for a key and for a replaced built-in', () => {
    expect(guardRefusal(KEYS_REASON, 1).details).toEqual({ reason: KEYS_REASON, count: 1 })
    expect(guardRefusal(BUILTINS_REASON, 1).details).toEqual({ reason: BUILTINS_REASON, count: 1 })
    expect(KEYS_REASON).not.toBe(BUILTINS_REASON)
  })
})
