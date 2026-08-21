import { CACHE_ERROR_CODES } from '../../server/errors/cache-error-codes'
import { CacheException } from '../../server/errors/cache.exception'
import { findScope, isKeyInScope, readScopePattern, validateScopes } from './validate-scopes'

import type { CacheScope } from '../interfaces/cache-scope.interface'

/** A valid scope, cloned and overridden per test so each case varies one field. */
const scope = (overrides: Partial<CacheScope> = {}): CacheScope => ({
  id: 'cache',
  label: 'Application cache',
  pattern: 'app:*',
  isReadable: true,
  origin: 'the application namespace, written through the typed API',
  ...overrides
})

/**
 * Asserts a thrown CacheException carries the expected code and, when supplied,
 * the exact `details` payload — pinning `details` kills mutants that blank the
 * throw site's object or its string literals.
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

describe('validateScopes', () => {
  // The happy path: two well-formed scopes survive validation and come back in
  // declaration order, which is the order an operator-facing surface offers.
  it('accepts well-formed scopes and preserves declaration order', () => {
    const result = validateScopes([scope(), scope({ id: 'auth', pattern: 'auth:*' })])
    expect(result.map((entry) => entry.id)).toEqual(['cache', 'auth'])
  })

  // A pattern must be a literal prefix with at most a single trailing `*`.
  // Anything else — a leading metacharacter, a mid-pattern one, a character
  // class — is refused at wiring, because membership of a caller-supplied key
  // could then only be decided by reimplementing Redis's matcher, and a matcher
  // that is more permissive than the server's leaks across scopes.
  it.each([['*'], ['*:*'], ['?x'], ['[a]b'], ['\\a'], ['a*b'], ['a?'], ['a[bc]'], ['a**']])(
    'rejects the pattern %s',
    (pattern) => {
      expectCode(() => validateScopes([scope({ pattern })]), CACHE_ERROR_CODES.INVALID_SCOPE, {
        reason: 'pattern must be a literal prefix optionally followed by *',
        scopeId: 'cache',
        pattern
      })
    }
  )

  // One literal character before the `*` is enough. The library cannot judge
  // whether a prefix is narrow ENOUGH for a deployment, only that the pattern
  // resolves to a decidable region.
  it('accepts a pattern anchored by a single literal character', () => {
    expect(() => validateScopes([scope({ pattern: 'a*' })])).not.toThrow()
  })

  // A pattern with no `*` at all is an exact key, which is decidable by
  // definition and must not be mistaken for a malformed one.
  it('accepts a pattern with no trailing star at all', () => {
    expect(() => validateScopes([scope({ pattern: 'app:config' })])).not.toThrow()
  })

  // Both scopes this design was drawn from must pass, or the rule is too narrow
  // to ship.
  it.each([['community-core:*'], ['auth:*']])('accepts the real-world pattern %s', (pattern) => {
    expect(() => validateScopes([scope({ pattern })])).not.toThrow()
  })

  // Duplicate ids make lookup ambiguous: one declaration would silently shadow
  // the other, and which one wins is an ordering accident.
  it('rejects duplicate scope ids', () => {
    expectCode(
      () => validateScopes([scope(), scope({ pattern: 'other:*' })]),
      CACHE_ERROR_CODES.INVALID_SCOPE,
      { reason: 'duplicate scope id', scopeId: 'cache' }
    )
  })

  // Every text field is required. `origin` included: it exists to be shown to an
  // operator, and an empty one produces a surface that names a keyspace it cannot
  // explain.
  it.each([['id'], ['label'], ['pattern'], ['origin']])('rejects an empty %s', (field) => {
    expectCode(
      () => validateScopes([scope({ [field]: '' } as Partial<CacheScope>)]),
      CACHE_ERROR_CODES.INVALID_SCOPE,
      { reason: 'empty scope field', field, scopeId: field === 'id' ? '' : 'cache' }
    )
  })

  // An admin module wired with nothing to read is a misconfiguration, and failing
  // at boot beats serving a surface whose picker is empty for a reason nobody can
  // see from the payload.
  it('rejects an empty scope list', () => {
    expectCode(() => validateScopes([]), CACHE_ERROR_CODES.INVALID_SCOPE, {
      reason: 'no scopes declared'
    })
  })

  // The returned list and each scope in it are frozen: the allowlist is decided
  // at wiring and must not be reachable for mutation afterwards, or the
  // authorisation rule becomes editable at runtime by anything holding it.
  it('freezes the returned list and every scope in it', () => {
    const result = validateScopes([scope()])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result[0])).toBe(true)
  })

  // Validation must copy rather than freeze the caller's own objects in place —
  // freezing a consumer-owned array is a side effect on their data.
  it('does not freeze the array the caller passed in', () => {
    const input = [scope()]
    validateScopes(input)
    expect(Object.isFrozen(input)).toBe(false)
  })
})

describe('findScope', () => {
  // Lookup is exact string equality against the frozen list. The caller's input
  // selects a declaration; it never contributes to one.
  it('returns the declaration whose id matches exactly', () => {
    const scopes = validateScopes([scope(), scope({ id: 'auth', pattern: 'auth:*' })])
    expect(findScope(scopes, 'auth').pattern).toBe('auth:*')
  })

  // An unknown id must throw rather than fall back to a default scope: silently
  // serving the first declaration would answer a question nobody asked, against a
  // keyspace the caller did not name.
  it('throws SCOPE_NOT_FOUND for an id no declaration carries', () => {
    const scopes = validateScopes([scope()])
    expectCode(() => findScope(scopes, 'nope'), CACHE_ERROR_CODES.SCOPE_NOT_FOUND, {
      scopeId: 'nope'
    })
  })

  // A near-miss must not resolve — prefix or case variations are different ids,
  // and a lookup that tolerated them would let a caller reach a scope by guessing.
  it.each([['Cache'], ['cach'], ['cache ']])('does not resolve the near-miss id %s', (id) => {
    const scopes = validateScopes([scope()])
    expect(() => findScope(scopes, id)).toThrow(CacheException)
  })
})

describe('readScopePattern', () => {
  // A trailing star means the prefix may be extended; the star itself is not
  // part of what a key must carry.
  it('strips the trailing star from the prefix', () => {
    expect(readScopePattern('auth:*')).toEqual({ prefix: 'auth:', isPrefixMatch: true })
  })

  // Without a star the pattern is the whole key.
  it('keeps an exact pattern whole', () => {
    expect(readScopePattern('app:config')).toEqual({
      prefix: 'app:config',
      isPrefixMatch: false
    })
  })
})

describe('isKeyInScope', () => {
  // The property the whole pattern restriction exists to make decidable: a key
  // from the credential-bearing keyspace must not be readable by naming the
  // application scope.
  it('refuses a key belonging to a different keyspace', () => {
    expect(isKeyInScope('community-core:*', 'auth:sess:1')).toBe(false)
  })

  // The positive half of the membership rule: a key genuinely under the prefix
  // must resolve, or the check would be safe by refusing everything.
  it('accepts a key under the declared prefix', () => {
    expect(isKeyInScope('community-core:*', 'community-core:users:u1')).toBe(true)
  })

  // The prefix itself, with nothing after it, is inside the region — `auth:*`
  // matches `auth:` in Redis too.
  it('accepts the bare prefix', () => {
    expect(isKeyInScope('auth:*', 'auth:')).toBe(true)
  })

  // A key that merely CONTAINS the prefix is not under it. Anchoring at the
  // start is the whole guarantee.
  it('refuses a key that only contains the prefix', () => {
    expect(isKeyInScope('auth:*', 'shadow-auth:sess:1')).toBe(false)
  })

  // A neighbouring keyspace whose name extends the prefix without the separator
  // is a real confusion — `auth:` and `authority:` — and the prefix carries the
  // separator precisely so it cannot happen.
  it('refuses a neighbouring keyspace that extends the prefix text', () => {
    expect(isKeyInScope('auth:*', 'authority:sess:1')).toBe(false)
  })

  // An exact pattern admits exactly one key.
  it('accepts only the exact key for a starless pattern', () => {
    expect(isKeyInScope('app:config', 'app:config')).toBe(true)
    expect(isKeyInScope('app:config', 'app:config:v2')).toBe(false)
  })
})
