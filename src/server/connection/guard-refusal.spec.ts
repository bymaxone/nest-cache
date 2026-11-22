/**
 * The refusal of the guard on `Object.prototype` is the same exception the throw sites build, made without a
 * built-in that is looked up when it runs.
 *
 * Layer: server.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { guardRefusal } from './guard-refusal'

describe('guardRefusal', () => {
  // Scenario: a refusal for a count of three.
  // Rule: it reads as a CacheException built the ordinary way with the same code and details.
  it('matches the exception the constructor builds for the same code and details', () => {
    const details = {
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 3
    }
    const expected = new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, details)

    const refusal = guardRefusal(3)

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
    expect(guardRefusal(1).details).toEqual(expect.objectContaining({ count: 1 }))
    expect(guardRefusal(7).details).toEqual(expect.objectContaining({ count: 7 }))
  })
})
