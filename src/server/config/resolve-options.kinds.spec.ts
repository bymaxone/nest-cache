/**
 * The kind of a whole `tls` value, and the profile of the sentinel-side tls of a cluster's node options.
 *
 * Layer: server. `ioredis` takes a `tls` that is an object, a profile name or a flag; a number, an
 * array or a function leaves the connection configured with nothing it can use and fails at connect,
 * far from the option. They are refused when the options are resolved.
 */
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'

/** Resolves a standalone setup whose `tls` is `tls`. */
const withTls = (tls: unknown): unknown =>
  resolveOptions({ connection: { host: 'h', tls } } as unknown as BymaxCacheModuleOptions)

/** Resolves a cluster whose node options carry `redisOptions`. */
const withNodeOptions = (redisOptions: Record<string, unknown>): unknown =>
  resolveOptions({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options: { redisOptions } }
  } as unknown as BymaxCacheModuleOptions)

/** The refusal a call is expected to throw: the exact reason. */
const refusing = (reason: string, more: Record<string, unknown> = {}): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason, ...more })
  }) as Error

const KIND = 'must be an object, a profile name or a boolean'

describe('the kind of a whole tls value', () => {
  // Scenario: tls is enabled as a flag, disabled, left unset, or given as an object.
  // Rule: all of these are accepted: `true` makes the driver speak tls with its defaults.
  it.each([
    ['true', true],
    ['false', false],
    ['undefined', undefined],
    ['an object', { ca: 'c' }]
  ])('accepts tls given as %s', (_label, tls) => {
    expect(() => withTls(tls)).not.toThrow()
  })

  // Scenario: tls is a number, an array, a function or a symbol.
  // Rule: it is refused as INVALID_OPTIONS naming the option and the kinds accepted.
  it.each([
    ['a number', 5],
    ['an array', []],
    ['a function', (): void => undefined],
    ['a symbol', Symbol('tls')],
    ['a bigint', 5n]
  ])('refuses tls given as %s', (_label, tls) => {
    expect(() => withTls(tls)).toThrow(refusing(`connection.tls ${KIND}`))
  })

  it('refuses a node tls that is an array', () => {
    expect(() => withNodeOptions({ tls: [] })).toThrow(
      refusing(`cluster.options.redisOptions.tls ${KIND}`)
    )
  })
})

describe('the sentinel-side tls of a cluster node options', () => {
  // Scenario: sentinelTLS carries a profile the driver does not know, or a kind it cannot use.
  it('refuses an unknown profile in sentinelTLS', () => {
    expect(() => withNodeOptions({ sentinelTLS: { profile: 'nope' } })).toThrow(
      refusing('cluster.options.redisOptions.sentinelTLS.profile is not a known tls profile', {
        allowed: 'RedisCloudFixed or RedisCloudFlexible'
      })
    )
  })

  it('refuses a sentinelTLS that is a number', () => {
    expect(() => withNodeOptions({ sentinelTLS: 5 })).toThrow(
      refusing(`cluster.options.redisOptions.sentinelTLS ${KIND}`)
    )
  })

  it('accepts a known profile and an object in sentinelTLS', () => {
    expect(() => withNodeOptions({ sentinelTLS: { profile: 'RedisCloudFixed' } })).not.toThrow()
    expect(() => withNodeOptions({ sentinelTLS: { ca: 'c' } })).not.toThrow()
  })
})

describe('the sentinel-side tls of the cluster node options is copied once', () => {
  /** The sentinelTLS the options hand on, after they are resolved. */
  const heldSentinelTls = (sentinelTLS: unknown): unknown => {
    const resolved = withNodeOptions({ sentinelTLS }) as {
      cluster?: { options?: { redisOptions?: { sentinelTLS?: unknown } } }
    }
    return resolved.cluster?.options?.redisOptions?.sentinelTLS
  }

  // Scenario: a getter on the sentinelTLS object answers once.
  // Rule: what the driver holds, read again, is what was validated.
  it('keeps the first answer of a stateful getter', () => {
    let reads = 0
    const sentinelTLS = {}
    Object.defineProperty(sentinelTLS, 'servername', {
      enumerable: true,
      get: (): string => (reads++ === 0 ? 'first' : 'later')
    })
    const held = heldSentinelTls(sentinelTLS) as { servername: string }

    expect([held.servername, held.servername]).toEqual(['first', 'first'])
    expect(reads).toBe(1)
  })

  // Scenario: sentinelTLS is a class whose options sit behind prototype getters.
  it('reads the security options of a class by name', () => {
    class Tls {
      get ca(): string {
        return 'the-ca'
      }
    }

    expect(heldSentinelTls(new Tls())).toEqual({ ca: 'the-ca' })
  })
})
