/**
 * Unit tests for the numeric connection options in {@link validateOptions}: `port`, `db`,
 * `maxRetriesPerRequest` and `keepAlive`, in the standalone block and in `cluster.options.redisOptions`.
 *
 * Layer: server. Each option is passed `NaN`, `Infinity`, `-1`, `0`, `1.5` and `'3'`: what is
 * refused, with which details, and that a value in range, or unset, is accepted. `null` for
 * `maxRetriesPerRequest` and `0` for `keepAlive` are refused with the reason. `NaN` is the case a
 * `value < min` check lets through.
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
        expect(Object.is(details?.['value'], value)).toBe(true)
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

    expect(details).toMatchObject({ option: `${where}.maxRetriesPerRequest`, value: null })
    expect(details?.['why']).toMatch(/only commandTimeout/)
  })

  // Scenario: keepAlive is 0, which the socket reads as the operating system's own delay.
  // Rule: it is refused, and the error says why: the 30 s probe would be lost.
  it('refuses keepAlive 0 and says why', () => {
    const details = refusal(withOption(spelling, 'keepAlive', 0))

    expect(details?.['why']).toMatch(/30 s probe is lost/)
  })
})
