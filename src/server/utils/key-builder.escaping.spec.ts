/**
 * Unit tests for the injective key escaping of {@link KeyBuilder}.
 *
 * Layer: server. The invariant under test is that no two distinct `(prefix, id)` tuples compose
 * one Redis key, including at the wire, where a lone surrogate would otherwise be replaced by
 * U+FFFD and make two different parts collide. The proof is an exhaustive enumeration over a small
 * alphabet that contains every character class the escape treats specially, not a sample.
 */
import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from './key-builder'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/** Builds a KeyBuilder from resolved defaults, overriding only what a test cares about. */
const makeBuilder = (overrides: Partial<BymaxCacheModuleOptions> = {}): KeyBuilder =>
  new KeyBuilder(applyDefaults({ connection: { host: 'h' }, ...overrides }))

/** Builds a strict-mode KeyBuilder. */
const makeStrict = (overrides: Partial<BymaxCacheModuleOptions> = {}): KeyBuilder =>
  makeBuilder({ keyEscaping: 'strict', ...overrides })

/**
 * Every character class the escape treats specially, plus neutral ones: the default separator, the
 * escape character, an escape-looking sequence, a glob metacharacter, an unpaired high surrogate,
 * an unpaired low surrogate, an astral pair that shares its high unit with the astral separator
 * below, and the astral separator itself.
 */
const ALPHABET: readonly string[] = [
  'a',
  ':',
  '%',
  '%3A',
  '*',
  '|',
  '\uD800',
  '\uDC00',
  '\uD83D',
  '\u{1F601}',
  '\u{1F600}'
]

/** Every non-empty string of one or two alphabet members. */
const PARTS: readonly string[] = (() => {
  const parts = new Set<string>()
  for (const first of ALPHABET) {
    parts.add(first)
    for (const second of ALPHABET) {
      parts.add(first + second)
    }
  }
  return [...parts]
})()

