/**
 * Unit tests for the pure key-part escape.
 *
 * Layer: server. Pins the token format at its boundaries: the ASCII / non-ASCII split, the width of
 * each token, the surrogate range edges and what the decoder accepts, so none of them can move
 * without a test failing.
 */
import { buildEscapeSet, escapeKeyPart, splitEscapedParts, unescapeKeyPart } from './key-escape'

/** Escapes `part` with the default separator and no glob characters. */
const escape = (part: string, separator = ':', glob = false): string =>
  escapeKeyPart(part, buildEscapeSet(separator, glob))

describe('buildEscapeSet', () => {
  // The escape character is always in the set; glob characters only when asked for.
  it('holds the escape character and the separator, and glob characters only on request', () => {
    expect([...buildEscapeSet(':', false)].sort()).toEqual(['%', ':'])
    expect([...buildEscapeSet(':', true)].sort()).toEqual(['%', '*', ':', '?', '[', '\\'])
  })

  // Every code unit of a multi-character separator is in the set.
  it('holds every code unit of a multi-character separator', () => {
    expect([...buildEscapeSet('ab', false)].sort()).toEqual(['%', 'a', 'b'])
  })
})

describe('escapeKeyPart', () => {
  // A part with nothing to rewrite is returned as it came.
  it('leaves a plain part unchanged', () => {
    expect(escape('plain-id_42')).toBe('plain-id_42')
  })

  // A token is two hex digits for ASCII, padded: a code unit below 0x10 must not lose its zero.
  it('pads an ASCII token to two digits', () => {
    expect(escape('a\tb', '\t')).toBe('a%09b')
  })

  // 0x7F is the last ASCII unit and 0x80 the first that is not: the token shape changes there.
  it('writes 0x7F as %XX and 0x80 as %uXXXX', () => {
    expect(escape('\u007F', '\u007F')).toBe('%7F')
    expect(escape('\u0080', '\u0080')).toBe('%u0080')
  })

  // A non-ASCII token is four hex digits, padded.
  it('pads a non-ASCII token to four digits', () => {
    expect(escape('é', 'é')).toBe('%u00E9')
  })

  // The surrogate range is [0xD800, 0xDFFF]: the units just outside it pass through, the edges inside
  // it are rewritten when unpaired.
  it('rewrites an unpaired surrogate at both edges of the range and not the units beside it', () => {
    expect(escape('퟿')).toBe('퟿')
    expect(escape('\uD800')).toBe('%uD800')
    expect(escape('\uDBFF')).toBe('%uDBFF')
    expect(escape('\uDC00')).toBe('%uDC00')
    expect(escape('\uDFFF')).toBe('%uDFFF')
    expect(escape('')).toBe('')
  })

  // A valid pair is kept whole, at the edges of both halves.
  it('keeps a valid pair whole', () => {
    expect(escape('𐀀')).toBe('𐀀')
    expect(escape('􏿿')).toBe('􏿿')
  })

  // A low surrogate before a high one is two unpaired units, not a pair.
  it('treats a reversed pair as two unpaired surrogates', () => {
    expect(escape('\uDC00\uD800')).toBe('%uDC00%uD800')
  })

  // A pair is rewritten whole when either half is special, so neither half is left unpaired.
  it('rewrites a pair whole when only its high or only its low unit is special', () => {
    expect(escapeKeyPart('\u{1F600}', new Set(['\uD83D']))).toBe('%uD83D%uDE00')
    expect(escapeKeyPart('\u{1F600}', new Set(['\uDE00']))).toBe('%uD83D%uDE00')
    expect(escapeKeyPart('\u{1F600}', new Set(['%']))).toBe('\u{1F600}')
  })

  // An unpaired surrogate that is also special is rewritten once.
  it('rewrites a special unpaired surrogate once', () => {
    expect(escapeKeyPart('\uD800', new Set(['\uD800']))).toBe('%uD800')
  })
})

describe('unescapeKeyPart', () => {
  // The decoder accepts the whole ASCII range of the short form and refuses the rest of it.
  it('accepts %7F and refuses %80', () => {
    expect(unescapeKeyPart('%7F')).toBe('\u007F')
    expect(unescapeKeyPart('%80')).toBeNull()
  })

  // The long form decodes any unit, including those below 0x80.
  it('decodes the long form', () => {
    expect(unescapeKeyPart('%u0041%uD800')).toBe('A\uD800')
  })

  // Hex digits are uppercase only, in both forms.
  it('refuses a lowercase token', () => {
    expect(unescapeKeyPart('%7f')).toBeNull()
    expect(unescapeKeyPart('%ud800')).toBeNull()
  })

  // Literal text between tokens is kept, and an empty part decodes to an empty part.
  it('keeps literal text and decodes the empty string', () => {
    expect(unescapeKeyPart('a%3Ab')).toBe('a:b')
    expect(unescapeKeyPart('')).toBe('')
  })

  // A stray escape character between two valid tokens is still refused.
  it('refuses a stray % between tokens', () => {
    expect(unescapeKeyPart('%3A%%3A')).toBeNull()
  })
})

describe('splitEscapedParts', () => {
  // The boundary is the separator between the tokens, however many tokens each part holds.
  it('splits at the one separator and keeps the tokens with their part', () => {
    expect(splitEscapedParts('a%3Ab:c%25', ':')).toEqual({ prefix: 'a%3Ab', id: 'c%25' })
    expect(splitEscapedParts('%u00E9:%3A', ':')).toEqual({ prefix: '%u00E9', id: '%3A' })
  })

  // A separator that is a token character is not a boundary inside a token.
  it('does not find the separator inside a token', () => {
    expect(splitEscapedParts('p2%25', '2')).toEqual({ prefix: 'p', id: '%25' })
    expect(splitEscapedParts('%25p2x', '2')).toEqual({ prefix: '%25p', id: 'x' })
    expect(splitEscapedParts('%uD83D2%uDE00', '2')).toEqual({ prefix: '%uD83D', id: '%uDE00' })
  })

  // Exactly one boundary: none, or a second one, is refused, wherever the second one sits.
  it('refuses zero boundaries and more than one', () => {
    expect(splitEscapedParts('abc', ':')).toBeNull()
    expect(splitEscapedParts('a:b:c', ':')).toBeNull()
    expect(splitEscapedParts('a:%3A:c', ':')).toBeNull()
    expect(splitEscapedParts('a%3A:b:c', ':')).toBeNull()
    // Two boundaries in one run of text, with a later run that holds one more.
    expect(splitEscapedParts('a:b:c%3A:d', ':')).toBeNull()
  })

  // Both parts must be non-empty.
  it('refuses an empty prefix or id', () => {
    expect(splitEscapedParts(':b', ':')).toBeNull()
    expect(splitEscapedParts('a:', ':')).toBeNull()
    expect(splitEscapedParts('', ':')).toBeNull()
  })

  // A `%` outside a complete token is malformed wherever it sits, including after a valid token and
  // when a valid token follows it later in the text.
  it('refuses a % that starts no complete token', () => {
    expect(splitEscapedParts('p%x%41:i', ':')).toBeNull()
    expect(splitEscapedParts('p%uD80:i', ':')).toBeNull()
    expect(splitEscapedParts('p:i%', ':')).toBeNull()
    expect(splitEscapedParts('p%3A%:i', ':')).toBeNull()
  })

  // A multi-character separator is matched whole.
  it('matches a multi-character separator whole', () => {
    expect(splitEscapedParts('a%61ab', 'ab')).toBeNull()
    expect(splitEscapedParts('xabz', 'ab')).toEqual({ prefix: 'x', id: 'z' })
  })
})
