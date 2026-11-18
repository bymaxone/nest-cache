/**
 * Unit tests for `validateOptions` and `applyDefaults`: each connection mode refuses the options
 * it cannot start with, a refusal carries a coded `CacheException` that never echoes a credential,
 * and every default is applied to what the caller left out.
 *
 * Layer: server.
 */
import { inspect } from 'node:util'

import { DEFAULT_KEY_SEPARATOR, DEFAULT_NAMESPACE } from '../constants/default-namespace'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  MIN_COMMAND_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { applyDefaults, validateOptions } from './default-options'

import type { ISerializer } from '../interfaces/serializer.interface'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/**
 * Asserts a thrown CacheException carries the expected canonical code and,
 * when `details` is supplied, the exact structured `details` payload. Pinning
 * `details` kills the mutants that blank the throw site's `{ ... }` object or
 * its string literals.
 */
/** What a refusal prints of a number: a finite one as itself, `NaN` and an infinity as their names. */
const shown = (value: number): number | string => (Number.isFinite(value) ? value : String(value))

const expectCode = (fn: () => void, code: string, details?: Record<string, unknown>): void => {
  expect(fn).toThrow(CacheException)
  try {
    fn()
  } catch (error) {
    expect((error as CacheException).code).toBe(code)
    if (details) {
      expect((error as CacheException).details).toEqual(details)
    }
  }
}

