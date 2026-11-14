/**
 * Injective escaping of one Redis key part.
 *
 * Layer: server, pure. {@link KeyBuilder} joins parts with a separator, which is unambiguous only when
 * no part can contain it. This module rewrites the characters that would break that, as tokens that
 * begin with `%`, which is itself always rewritten, so the rewrite can be undone and no two distinct
 * parts share an output.
 *
 * Two token shapes, both fixed-width and uppercase: `%XX` for an ASCII code unit and `%uXXXX` for any
 * other. An unpaired surrogate is always rewritten: it has no UTF-8 encoding, so ioredis would send
 * U+FFFD for it, and two different parts would become one key at the server whatever the string says.
 */

/** The character every rewritten code unit starts with, and itself always rewritten. */
export const ESCAPE_CHAR = '%'

/**
 * Glob metacharacters a prefix must not carry into a `SCAN`/`KEYS` pattern. `]` is absent on purpose:
 * unpaired it is a literal to Redis, and a `[` that could pair with it is rewritten.
 */
export const GLOB_CHARS = '*?[\\'

/** One escape token: `%XX` (ASCII) or `%uXXXX` (any other code unit). */
const TOKEN = /(%[0-9A-F]{2}|%u[0-9A-F]{4})/

/**
 * The characters an escape token is spelled with: the escape character, the hex digits (uppercase) and
 * the `u` of the long form. A separator character in this set also occurs inside tokens.
 */
const TOKEN_ALPHABET: ReadonlySet<string> = new Set('0123456789ABCDEFu%')

/** Whether the code unit is a UTF-16 surrogate, which on its own has no UTF-8 encoding. */
const isSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdfff

/**
 * Writes one code unit as its token.
 *
 * @param unit - The UTF-16 code unit.
 * @returns `%XX` below 0x80, otherwise `%uXXXX`, hex in uppercase.
 */
function token(unit: number): string {
  const hex = unit.toString(16).toUpperCase()
  return unit < 0x80 ? `%${hex.padStart(2, '0')}` : `%u${hex.padStart(4, '0')}`
}

/**
 * Builds the set of code units a part must not carry: the escape character, every code unit of the
 * separator (so a multi-character separator cannot straddle a field boundary), and optionally the glob
 * metacharacters.
 *
 * @param separator - The configured key separator.
 * @param escapeGlob - Whether glob metacharacters are rewritten too.
 * @returns The characters to rewrite.
 */
export function buildEscapeSet(separator: string, escapeGlob: boolean): ReadonlySet<string> {
  const chars = new Set<string>([ESCAPE_CHAR])
  for (let i = 0; i < separator.length; i += 1) {
    chars.add(separator.charAt(i))
  }
  if (escapeGlob) {
    for (const glob of GLOB_CHARS) {
      chars.add(glob)
    }
  }
  return chars
}

/**
 * Rewrites every character of `part` that is in `special`, and every unpaired surrogate.
 *
 * A valid surrogate pair is kept whole or rewritten whole: rewriting one half would leave the other
 * unpaired on the wire.
 *
 * @param part - The caller-owned part.
 * @param special - The characters to rewrite, from {@link buildEscapeSet}.
 * @returns The part with each such code unit replaced by its token.
 */
export function escapeKeyPart(part: string, special: ReadonlySet<string>): string {
  let out = ''
  // Iterating a string yields code points: a valid pair arrives as one two-unit string and an
  // unpaired surrogate as a single unit, so no index is advanced by hand.
  for (const char of part) {
    if (char.length === 2) {
      out += special.has(char.charAt(0)) || special.has(char.charAt(1)) ? escapeUnits(char) : char
    } else {
      out += special.has(char) || isSurrogate(char.charCodeAt(0)) ? token(char.charCodeAt(0)) : char
    }
  }
  return out
}

/**
 * Writes every code unit of `chars` as its token.
 *
 * @param chars - The characters to rewrite.
 * @returns The concatenated tokens.
 */
function escapeUnits(chars: string): string {
  let out = ''
  for (let i = 0; i < chars.length; i += 1) {
    out += token(chars.charCodeAt(i))
  }
  return out
}

