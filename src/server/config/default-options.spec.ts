import { DEFAULT_KEY_SEPARATOR, DEFAULT_NAMESPACE } from '../constants/default-namespace'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
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

  // An empty-string namespace must throw INVALID_NAMESPACE — keys would lose
  // their isolation prefix. Pins the `{ namespace }` details payload.
  it('rejects an empty-string namespace', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: '' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { namespace: '' }
    )
  })

  // A whitespace-only namespace must throw — `.trim() === ''` guards against a
  // visually-blank but technically non-empty value.
  it('rejects a whitespace-only namespace', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: '   ' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE
    )
  })

  // A namespace containing the key separator must throw — it would create
  // ambiguous, un-splittable keys. Pins the full `details` (reason + namespace +
  // separator) so the throw-site object and reason string are protected.
  it('rejects a namespace containing the separator', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: 'a:b' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'namespace contains key separator',
        namespace: 'a:b',
        separator: DEFAULT_KEY_SEPARATOR
      }
    )
  })

  // A shutdown timeout below the minimum must throw CONNECTION_FAILED — too short
  // a window risks killing in-flight commands. Pins the `{ reason, value, min }`
  // details payload.
  it('rejects a shutdown timeout below the minimum', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, shutdownTimeoutMs: 50 }),
      CACHE_ERROR_CODES.CONNECTION_FAILED,
      { reason: 'shutdownTimeoutMs too low', value: 50, min: MIN_SHUTDOWN_TIMEOUT_MS }
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
  // Pins the `{ reason, value, min }` details payload.
  it('rejects a connect timeout below the minimum', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h', connectTimeout: 50 } }),
      CACHE_ERROR_CODES.CONNECTION_FAILED,
      { reason: 'connectTimeout too low', value: 50, min: MIN_CONNECT_TIMEOUT_MS }
    )
  })

  // A connect timeout EXACTLY at the minimum must NOT throw — pins the `<`
  // boundary so a `<=` mutant (which would reject the minimum) is caught.
  it('accepts a connect timeout exactly at the minimum', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h', connectTimeout: MIN_CONNECT_TIMEOUT_MS } })
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