describe('validateOptions', () => {
  // A standalone connection identified by host satisfies the connection
  // invariant and must not throw.
  it('accepts a standalone connection by host', () => {
    expect(() => validateOptions({ connection: { host: 'h' } })).not.toThrow()
  })

  // A standalone connection identified by url is equally valid (the other side
  // of the `!url && !host` guard).
  it('accepts a standalone connection by url', () => {
    expect(() => validateOptions({ connection: { url: 'redis://h:6379' } })).not.toThrow()
  })

  // A malformed connection.url must throw CONNECTION_FAILED at bootstrap — the
  // library wraps the raw parse error in its structured exception so the failure
  // surfaces at forRoot, not as a generic Error during connection construction.
  it('rejects a malformed connection.url', () => {
    expectCode(
      () => validateOptions({ connection: { url: 'http://not-redis' } }),
      CACHE_ERROR_CODES.CONNECTION_FAILED
    )
  })

  // SECURITY: a malformed URL can embed credentials (`user:pass@host`); the wrapped
  // error must carry only a static reason, never the URL, so secrets never reach
  // the serialized response body. Pins the no-credential-echo invariant.
  it('omits the credential-bearing URL from the malformed-url error details', () => {
    let thrown: CacheException | undefined
    try {
      validateOptions({ connection: { url: 'http://user:s3cr3t@redis.example.com:6379' } })
    } catch (error) {
      thrown = error as CacheException
    }

    expect(thrown?.code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
    expect(thrown?.details).toEqual({ reason: 'invalid connection.url' })
    expect(JSON.stringify(thrown?.details)).not.toContain('s3cr3t')
  })

  // Standalone mode with no connection block at all must throw CONNECTION_FAILED
  // — fail fast at forRoot rather than at first command. Pins the `details`
  // payload so the throw site's object/string mutants are caught.
  it('rejects standalone mode with no connection', () => {
    expectCode(() => validateOptions({}), CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'missing connection.url or connection.host'
    })
  })

  // Standalone mode with a connection block missing both url and host must throw
  // — an empty connection object is not enough to reach a server.
  it('rejects standalone mode with neither url nor host', () => {
    expectCode(() => validateOptions({ connection: {} }), CACHE_ERROR_CODES.CONNECTION_FAILED)
  })

  // Sentinel mode without a sentinel block must throw SENTINEL_MISCONFIGURED,
  // carrying the offending mode in `details` (pins the throw-site object/string).
  it('rejects sentinel mode with no sentinel block', () => {
    expectCode(
      () => validateOptions({ mode: 'sentinel' }),
      CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED,
      {
        mode: 'sentinel'
      }
    )
  })

  // Sentinel mode with a name but no sentinels list must throw — the empty/
  // undefined `sentinels?.length` branch.
  it('rejects sentinel mode with a name but no sentinels', () => {
    expectCode(
      () => validateOptions({ mode: 'sentinel', sentinel: { name: 'x' } as never }),
      CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED
    )
  })

  // Sentinel mode with sentinels but no name must throw — the `!name` branch.
  it('rejects sentinel mode with sentinels but no name', () => {
    expectCode(
      () =>
        validateOptions({
          mode: 'sentinel',
          sentinel: { sentinels: [{ host: 's', port: 26379 }] } as never
        }),
      CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED
    )
  })

  // A fully-specified sentinel block satisfies the invariant and must not throw.
  it('accepts a fully-specified sentinel block', () => {
    expect(() =>
      validateOptions({
        mode: 'sentinel',
        sentinel: { name: 'mymaster', sentinels: [{ host: 's', port: 26379 }] }
      })
    ).not.toThrow()
  })

  // Cluster mode without a cluster block must throw CLUSTER_MISCONFIGURED,
  // carrying the offending mode in `details` (pins the throw-site object/string).
  it('rejects cluster mode with no cluster block', () => {
    expectCode(
      () => validateOptions({ mode: 'cluster' }),
      CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED,
      {
        mode: 'cluster'
      }
    )
  })

  // Cluster mode with an empty nodes array must throw — the `nodes?.length`
  // branch (block present, but no seed nodes).
  it('rejects cluster mode with empty nodes', () => {
    expectCode(
      () => validateOptions({ mode: 'cluster', cluster: { nodes: [] } }),
      CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED
    )
  })

  // Cluster mode with a block but `nodes` UNDEFINED must still throw
  // CLUSTER_MISCONFIGURED, not a TypeError. Pins the `nodes?.length` optional
  // chain: dropping the `?.` would dereference `undefined.length` and crash.
  it('rejects cluster mode with an undefined nodes list', () => {
    expectCode(
      () => validateOptions({ mode: 'cluster', cluster: {} as never }),
      CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED
    )
  })

  // A cluster block with at least one seed node satisfies the invariant.
  it('accepts a cluster block with seed nodes', () => {
    expect(() =>
      validateOptions({ mode: 'cluster', cluster: { nodes: [{ host: 'c', port: 6379 }] } })
    ).not.toThrow()
  })

  // A malformed connection.url is refused in every mode with the structured error and no URL: a raw
  // parse error carries the whole URL in an enumerable `input`, credentials included.
  it.each([
    ['standalone', { connection: { host: 'h', url: 'redis://u:p@ss@@:bad' } }],
    [
      'sentinel',
      {
        mode: 'sentinel',
        sentinel: { name: 'm', sentinels: [{ host: 's', port: 26379 }] },
        connection: { url: 'redis://u:p@ss@@:bad' }
      }
    ],
    [
      'cluster',
      {
        mode: 'cluster',
        cluster: { nodes: [{ host: 'n', port: 6379 }] },
        connection: { url: 'redis://u:p@ss@@:bad' }
      }
    ]
  ] as [string, BymaxCacheModuleOptions][])(
    'refuses a malformed connection.url in %s mode without echoing it',
    (_mode, options) => {
      let thrown: unknown
      try {
        validateOptions(options)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(CacheException)
      expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
      expect((thrown as CacheException).details).toEqual({ reason: 'invalid connection.url' })
      expect(JSON.stringify(thrown)).not.toContain('p@ss')
      expect(inspect(thrown, { depth: 5 })).not.toContain('p@ss')
    }
  )

  // Cluster mode builds its client from `cluster`, so `connection.*` credentials and TLS never reach
  // it. Refusing them at boot, with the place to set each, stops a deployer from believing a password
  // or TLS is configured when it is not.
  it.each([
    ['password', 'secret', 'cluster.options.redisOptions.password', 'a string'],
    ['username', 'user', 'cluster.options.redisOptions.username', 'a string'],
    ['tls', {}, 'cluster.options.redisOptions.tls', 'an object'],
    ['lazyConnect', true, 'cluster.options.lazyConnect', 'a boolean']
  ] as [string, unknown, string, string][])(
    'refuses connection.%s in cluster mode and names where to set it',
    (option, value, target, received) => {
      let thrown: unknown
      try {
        validateOptions({
          mode: 'cluster',
          cluster: { nodes: [{ host: 'n', port: 6379 }] },
          connection: { host: 'h', [option]: value }
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(CacheException)
      expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect((thrown as CacheException).details).toEqual({
        reason: `connection.${option} is ignored in cluster mode; set ${target}`,
        option: `connection.${option}`,
        received
      })
      expect(JSON.stringify(thrown)).not.toContain('secret')
    }
  )

  // In cluster mode the timers live in cluster.options.redisOptions; they get the same rule as the
  // standalone ones, or NaN and 2^31 would still fire at once.
  it.each([
    ['connectTimeout', NaN],
    ['connectTimeout', 2 ** 31],
    ['connectTimeout', 50],
    ['commandTimeout', NaN],
    ['commandTimeout', 2 ** 31],
    ['commandTimeout', 0]
  ])('refuses cluster.options.redisOptions.%s of %p', (field, value) => {
    let thrown: unknown
    try {
      validateOptions({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: 'n', port: 6379 }],
          options: { redisOptions: { [field]: value } }
        }
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheException)
    expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    const option = `cluster.options.redisOptions.${field}`
    const problem =
      typeof value === 'number' && Number.isInteger(value) && value < 2 ** 31
        ? 'too low'
        : 'not a valid timer delay'
    expect((thrown as CacheException).details).toMatchObject({
      received: shown(value),
      reason: `${option} ${problem}`,
      option
    })
  })

  // The valid cluster settings still pass.
  it('accepts a cluster with valid redisOptions timers and no connection block', () => {
    expect(() =>
      validateOptions({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: 'n', port: 6379 }],
          options: { redisOptions: { connectTimeout: 2_000, commandTimeout: 1, password: 'p' } }
        }
      })
    ).not.toThrow()
  })

  // A shutdown timeout below the minimum must throw INVALID_OPTIONS — too short
  // a window risks killing in-flight commands. Pins the `{ reason, option, received, min }`
  // details payload.
  it('rejects a shutdown timeout below the minimum', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, shutdownTimeoutMs: 50 }),
      CACHE_ERROR_CODES.INVALID_OPTIONS,
      {
        reason: 'shutdownTimeoutMs too low',
        option: 'shutdownTimeoutMs',
        received: 50,
        min: MIN_SHUTDOWN_TIMEOUT_MS
      }
    )
  })

  // A shutdown timeout EXACTLY at the minimum must NOT throw — pins the `<`
  // boundary so a `<=` mutant (which would reject the minimum) is caught.
  it('accepts a shutdown timeout exactly at the minimum', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h' }, shutdownTimeoutMs: MIN_SHUTDOWN_TIMEOUT_MS })
    ).not.toThrow()
  })

  // A connect timeout below the minimum must throw — exercises the
  // `connectTimeout !== undefined && connectTimeout < MIN` guard's true branch.
  // Pins the `{ reason, option, received, min }` details payload.
  it('rejects a connect timeout below the minimum', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h', connectTimeout: 50 } }),
      CACHE_ERROR_CODES.INVALID_OPTIONS,
      {
        reason: 'connection.connectTimeout too low',
        option: 'connection.connectTimeout',
        received: 50,
        min: MIN_CONNECT_TIMEOUT_MS
      }
    )
  })

  // A connect timeout EXACTLY at the minimum must NOT throw — pins the `<`
  // boundary so a `<=` mutant (which would reject the minimum) is caught.
  it('accepts a connect timeout exactly at the minimum', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h', connectTimeout: MIN_CONNECT_TIMEOUT_MS } })
    ).not.toThrow()
  })

  // setTimeout stores a delay above 2^31-1 ms as 1 ms and NaN as 1 ms, so a shutdown or connect
  // timeout outside the finite-integer range would fire at once instead of waiting.
  it.each([
    ['shutdownTimeoutMs', NaN],
    ['shutdownTimeoutMs', 2 ** 31],
    ['shutdownTimeoutMs', Infinity],
    ['shutdownTimeoutMs', 150.5],
    ['connectTimeout', NaN],
    ['connectTimeout', 2 ** 31],
    ['connectTimeout', Infinity],
    ['connectTimeout', 150.5],
    ['commandTimeout', NaN],
    ['commandTimeout', 2 ** 31],
    ['commandTimeout', Infinity],
    ['commandTimeout', 150.5]
  ])('rejects %s of %p as not a valid timer delay', (field, value) => {
    const options =
      field === 'shutdownTimeoutMs'
        ? { connection: { host: 'h' }, shutdownTimeoutMs: value }
        : { connection: { host: 'h', [field]: value } }
    const option = field === 'shutdownTimeoutMs' ? field : `connection.${field}`
    expectCode(() => validateOptions(options), CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: `${option} not a valid timer delay`,
      option,
      received: shown(value),
      max: MAX_TIMER_DELAY_MS
    })
  })

  // The largest delay setTimeout honours is accepted — pins the `>` boundary.
  it('accepts a timer delay of exactly 2^31-1', () => {
    expect(() =>
      validateOptions({
        connection: { host: 'h', connectTimeout: 2 ** 31 - 1, commandTimeout: 2 ** 31 - 1 },
        shutdownTimeoutMs: 2 ** 31 - 1
      })
    ).not.toThrow()
  })

  // A command timeout of 0 or below would time every command out at once; 1 ms is the smallest
  // delay that waits at all.
  it.each([0, -5])('rejects a command timeout of %p as too low', (value) => {
    expectCode(
      () => validateOptions({ connection: { host: 'h', commandTimeout: value } }),
      CACHE_ERROR_CODES.INVALID_OPTIONS,
      {
        reason: 'connection.commandTimeout too low',
        option: 'connection.commandTimeout',
        received: value,
        min: MIN_COMMAND_TIMEOUT_MS
      }
    )
  })

  it('accepts a command timeout of exactly 1 ms', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h', commandTimeout: MIN_COMMAND_TIMEOUT_MS } })
    ).not.toThrow()
  })

  // A connect timeout at or above the minimum must pass — the false branch of
  // the same guard (defined but valid).
  it('accepts a connect timeout at or above the minimum', () => {
    expect(() => validateOptions({ connection: { host: 'h', connectTimeout: 200 } })).not.toThrow()
  })
})

