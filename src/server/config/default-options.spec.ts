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

  // keyEscaping accepts exactly its two modes. A typo such as `'Strict'` must not fall through to
  // either mode silently: a host that meant strict would run legacy and never know.
  it('rejects an unknown keyEscaping value naming it', () => {
    expectCode(
      () =>
        validateOptions({
          connection: { host: 'h' },
          keyEscaping: 'Strict' as unknown as 'strict'
        }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { reason: 'unknown keyEscaping', keyEscaping: 'Strict' }
    )
  })

  // Under strict the escape character becomes part of every escaped part, so a separator holding it
  // could reappear inside a part and make the composition ambiguous again.
  it('rejects a separator containing % under strict escaping', () => {
    expectCode(
      () =>
        validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '%' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { reason: 'key separator contains the escape character', separator: '%' }
    )
    expectCode(
      () =>
        validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: 'a%b' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { reason: 'key separator contains the escape character', separator: 'a%b' }
    )
  })

  // A host that meets this refusal at boot sees only the error's message, so the message itself
  // must name the rule, not only the `details` payload.
  it('names the percent-separator rule in the boot error message', () => {
    let caught: unknown
    try {
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '%' })
    } catch (error) {
      caught = error
    }

    expect((caught as Error).message).toContain(
      "a separator containing '%' is rejected under keyEscaping 'strict'"
    )
  })

  // A separator holding a glob character widens every pattern built from it, flushNamespace's
  // included, so strict refuses it at registration, naming the character.
  it.each(['*', '?', '[', '\\', 'a*b'])(
    'rejects the separator %j under strict escaping',
    (separator) => {
      let caught: unknown
      try {
        validateOptions({
          connection: { host: 'h' },
          keyEscaping: 'strict',
          keySeparator: separator
        })
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_NAMESPACE)
      expect((caught as CacheException).details).toEqual({
        reason: 'key separator contains glob metacharacter',
        separator,
        metacharacter: separator.includes('*') ? '*' : separator
      })
      expect((caught as Error).message).toContain('glob metacharacter')
    }
  )

  // An astral character is two surrogate code units. Strict escapes each unit of the separator, so a
  // pattern holding the pair or one half of it cannot be judged exactly: strict refuses such a
  // separator at registration and asks for a BMP one.
  it.each(['\u{1F600}', 'a\u{1F600}', '\u{10FFFF}', '\uD800', 'a\uDE00'])(
    'rejects the surrogate-bearing separator %j under strict escaping',
    (separator) => {
      let caught: unknown
      try {
        validateOptions({
          connection: { host: 'h' },
          keyEscaping: 'strict',
          keySeparator: separator
        })
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_NAMESPACE)
      expect((caught as CacheException).details).toEqual({
        reason: 'key separator contains a surrogate code unit',
        separator
      })
      expect((caught as Error).message).toContain('unpaired surrogate')
    }
  )

  // A BMP separator, accented or not, boots under strict, and legacy keeps booting with an astral one.
  it('accepts a BMP separator under strict escaping and an astral one under legacy', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '\u00A7' })
    ).not.toThrow()
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '\u2603' })
    ).not.toThrow()
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keySeparator: '\u{1F600}' })
    ).not.toThrow()
    expect(() =>
      validateOptions({
        connection: { host: 'h' },
        keyEscaping: 'legacy',
        keySeparator: '\u{1F600}'
      })
    ).not.toThrow()
  })

  // `]` alone is a literal to Redis, as for the namespace, and a plain separator is unaffected.
  it('accepts a separator with ] or none of the glob characters under strict escaping', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: ']' })
    ).not.toThrow()
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '|' })
    ).not.toThrow()
  })

  // Legacy never rewrites a part, so a configuration that boots today keeps booting.
  it('accepts a separator holding a glob character under legacy escaping', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, keySeparator: '*' })).not.toThrow()
  })

  // The same separator boots under legacy: a patch must not start failing a configuration that
  // passes today.
  it('accepts a separator containing % under legacy escaping, explicit or default', () => {
    expect(() => validateOptions({ connection: { host: 'h' }, keySeparator: '%' })).not.toThrow()
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'legacy', keySeparator: '%' })
    ).not.toThrow()
  })

  // Both documented modes are accepted.
  it('accepts both keyEscaping modes', () => {
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict' })
    ).not.toThrow()
    expect(() =>
      validateOptions({ connection: { host: 'h' }, keyEscaping: 'legacy' })
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
    ['password', 'secret', 'cluster.options.redisOptions.password'],
    ['username', 'user', 'cluster.options.redisOptions.username'],
    ['tls', {}, 'cluster.options.redisOptions.tls'],
    ['lazyConnect', true, 'cluster.options.lazyConnect']
  ] as [string, unknown, string][])(
    'refuses connection.%s in cluster mode and names where to set it',
    (option, value, target) => {
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
        option: `connection.${option}`
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
    const reason =
      typeof value === 'number' && Number.isInteger(value) && value < 2 ** 31
        ? `${field} too low`
        : `${field} not a valid timer delay`
    expect((thrown as CacheException).details).toMatchObject({ value, reason })
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
  // a window risks killing in-flight commands. Pins the `{ reason, value, min }`
  // details payload.
  it('rejects a shutdown timeout below the minimum', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, shutdownTimeoutMs: 50 }),
      CACHE_ERROR_CODES.INVALID_OPTIONS,
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
      CACHE_ERROR_CODES.INVALID_OPTIONS,
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
    expectCode(() => validateOptions(options), CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: `${field} not a valid timer delay`,
      value,
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
      { reason: 'commandTimeout too low', value, min: MIN_COMMAND_TIMEOUT_MS }
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
