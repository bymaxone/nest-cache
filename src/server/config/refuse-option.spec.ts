/**
 * Unit tests for {@link refuseOption}.
 *
 * Layer: server. What the exception it throws carries, and that none of the value's content does.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { refuseOption } from './refuse-option'

function thrownBy(fn: () => never): CacheException {
  try {
    fn()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('refuseOption did not throw')
}

describe('refuseOption', () => {
  // Scenario: a refusal with a bound and a reason for it.
  // Rule: INVALID_OPTIONS whose details are reason, option, received and the bounds, in that content.
  it('throws INVALID_OPTIONS with reason, option, received and the bounds', () => {
    const error = thrownBy(() => refuseOption('o', 'r', 'SENTINEL-secret', { min: 1, why: 'w' }))

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({
      reason: 'o r',
      option: 'o',
      received: 'a string',
      min: 1,
      why: 'w'
    })
  })

  // Scenario: a refusal with no bounds.
  // Rule: the details are reason, option and received only.
  it('adds nothing when there are no bounds', () => {
    expect(thrownBy(() => refuseOption('o', 'r', 7)).details).toEqual({
      reason: 'o r',
      option: 'o',
      received: 7
    })
  })

  // Scenario: the refused option holds a credential, named by its option name, and a number was given.
  // Rule: the type is reported, not the number; an option that holds a quantity still reports it.
  it.each([
    'connection.password',
    'cluster.options.redisOptions.username',
    'sentinel.sentinelPassword',
    'tls.key[0].passphrase'
  ])('reports a number given as %s as a number', (option) => {
    expect(thrownBy(() => refuseOption(option, 'r', 12345)).details).toMatchObject({
      received: 'a number'
    })
  })

  it('reports a number given as an option that holds a quantity as itself', () => {
    expect(thrownBy(() => refuseOption('connection.port', 'r', 70000)).details).toMatchObject({
      received: 70000
    })
  })
})