describe('applyDefaults', () => {
  // With only a connection supplied, every defaulted field must take its library
  // default and the result must be frozen (immutable once registered).
  it('fills every defaulted field and freezes the result', () => {
    const resolved = applyDefaults({ connection: { host: 'h' } })

    expect(resolved.namespace).toBe(DEFAULT_NAMESPACE)
    expect(resolved.keySeparator).toBe(DEFAULT_KEY_SEPARATOR)
    expect(resolved.shutdownTimeoutMs).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS)
    expect(resolved.keyEscaping).toBe('legacy')
    expect(resolved.allowFlushInProduction).toBe(false)
    expect(resolved.isGlobal).toBe(true)
    expect(resolved.mode).toBe('standalone')
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  // A fully-specified options object must have every override carried through
  // unchanged — covering the non-default side of every `??` and every optional
  // pass-through field (connection/sentinel/cluster/serializer/events/scripts).
  it('carries every supplied override through unchanged', () => {
    const serializer: ISerializer = {
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => JSON.parse(raw)
    }
    const events = { onEvent: jest.fn() }
    const scripts = [{ name: 'incr', lua: 'return 1' }]
    const sentinel = { name: 'mymaster', sentinels: [{ host: 's', port: 26379 }] }
    const cluster = { nodes: [{ host: 'c', port: 6379 }] }
    const connection = { host: 'h', port: 6380 }
    const options: BymaxCacheModuleOptions = {
      mode: 'sentinel',
      connection,
      sentinel,
      cluster,
      namespace: 'tenant-42',
      keySeparator: '|',
      serializer,
      events,
      shutdownTimeoutMs: 9000,
      allowFlushInProduction: true,
      isGlobal: false,
      scripts
    }

    const resolved = applyDefaults(options)

    expect(resolved.mode).toBe('sentinel')
    expect(resolved.connection).toBe(connection)
    expect(resolved.sentinel).toBe(sentinel)
    expect(resolved.cluster).toBe(cluster)
    expect(resolved.namespace).toBe('tenant-42')
    expect(resolved.keySeparator).toBe('|')
    expect(resolved.serializer).toBe(serializer)
    expect(resolved.events).toBe(events)
    expect(resolved.shutdownTimeoutMs).toBe(9000)
    expect(resolved.allowFlushInProduction).toBe(true)
    expect(resolved.isGlobal).toBe(false)
    expect(resolved.scripts).toBe(scripts)
  })
})

describe('applyDefaults — credential containment', () => {
  const SECRET = 'r3d1sPassw0rd-canary'

  /** Serializes the way a structured logger does: tolerant of cycles. */
  function safeStringify(value: unknown): string {
    const seen = new WeakSet()
    return JSON.stringify(value, (_key: string, val: unknown): unknown => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    })
  }

  it('keeps every connection shape out of the paths that serialize the options', () => {
    // The resolved options are injected into ConnectionManager, PubSubService and
    // CacheService, so whatever serializes one of them reaches this object: a
    // logger rendering its arguments, an error reporter capturing the scope of a
    // throw, an object spread. A `url` carries the password inline, which is why
    // the connection shapes are the fields that have to be withheld. `showHidden`
    // is asserted because it is what defeats a merely non-enumerable property.
    const resolved = applyDefaults({
      connection: { url: `redis://default:${SECRET}@127.0.0.1:6379` }
    })

    expect(safeStringify(resolved)).not.toContain(SECRET)
    expect(safeStringify({ ...resolved })).not.toContain(SECRET)
    expect(inspect(resolved, { depth: null })).not.toContain(SECRET)
    expect(inspect(resolved, { depth: null, showHidden: true })).not.toContain(SECRET)
    expect(Object.keys(resolved)).not.toContain('connection')
    expect(Object.keys(resolved)).not.toContain('sentinel')
    expect(Object.keys(resolved)).not.toContain('cluster')
  })

  it('still exposes the connection to the manager that has to dial Redis', () => {
    // Containment must cost nothing at the supported surface: ConnectionManager
    // reads these to build the driver options.
    const connection = { url: 'redis://localhost:6379' }
    const resolved = applyDefaults({ connection })

    expect(resolved.connection).toBe(connection)
    expect(resolved.mode).toBe('standalone')
  })
})
