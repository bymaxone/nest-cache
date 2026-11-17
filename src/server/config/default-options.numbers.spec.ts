/**
 * Unit tests for the numeric connection options in {@link validateOptions}: `port`, `db`,
 * `maxRetriesPerRequest` and `keepAlive`, in the standalone block and in `cluster.options.redisOptions`.
 *
 * Layer: server. What each option refuses, with which details, and that a value in range, or unset,
 * is accepted. `null` for `maxRetriesPerRequest` and `0` for `keepAlive` are refused with the reason.
 * `NaN` is the case a `value < min` check lets through.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { validateOptions } from './default-options'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

type Spelling = 'standalone' | 'cluster'

/** Options that carry `value` in `option`, in the place a mode takes it from. */
function withOption(spelling: Spelling, option: string, value: unknown): BymaxCacheModuleOptions {
  if (spelling === 'standalone') {
    return { connection: { host: 'h', [option]: value } } as BymaxCacheModuleOptions
  }
  return {
    mode: 'cluster',
    cluster: { nodes: [{ host: 'h', port: 7000 }], options: { redisOptions: { [option]: value } } }
  } as BymaxCacheModuleOptions
}

/** The `details` of the exception `validateOptions` throws for `options`, or `undefined` when it does not throw. */
function refusal(options: BymaxCacheModuleOptions): Record<string, unknown> | undefined {
  try {
    validateOptions(options)
  } catch (error) {
    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    return (error as CacheException).details ?? undefined
  }
  return undefined
}

const SIX = [NaN, Infinity, -1, 0, 1.5, '3'] as const
const MAX = 2 ** 31 - 1

/** Per option: the values it refuses beyond the six, the smallest and largest it accepts. */
const OPTIONS = [
  { option: 'port', refused: [0, -1, 65536, ...SIX], smallest: 1, largest: 65535 },
  { option: 'db', refused: [-1, 1.5, NaN, Infinity, '3'], smallest: 0, largest: 1000 },
  { option: 'keepAlive', refused: [0, ...SIX, MAX + 1], smallest: 1, largest: MAX },
  {
    option: 'maxRetriesPerRequest',
    refused: [-1, 1.5, NaN, Infinity, '3', MAX + 1],
    smallest: 0,
    largest: MAX
  }
] as const

describe.each(['standalone', 'cluster'] as const)('numeric connection options (%s)', (spelling) => {
  const where = spelling === 'standalone' ? 'connection' : 'cluster.options.redisOptions'

  describe.each(OPTIONS.filter((o) => spelling === 'standalone' || o.option !== 'port'))(
    '$option',
    ({ option, refused, smallest, largest }) => {
      // Scenario: a value that is not an integer in range, among them NaN, an infinity and a string.
      // Rule: it is refused at boot naming the option, the value and the range, never accepted.
      it.each(refused)('refuses %p', (value) => {
        const details = refusal(withOption(spelling, option, value))

        expect(details).toMatchObject({ option: `${where}.${option}` })
        expect(details).toHaveProperty('reason')
        expect(details).not.toHaveProperty('value')
        expect(details?.['received']).toBe(
          typeof value === 'number' && !Number.isFinite(value)
            ? String(value)
            : typeof value === 'string'
              ? 'a string'
              : value
        )
      })

      // Scenario: a refusal of this option.
      // Rule: it carries the `reason` naming the option, the range, and a `why` only where one is
      // stated: port and db have none, because their range needs no explanation.
      it('carries the reason and the range, and no why for an ordinary out-of-range value', () => {
        const details = refusal(withOption(spelling, option, -1))

        expect(details?.['reason']).toBe(`${where}.${option} not an integer in range`)
        expect(details).toMatchObject({ min: expect.any(Number), max: expect.any(Number) })
        expect(details).not.toHaveProperty('why')
      })

      // Scenario: the smallest and the largest value in range.
      // Rule: both are accepted.
      it('accepts the smallest and the largest value', () => {
        expect(refusal(withOption(spelling, option, smallest))).toBeUndefined()
        expect(refusal(withOption(spelling, option, largest))).toBeUndefined()
      })

      // Scenario: the option is not set.
      // Rule: nothing is refused; the driver or the library default applies.
      it('accepts the option unset', () => {
        expect(refusal(withOption(spelling, option, undefined))).toBeUndefined()
      })
    }
  )

  // Scenario: maxRetriesPerRequest is null, which ioredis takes as "retry without limit".
  // Rule: it is refused, and the error says why: only commandTimeout would bound a command.
  it('refuses maxRetriesPerRequest null and says why', () => {
    const details = refusal(withOption(spelling, 'maxRetriesPerRequest', null))

    expect(details).toMatchObject({ option: `${where}.maxRetriesPerRequest`, received: 'null' })
    expect(details?.['why']).toMatch(/only commandTimeout/)
  })

  // Scenario: keepAlive is 0, which the socket reads as the operating system's own delay.
  // Rule: it is refused, and the error says why: the 30 s probe would be lost.
  it('refuses keepAlive 0 and says why', () => {
    const details = refusal(withOption(spelling, 'keepAlive', 0))

    expect(details?.['why']).toMatch(/30 s probe is lost/)
  })
})

describe('numeric connection options when a url is set', () => {
  // Scenario: the url carries the port, so the discrete `port` is replaced by it and never used.
  // Rule: a discrete `port` that would be refused alone is accepted beside a url.
  it('accepts an invalid discrete port that the url overrides', () => {
    const options = { connection: { url: 'redis://h:6379/0', port: 0 } }

    expect(refusal(options)).toBeUndefined()
  })

  // Scenario: the url names a database, so the discrete `db` is replaced by it.
  // Rule: an invalid discrete `db` is accepted when the url overrides it, and refused when the url
  // carries no database, because then it is the one the driver uses.
  it('refuses an invalid discrete db only when the url does not override it', () => {
    const overridden = { connection: { url: 'redis://h:6379/2', db: NaN } }
    const kept = { connection: { url: 'redis://h:6379', db: NaN } }

    expect(refusal(overridden)).toBeUndefined()
    expect(refusal(kept)).toMatchObject({ option: 'connection.db' })
  })

  // Scenario: an invalid keepAlive beside a url, which the url never carries.
  // Rule: it is still refused.
  it('still refuses an invalid keepAlive', () => {
    expect(refusal({ connection: { url: 'redis://h:6379', keepAlive: 0 } })).toMatchObject({
      option: 'connection.keepAlive'
    })
  })
})

describe('a null option group', () => {
  // Scenario: a whole group is null: `cluster.options.redisOptions`, or `connection` in cluster mode,
  // where a cluster ignores it.
  // Rule: it counts as absent; validation does not throw a TypeError.
  it.each([
    [
      'cluster.options.redisOptions',
      {
        mode: 'cluster',
        cluster: { nodes: [{ host: 'n', port: 6379 }], options: { redisOptions: null } }
      }
    ],
    [
      'connection in cluster mode',
      { mode: 'cluster', cluster: { nodes: [{ host: 'n', port: 6379 }] }, connection: null }
    ]
  ])('treats a null %s as absent', (_name, options) => {
    expect(() => validateOptions(options as unknown as BymaxCacheModuleOptions)).not.toThrow()
  })

  // Scenario: a standalone connection that is null.
  // Rule: it is reported as a missing connection, CONNECTION_FAILED, never a TypeError.
  it('reports a null standalone connection as a missing connection', () => {
    let thrown: unknown
    try {
      validateOptions({ connection: null } as unknown as BymaxCacheModuleOptions)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheException)
    expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
  })
})
