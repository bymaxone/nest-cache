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
    // The default must keep every key byte-identical to the previous release; a patch changes none.
    it('composes the unescaped key by default', () => {
      const builder = makeBuilder()

      expect(builder.build('a', 'b:c')).toBe('app:a:b:c')
    })

    // The collision this release exists to fix is still reachable under legacy, and the legacy
    // escape hatch must say so honestly rather than pretend the key is unambiguous.
    it('still collides under legacy, which is why strict exists', () => {
      const builder = makeBuilder()

      expect(builder.build('a', 'b:c')).toBe(builder.build('a:b', 'c'))
    })

    // buildLegacy is the old composition on demand, so a host can read a key an earlier release wrote.
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

  describe('keyEscaping: strict', () => {
    // A part with no separator, no escape character and no glob metacharacter keeps its bytes, which
    // is why most keys do not change when a host turns strict on.
    it('leaves a plain key byte-identical to the legacy one', () => {
      const builder = makeStrict()

      expect(builder.build('users', 'u_1')).toBe('app:users:u_1')
      expect(builder.build('users', 'u_1')).toBe(builder.buildLegacy('users', 'u_1'))
    })

    // The ticket's own collision: the two tuples must resolve to two keys.
    it('separates the tuples the legacy composition merged', () => {
      const builder = makeStrict()

      expect(builder.build('a', 'b:c')).toBe('app:a:b%3Ac')
      expect(builder.build('a:b', 'c')).toBe('app:a%3Ab:c')
    })

    // A host that followed the old advice and encoded each field gets a second layer, which is what
    // keeps the composition injective whatever the caller did before.
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

      expect(builder.buildPattern('u*', 'a:*')).toBe('app:u%2A:a:*')
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
    describe.each([':', '|', 'aa', '\u{1F600}'])('separator %j', (separator) => {
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

      // An escaped part never carries a separator code unit, which is what makes the join unambiguous.
      it('escapePart output holds no separator', () => {
        const builder = makeStrict({ keySeparator: separator })

        for (const part of PARTS) {
          expect(builder.escapePart(part).includes(separator)).toBe(false)
        }
      })
    })

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
      ['a malformed id escape', 'app:p:i%zz']
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