describe('KeyBuilder key escaping', () => {
  describe('keyEscaping: legacy (the default)', () => {
    // The default composes the plain join: a host that sets nothing gets the keys it already has.
    it('composes the unescaped key by default', () => {
      const builder = makeBuilder()

      expect(builder.build('a', 'b:c')).toBe('app:a:b:c')
    })

    // The plain join is ambiguous, and the default mode must not pretend otherwise: this is why
    // strict exists.
    it('still collides under legacy, which is why strict exists', () => {
      const builder = makeBuilder()

      expect(builder.build('a', 'b:c')).toBe(builder.build('a:b', 'c'))
    })

    // buildLegacy is the plain join on demand, whatever the mode, so a key written without escaping
    // can still be addressed.
    it('buildLegacy composes the unescaped key', () => {
      expect(makeBuilder().buildLegacy('a:b', 'c')).toBe('app:a:b:c')
    })

    // parse cannot invert an ambiguous composition, so under legacy it declines instead of guessing.
    it('parse returns null under legacy', () => {
      expect(makeBuilder().parse('app:a:b')).toBeNull()
    })

    // buildPattern under legacy is the old composition, so scan and keys behave as before.
    it('buildPattern composes the unescaped pattern', () => {
      expect(makeBuilder().buildPattern('u*', 'a:*')).toBe('app:u*:a:*')
    })
  })

  describe('a pattern under strict escaping', () => {
    // Every separator character is escaped in a stored id, so a pattern holding one names a key that
    // cannot exist. Returning nothing for it would be a silent no-op, so it is refused.
    it.each([
      [':', 'u1:*'],
      ['|', 'a|b'],
      ['aa', 'xax*'],
      ['\u{1F600}', '*\u{1F600}'],
      ['\u{1F600}', '*\u{1F601}']
    ])('refuses a pattern holding a character of the separator %j: %j', (separator, pattern) => {
      const builder = makeStrict({ keySeparator: separator })
      let caught: unknown
      try {
        builder.buildPattern('sessions', pattern)
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
      expect((caught as CacheException).details).toEqual({ reason: 'pattern_contains_separator' })
      expect((caught as CacheException).message).toContain('separator')
    })

    // Legacy composes the pattern as given, and that pattern matches there: it is not refused.
    it('accepts a pattern holding the separator under legacy', () => {
      expect(makeBuilder().buildPattern('sessions', 'u1:*')).toBe('app:sessions:u1:*')
    })

    // A pattern with no separator character is a glob over the escaped id and passes through.
    it('passes a pattern with no separator character through', () => {
      expect(makeStrict().buildPattern('sessions', 'u1%3A*')).toBe('app:sessions:u1%3A*')
    })
  })

  describe('idPrefixPattern', () => {
    // The id the documented composite convention stores: each field escaped, joined with the
    // separator, then escaped again by build().
    const storedId = (builder: KeyBuilder, fields: readonly string[]): string =>
      builder
        .build('sessions', fields.map((field) => builder.escapePart(field)).join(':'))
        .slice('app:sessions:'.length)

    // Under strict the pattern is the escaped leading fields plus the escaped separator and one
    // trailing wildcard, so the first field cannot run into a longer one.
    it('builds the escaped leading fields, the escaped separator and a trailing wildcard', () => {
      const builder = makeStrict()

      expect(builder.idPrefixPattern(['u1'])).toBe('u1%3A*')
      expect(builder.idPrefixPattern(['a:b', 'c'])).toBe('a%253Ab%3Ac%3A*')
      expect(builder.idPrefixPattern(['u*'])).toBe('u%252A%3A*')
    })

    // Legacy stores the id as joined, so the pattern is the plain glob that works there.
    it('builds the plain glob under legacy', () => {
      expect(makeBuilder().idPrefixPattern(['u1'])).toBe('u1:*')
      expect(makeBuilder().idPrefixPattern(['a', 'b'])).toBe('a:b:*')
    })

    // The pattern matches every id that starts with its fields and none that merely resembles them:
    // longer fields, and the neighbours whose escaped characters begin like the field.
    it.each([
      [
        'u1',
        [
          ['u1', 's1'],
          ['u1', 's2'],
          ['u1', 'a:b']
        ],
        [
          ['u10', 's1'],
          ['u1%', 's1'],
          ['u1*', 's1'],
          ['u1:', 's1'],
          ['u', 's1']
        ]
      ],
      [
        'a:b',
        [['a:b', 's1']],
        [
          ['a', 'b:s1'],
          ['a:bc', 's1'],
          ['a%3Ab', 's1']
        ]
      ],
      [
        '%',
        [['%', 's1']],
        [
          ['%25', 's1'],
          ['', 'x'],
          ['%%', 's1']
        ]
      ],
      [
        '*',
        [['*', 's1']],
        [
          ['x', 's1'],
          ['**', 's1'],
          ['*x', 's1']
        ]
      ],
      [
        '\uD800',
        [['\uD800', 's1']],
        [
          ['\uD800\uD800', 's1'],
          ['\uDC00', 's1']
        ]
      ]
    ])('matches the ids of owner %j and not its neighbours', (owner, owned, neighbours) => {
      const builder = makeStrict()
      const pattern = builder.idPrefixPattern([owner])
      const literal = pattern.slice(0, -1)

      expect(pattern.endsWith('*')).toBe(true)
      expect(literal).not.toContain('*')
      for (const fields of owned) {
        expect(storedId(builder, fields).startsWith(literal)).toBe(true)
      }
      for (const fields of neighbours.filter((fields) => fields[0] !== '')) {
        expect(storedId(builder, fields).startsWith(literal)).toBe(false)
      }
    })

    // No field, or an empty one, names no key.
    it.each([
      [[] as string[], 'empty_segments'],
      [['u1', ''], 'empty_id']
    ])('refuses %j (%s)', (segments, reason) => {
      let caught: unknown
      try {
        makeStrict().idPrefixPattern(segments)
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
      expect((caught as CacheException).details).toEqual({ reason })
    })
  })

  describe('keyEscaping: strict', () => {
    // A part with no separator, no escape character and no glob metacharacter keeps its bytes, which
    // is why most keys do not change when a host turns strict on.
    it('leaves a plain key byte-identical to the legacy one', () => {
      const builder = makeStrict()

      expect(builder.build('users', 'u_1')).toBe('app:users:u_1')
      expect(builder.build('users', 'u_1')).toBe(builder.buildLegacy('users', 'u_1'))
    })

    // Distinct tuples stay distinct: the two the plain join merges resolve to two keys.
    it('separates the tuples the legacy composition merged', () => {
      const builder = makeStrict()

      expect(builder.build('a', 'b:c')).toBe('app:a:b%3Ac')
      expect(builder.build('a:b', 'c')).toBe('app:a%3Ab:c')
    })

    // A part the caller already percent-encoded gets a second layer, which is what keeps the
    // composition injective whatever the caller did before.
    it('escapes the escape character itself', () => {
      expect(makeStrict().build('p', 'a%3Ab')).toBe('app:p:a%253Ab')
    })

    // Only the prefix is escaped for glob metacharacters: it is a literal naming a group, while an
    // id is stored verbatim and a pattern is meant to be a glob.
    it('escapes glob metacharacters in the prefix and not in the id', () => {
      const builder = makeStrict()

      expect(builder.build('u*', 'a*')).toBe('app:u%2A:a*')
      expect(builder.build('[x]?\\', 'i')).toBe('app:%5Bx]%3F%5C:i')
    })

    // keys() and scan() hand a glob in the id position; escaping it would turn every pattern into a
    // literal, so buildPattern escapes the prefix and leaves the pattern alone.
    it('buildPattern escapes the prefix and passes the pattern through', () => {
      const builder = makeStrict()

      expect(builder.buildPattern('u*', 'a%3A*')).toBe('app:u%2A:a%3A*')
      expect(builder.buildPattern('users', '*')).toBe('app:users:*')
    })

    // The same non-empty guards hold on every composing method.
    it.each([
      ['build', (b: KeyBuilder) => b.build('', 'i'), 'empty_prefix'],
      ['build', (b: KeyBuilder) => b.build('p', ''), 'empty_id'],
      ['buildLegacy', (b: KeyBuilder) => b.buildLegacy('', 'i'), 'empty_prefix'],
      ['buildLegacy', (b: KeyBuilder) => b.buildLegacy('p', ''), 'empty_id'],
      ['buildPattern', (b: KeyBuilder) => b.buildPattern('', '*'), 'empty_prefix'],
      ['buildPattern', (b: KeyBuilder) => b.buildPattern('p', ''), 'empty_id']
    ])('%s rejects an empty part (%#)', (_name, call, reason) => {
      const builder = makeStrict()
      let caught: unknown
      try {
        call(builder)
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
      expect((caught as CacheException).details).toEqual({ reason })
    })

    // Each of these separators exercises a distinct risk: the default, a different single character,
    // a multi-character one that can straddle a field boundary, and an astral one made of two code
    // units that another astral character partly shares.
    // The last four are separators whose characters also occur inside an escape token (a hex digit,
    // `u`, and a run of two digits): the boundary must be found by skipping whole tokens.
    describe.each([':', '|', 'aa', '\u{1F600}', '2', 'u', 'A', '25'])(
      'separator %j',
      (separator) => {
        // The load-bearing property. Exhaustive over every tuple of the alphabet, so a counterexample
        // cannot hide in an unsampled corner.
        it('composes no two distinct tuples to one key, and the key survives the wire', () => {
          const builder = makeStrict({ keySeparator: separator })
          const seen = new Map<string, string>()

          for (const prefix of PARTS) {
            for (const id of PARTS) {
              const key = builder.build(prefix, id)
              const tuple = JSON.stringify([prefix, id])
              const previous = seen.get(key)

              expect(previous === undefined || previous === tuple).toBe(true)
              seen.set(key, tuple)
              // ioredis writes a key as UTF-8, where an unpaired surrogate becomes U+FFFD. A key that
              // does not survive that round trip would collide at the server whatever the string says.
              expect(Buffer.from(key, 'utf8').toString('utf8')).toBe(key)
            }
          }
          expect(seen.size).toBe(PARTS.length * PARTS.length)
        })

        // The decoder inverts the composition for every tuple, lone surrogates included.
        it('parse returns the exact tuple for every composed key', () => {
          const builder = makeStrict({ keySeparator: separator })

          for (const prefix of PARTS) {
            for (const id of PARTS) {
              expect(builder.parse(builder.build(prefix, id))).toEqual({ prefix, id })
            }
          }
        })

        // escapePart and unescapePart are inverses on their own, which is what a host composing a
        // multi-field id relies on.
        it('unescapePart inverts escapePart for every part', () => {
          const builder = makeStrict({ keySeparator: separator })

          for (const part of PARTS) {
            expect(builder.unescapePart(builder.escapePart(part))).toBe(part)
          }
        })

        // Outside its tokens an escaped part never carries the separator, which is what makes the join
        // unambiguous. A separator that is itself a hex digit appears inside tokens, and only there.
        it('escapePart output holds no separator outside a token', () => {
          const builder = makeStrict({ keySeparator: separator })

          for (const part of PARTS) {
            const outsideTokens = builder
              .escapePart(part)
              .replace(/%(?:[0-9A-F]{2}|u[0-9A-F]{4})/g, '')
            expect(outsideTokens.includes(separator)).toBe(false)
          }
        })
      }
    )

    // The concrete shapes of the escape, so a change to the token format is a deliberate change.
    it('escapes ASCII as %XX and anything else as %uXXXX per code unit', () => {
      const builder = makeStrict({ keySeparator: '\u{1F600}' })

      expect(makeStrict().escapePart('a:b%c')).toBe('a%3Ab%25c')
      expect(makeStrict().escapePart('\uD800')).toBe('%uD800')
      expect(makeStrict().escapePart('\uDC00')).toBe('%uDC00')
      expect(builder.escapePart('x\u{1F600}y')).toBe('x%uD83D%uDE00y')
      // A different astral character that shares the separator's high unit is escaped whole, never
      // left half-escaped with an unpaired low unit on the wire.
      expect(builder.escapePart('\u{1F601}')).toBe('%uD83D%uDE01')
    })

    // escapePart is safe in any position, so it escapes glob metacharacters too.
    it('escapePart escapes glob metacharacters', () => {
      expect(makeStrict().escapePart('*?[]\\')).toBe('%2A%3F%5B]%5C')
    })

    // A separator that is a character of the escape token, here the `2` of `%25`, must not make parse
    // cut inside a token.
    it('parse does not cut inside an escape token', () => {
      const builder = makeStrict({ keySeparator: '2' })

      expect(builder.build('p', '%')).toBe('app2p2%25')
      expect(builder.parse('app2p2%25')).toEqual({ prefix: 'p', id: '%' })
      expect(builder.parse('app2%25p2x')).toEqual({ prefix: '%p', id: 'x' })
    })

    // escapePart joins fields safely only when the escape character cannot reappear as the separator.
    // Legacy mode accepts a `%` separator at registration, so the helper refuses it instead.
    it('escapePart rejects a separator that contains the escape character', () => {
      const builder = makeBuilder({ keySeparator: '%' })
      let caught: unknown
      try {
        builder.escapePart('a')
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_NAMESPACE)
      expect((caught as CacheException).details).toEqual({
        reason: 'key separator contains the escape character',
        separator: '%'
      })
    })

    // The refusal's message names the rule, since that is all a host reads when it is thrown.
    it('escapePart names the percent-separator rule in its error message', () => {
      const builder = makeBuilder({ keySeparator: '%' })
      let caught: unknown
      try {
        builder.escapePart('a')
      } catch (error) {
        caught = error
      }

      expect((caught as Error).message).toContain(
        "a separator containing '%' is rejected under keyEscaping 'strict'"
      )
    })

    // A malformed or foreign part must decline, never decode to something the escape did not write.
    it.each(['a%', '%zz', '%u12', '%u12G4', '%FF', '%3a', '%u00e9', 'a%2'])(
      'unescapePart returns null for %j',
      (part) => {
        expect(makeStrict().unescapePart(part)).toBeNull()
      }
    )

    // A token in canonical form decodes whatever it names.
    it('unescapePart decodes the tokens the escape writes', () => {
      expect(makeStrict().unescapePart('a%3Ab%25c%uD800')).toBe('a:b%c\uD800')
    })

    // parse takes only a key this builder could have written.
    it.each([
      ['a different namespace', 'other:p:i'],
      ['no id', 'app:p'],
      ['no prefix', 'app::i'],
      ['an empty id', 'app:p:'],
      ['an extra separator', 'app:p:i:j'],
      ['the namespace alone', 'app:'],
      ['a malformed prefix escape', 'app:p%:i'],
      ['a malformed id escape', 'app:p:i%zz'],
      ['a short token naming a non-ASCII unit in the prefix', 'app:%80:i'],
      ['a short token naming a non-ASCII unit in the id', 'app:p:%80']
    ])('parse returns null for %s', (_name, key) => {
      expect(makeStrict().parse(key)).toBeNull()
    })

    // The namespace itself is not decoded: it is validated configuration, never caller input.
    it('parse honours a custom namespace', () => {
      const builder = makeStrict({ namespace: 'tenant-42' })

      expect(builder.parse('tenant-42:users:u_1')).toEqual({ prefix: 'users', id: 'u_1' })
    })
  })
})
