/**
 * Unit tests for the Pub/Sub handler bounds in {@link validateOptions} and {@link applyDefaults}.
 *
 * Layer: server. Which values of `pubsubMaxConcurrentHandlers` and `pubsubMaxQueuedMessages` are
 * accepted, what is refused with which details, and that unset stays unset.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { applyDefaults, validateOptions } from './default-options'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

const base: BymaxCacheModuleOptions = { connection: { host: 'h' } }

/** The `details` of the exception `validateOptions` throws for `options`, or `undefined` when it does not throw. */
function refusal(options: BymaxCacheModuleOptions): Record<string, unknown> | undefined {
  try {
    validateOptions(options)
  } catch (error) {
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error).toBeInstanceOf(CacheException)
    return (error as CacheException).details ?? undefined
  }
  return undefined
}

describe('Pub/Sub handler bounds', () => {
  // Scenario: neither bound is set.
  // Rule: nothing is refused, and the resolved options carry both as unset.
  it('accepts options that set neither bound and resolves both as unset', () => {
    expect(refusal(base)).toBeUndefined()
    const resolved = applyDefaults(base)
    expect([resolved.pubsubMaxConcurrentHandlers, resolved.pubsubMaxQueuedMessages]).toEqual([
      undefined,
      undefined
    ])
  })

  // Scenario: both bounds are set to values in range, at their edges.
  // Rule: they are accepted and resolved as given.
  it('accepts the smallest and the largest values and resolves them as given', () => {
    const smallest = { ...base, pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: 0 }
    const largest = {
      ...base,
      pubsubMaxConcurrentHandlers: 2 ** 31 - 1,
      pubsubMaxQueuedMessages: 2 ** 31 - 1
    }

    expect([refusal(smallest), refusal(largest)]).toEqual([undefined, undefined])
    expect(applyDefaults(smallest).pubsubMaxQueuedMessages).toBe(0)
    expect(applyDefaults(largest).pubsubMaxConcurrentHandlers).toBe(2 ** 31 - 1)
  })

  // Scenario: a concurrency bound that is not a positive integer, or too large to hold.
  // Rule: it is refused with the option, the number received and the range, and no part of anything else.
  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 31])(
    'refuses pubsubMaxConcurrentHandlers %p',
    (value) => {
      expect(refusal({ ...base, pubsubMaxConcurrentHandlers: value })).toEqual({
        reason: 'pubsubMaxConcurrentHandlers not an integer in range',
        option: 'pubsubMaxConcurrentHandlers',
        received: Number.isFinite(value) ? value : String(value),
        min: 1,
        max: 2 ** 31 - 1
      })
    }
  )

  // Scenario: a queue bound that is not a non-negative integer, or too large to hold.
  // Rule: it is refused the same way, with a minimum of 0.
  it.each([-1, 0.5, NaN, -Infinity, 2 ** 31])('refuses pubsubMaxQueuedMessages %p', (value) => {
    expect(
      refusal({ ...base, pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: value })
    ).toEqual({
      reason: 'pubsubMaxQueuedMessages not an integer in range',
      option: 'pubsubMaxQueuedMessages',
      received: Number.isFinite(value) ? value : String(value),
      min: 0,
      max: 2 ** 31 - 1
    })
  })

  // Scenario: a queue bound with no concurrency bound to queue behind.
  // Rule: it is refused, so the pair cannot be misread as bounding something.
  it('refuses a queue bound without a concurrency bound', () => {
    expect(refusal({ ...base, pubsubMaxQueuedMessages: 10 })).toEqual({
      reason: 'pubsubMaxQueuedMessages needs pubsubMaxConcurrentHandlers'
    })
  })
})
