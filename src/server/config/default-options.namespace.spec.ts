/**
 * Unit tests for the namespace, key separator and key escaping rules of `validateOptions`: each
 * refusal is an `INVALID_NAMESPACE` that names the option and the type received and never the value.
 *
 * Layer: server.
 */
import { DEFAULT_KEY_SEPARATOR } from '../constants/default-namespace'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { validateOptions } from './default-options'

/** Asserts a thrown CacheException carries the expected code and, when given, the exact `details`. */
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

describe('validateOptions — namespace and separator', () => {
  // An empty-string namespace must throw INVALID_NAMESPACE — keys would lose
  // their isolation prefix. The details name the option and the type received, never the value.
  it('rejects an empty-string namespace', () => {
    expectCode(
      () => validateOptions({ connection: { host: 'h' }, namespace: '' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      { reason: 'namespace is empty', option: 'namespace', received: 'a string' }
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
        option: 'namespace',
        received: 'a string'
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
        option: 'namespace',
        received: 'a string',
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
        option: 'namespace',
        received: 'a string',
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
        option: 'namespace',
        received: 'a string',
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
        option: 'namespace',
        received: 'a string',
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
      { reason: 'keySeparator is empty', option: 'keySeparator', received: 'a string' }
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
      {
        reason: 'keyEscaping is unknown',
        option: 'keyEscaping',
        received: 'a string',
        allowed: 'legacy or strict'
      }
    )
  })

  // Under strict the escape character becomes part of every escaped part, so a separator holding it
  // could reappear inside a part and make the composition ambiguous again.
  it('rejects a separator containing % under strict escaping', () => {
    expectCode(
      () =>
        validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: '%' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'keySeparator contains the escape character',
        option: 'keySeparator',
        received: 'a string'
      }
    )
    expectCode(
      () =>
        validateOptions({ connection: { host: 'h' }, keyEscaping: 'strict', keySeparator: 'a%b' }),
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      {
        reason: 'keySeparator contains the escape character',
        option: 'keySeparator',
        received: 'a string'
      }
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
        reason: 'keySeparator contains glob metacharacter',
        option: 'keySeparator',
        received: 'a string',
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
        reason: 'keySeparator contains a surrogate code unit',
        option: 'keySeparator',
        received: 'a string'
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
})
