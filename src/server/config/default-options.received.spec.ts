/**
 * Unit tests for what an `INVALID_OPTIONS` refusal in {@link validateOptions} echoes of the value it
 * refused: the option name and the value's type, a finite number as itself, and nothing else.
 *
 * Layer: server. A configured value can be a credential or a token pasted into the wrong option, and
 * a refusal reaches logs and error reporters, so it must never carry the value itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { validateOptions } from './default-options'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

const SENTINEL = 'SENTINEL-secret-value'

/** Each validated option, with the options that carry one value of it. */
const SPELLINGS: ReadonlyArray<readonly [string, (value: unknown) => BymaxCacheModuleOptions]> = [
  ['connection.port', (v) => ({ connection: { host: 'h', port: v } }) as BymaxCacheModuleOptions],
  ['connection.db', (v) => ({ connection: { host: 'h', db: v } }) as BymaxCacheModuleOptions],
  [
    'connection.keepAlive',
    (v) => ({ connection: { host: 'h', keepAlive: v } }) as BymaxCacheModuleOptions
  ],
  [
    'connection.maxRetriesPerRequest',
    (v) => ({ connection: { host: 'h', maxRetriesPerRequest: v } }) as BymaxCacheModuleOptions
  ],
  [
    'connection.connectTimeout',
    (v) => ({ connection: { host: 'h', connectTimeout: v } }) as BymaxCacheModuleOptions
  ],
  [
    'connection.commandTimeout',
    (v) => ({ connection: { host: 'h', commandTimeout: v } }) as BymaxCacheModuleOptions
  ],
  ['shutdownTimeoutMs', (v) => ({ connection: { host: 'h' }, shutdownTimeoutMs: v }) as never],
  [
    'pubsubMaxConcurrentHandlers',
    (v) => ({ connection: { host: 'h' }, pubsubMaxConcurrentHandlers: v }) as never
  ],
  [
    'pubsubMaxQueuedMessages',
    (v) =>
      ({
        connection: { host: 'h' },
        pubsubMaxConcurrentHandlers: 1,
        pubsubMaxQueuedMessages: v
      }) as never
  ],
  ...(['password', 'username', 'tls', 'lazyConnect'] as const).map(
    (option) =>
      [
        `connection.${option} in cluster mode`,
        (v: unknown) =>
          ({
            mode: 'cluster',
            cluster: { nodes: [{ host: 'n', port: 6379 }] },
            connection: { host: 'h', [option]: v }
          }) as BymaxCacheModuleOptions
      ] as const
  ),
  ...(['keepAlive', 'maxRetriesPerRequest', 'connectTimeout', 'commandTimeout', 'db'] as const).map(
    (option) =>
      [
        `cluster.options.redisOptions.${option}`,
        (v: unknown) =>
          ({
            mode: 'cluster',
            cluster: {
              nodes: [{ host: 'n', port: 6379 }],
              options: { redisOptions: { [option]: v } }
            }
          }) as BymaxCacheModuleOptions
      ] as const
  )
]

/** The exception `validateOptions` throws for `options`, or `undefined` when it does not throw. */
function refusal(options: BymaxCacheModuleOptions): CacheException | undefined {
  try {
    validateOptions(options)
  } catch (error) {
    return error as CacheException
  }
  return undefined
}

const SECRETS: ReadonlyArray<readonly [string, unknown, string]> = [
  ['a string', SENTINEL, 'a string'],
  ['a symbol', Symbol(SENTINEL), 'a symbol'],
  ['a function', Object.defineProperty(() => 1, 'name', { value: SENTINEL }), 'a function'],
  ['an object', { token: SENTINEL }, 'an object'],
  ['an array', [SENTINEL], 'an array'],
  ['a boolean', true, 'a boolean'],
  ['a bigint', BigInt(7), 'a bigint'],
  ['null', null, 'null']
]

describe.each(SPELLINGS)('refusal details of %s', (name, build) => {
  // Scenario: the option holds a string, a symbol, a function or an object carrying a sentinel.
  // Rule: the refusal names the option and the type received, and no part of the value appears in the
  // details, the message or anything a logger renders from the exception.
  it.each(SECRETS.filter(([label]) => name !== 'shutdownTimeoutMs' || label !== 'null'))(
    'names %s and echoes none of it',
    (_label, value, received) => {
      const error = refusal(build(value))

      expect(error).toBeInstanceOf(CacheException)
      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toMatchObject({ received })
      expect(error?.details).not.toHaveProperty('value')
      for (const rendered of [
        JSON.stringify(error),
        String(error?.message),
        inspect(error, { depth: 9 })
      ]) {
        expect(rendered).not.toContain('SENTINEL')
      }
    }
  )

  // Scenario: the option holds a finite number out of range.
  // Rule: the number is printed as it is: it is a quantity, not a secret.
  it('prints a finite number out of range', () => {
    const error = refusal(build(-3.5))

    expect(error?.details).toMatchObject({ received: -3.5 })
    expect(error?.details).not.toHaveProperty('value')
  })

  // Scenario: the option holds NaN or an infinity.
  // Rule: they are named as what they are, not collapsed into "a number".
  it.each([NaN, Infinity, -Infinity])('names the non-finite number %p', (value) => {
    expect(refusal(build(value))?.details).toMatchObject({ received: String(value) })
  })
})

describe('INVALID_OPTIONS sites in default-options.ts', () => {
  // Scenario: a refusal is added or changed in default-options.ts.
  // Rule: every refusal of an option value goes through refuseOption, which is the one place that
  // describes the value; the only INVALID_OPTIONS thrown directly names no value at all.
  it('throws INVALID_OPTIONS directly only where no option value is involved', () => {
    const source = readFileSync(join(__dirname, 'default-options.ts'), 'utf8')

    expect(source.match(/CACHE_ERROR_CODES\.INVALID_OPTIONS/g)).toHaveLength(1)
    expect(source).toContain("reason: 'pubsubMaxQueuedMessages needs pubsubMaxConcurrentHandlers'")
  })
})
