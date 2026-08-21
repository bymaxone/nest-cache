import { inspect } from 'node:util'

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

  // A namespace containing `*` must throw. Measured against Redis 8.10.0: the
  // namespace is composed into flushNamespace's `{namespace}{sep}*` match
  // pattern, so `ten*ant` matches every other tenant's keys and turns a scoped
  // flush into a cross-tenant delete. Pins `metacharacter` so the reported
  // character cannot drift from the one that was found.
  it('rejects a namespace containing the * glob metacharacter', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: 'ten*ant' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'namespace contains glob metacharacter',
        namespace: 'ten*ant',
        metacharacter: '*'
      }
    )
  })

  // A namespace containing `?` must throw — measured to widen the flush pattern
  // exactly as `*` does, matching one character of any other namespace.
  it('rejects a namespace containing the ? glob metacharacter', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: 'ten?ant' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'namespace contains glob metacharacter',
        namespace: 'ten?ant',
        metacharacter: '?'
      }
    )
  })

  // A namespace containing `[` must throw for the opposite reason: it opens a
  // character class that never closes, so the pattern matches NOTHING and
  // flushNamespace deletes none of the namespace's keys while returning 0 —
  // silent under-deletion reported as success.
  it('rejects a namespace containing the [ glob metacharacter', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: 'ten[ant' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'namespace contains glob metacharacter',
        namespace: 'ten[ant',
        metacharacter: '['
      }
    )
  })

  // A namespace containing `\` must throw — it escapes the next character, so
  // `ten\ant` matches `tenant:*` (a DIFFERENT keyspace) while sparing its own
  // keys. Both halves of that are wrong.
  it('rejects a namespace containing the backslash glob metacharacter', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: 'ten\\ant' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'namespace contains glob metacharacter',
        namespace: 'ten\\ant',
        metacharacter: '\\'
      }
    )
  })

  // `]` must be ACCEPTED. Measured against Redis 8.10.0: unpaired it is a
  // literal and matches only its own keyspace, so rejecting it would be an
  // unfounded restriction. This test exists to keep the guard as narrow as the
  // measurement — an over-broad character set fails here.
  it('accepts a namespace containing an unpaired ] , which Redis treats as a literal', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, namespace: 'ten]ant' })).not.toThrow()
  })

  // An empty key separator must throw with its OWN reason. It was already
  // rejected before this guard existed, but only by coincidence: the next check
  // is `namespace.includes(separator)` and `'anything'.includes('')` is true for
  // every string, so it reported "namespace contains key separator" — something
  // the consumer did not do. Pins the reason to keep the message honest.
  it('rejects an empty key separator naming the separator, not the namespace', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, keySeparator: '' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { reason: 'empty key separator', separator: '' }
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