/**
 * Reverses {@link escapeKeyPart}.
 *
 * @param part - An escaped part.
 * @returns The original part, or `null` when `part` holds a `%` that starts no valid token or a
 *   `%XX` token naming a non-ASCII unit: such a part is malformed. A well-formed token decodes to the unit it names, canonical or not.
 */
export function unescapeKeyPart(part: string): string | null {
  const pieces = part.split(TOKEN)
  let out = ''
  for (const [index, piece] of pieces.entries()) {
    if (index % 2 === 0) {
      if (piece.includes(ESCAPE_CHAR)) {
        return null
      }
      out += piece
    } else {
      const code = parseInt(piece.slice(piece.charAt(1) === 'u' ? 2 : 1), 16)
      if (code >= 0x80 && piece.charAt(1) !== 'u') {
        return null
      }
      out += String.fromCharCode(code)
    }
  }
  return out
}

/**
 * Splits `rest`, the key after the namespace and its separator, into the escaped prefix and id.
 *
 * Looks for the separator only in the text between escape tokens, so a separator whose characters
 * also occur inside a token (a hex digit, `u`) is never matched in the middle of one. Raw text never
 * holds a separator character, because the escape rewrites them all.
 *
 * @param rest - The key without its namespace prefix.
 * @param separator - The configured key separator.
 * @returns The two escaped parts, or `null` unless there is exactly one boundary, both parts are
 *   non-empty, and every `%` starts a complete token.
 */
export function splitEscapedParts(
  rest: string,
  separator: string
): { prefix: string; id: string } | null {
  let prefix = ''
  let id = ''
  let found = false
  for (const [index, piece] of rest.split(TOKEN).entries()) {
    if (index % 2 === 1) {
      // An escape token: never searched for the separator, only carried into the part it sits in.
      found ? (id += piece) : (prefix += piece)
      continue
    }
    if (piece.includes(ESCAPE_CHAR)) {
      return null
    }
    const halves = piece.split(separator)
    if (halves.length > 2 || (found && halves.length > 1)) {
      return null
    }
    if (halves.length === 2) {
      prefix += halves[0]
      id += halves[1]
      found = true
    } else if (found) {
      id += piece
    } else {
      prefix += piece
    }
  }
  return found && prefix !== '' && id !== '' ? { prefix, id } : null
}

/**
 * Whether a glob pattern spells any code unit of `units` as a literal, before any character class.
 *
 * Up to the first unescaped `[` a pattern is plain characters, `*`, `?` and backslash escapes, so a
 * unit it spells, raw or escaped, is one a stored id cannot supply. A character class is not parsed:
 * Redis closes it by rules that include range endpoints and a leading closing bracket, a class can
 * match text that holds none of its members, and a copy of those rules would be a second
 * implementation to keep equal to the server's. A pattern with a class is therefore accepted from
 * the bracket on, which can only let a pattern that matches nothing through, never refuse one that
 * could match.
 *
 * @param pattern - The glob pattern.
 * @param units - The code units to look for, one character each.
 * @returns True when the pattern spells one of them before its first character class.
 */
export function holdsLiteralUnit(pattern: string, units: ReadonlySet<string>): boolean {
  let escaped = false
  for (const unit of pattern.split('')) {
    if (escaped) {
      escaped = false
      if (units.has(unit)) {
        return true
      }
    } else if (unit === '\\') {
      escaped = true
    } else if (unit === '[') {
      return false
    } else if (units.has(unit)) {
      return true
    }
  }
  return false
}

/**
 * The code units of `separator` that no escape token is spelled with.
 *
 * Under strict escaping every separator character is rewritten, so a stored id never holds one of
 * these: a pattern that does can never match. A separator character that is also a token
 * character (a digit, `A`-`F`, `u`) is spelled inside tokens, so a pattern may hold it and still match,
 * and it is left out. So is a surrogate unit: ioredis writes a key as UTF-8, where a lone surrogate
 * becomes U+FFFD, which is not a separator unit, so a pattern holding one can match a stored id.
 *
 * @param separator - The configured key separator.
 * @returns The code units a stored id cannot hold.
 */
export function unmatchableUnits(separator: string): ReadonlySet<string> {
  return new Set(
    separator
      .split('')
      .filter((unit) => !TOKEN_ALPHABET.has(unit) && !isSurrogate(unit.charCodeAt(0)))
  )
}
