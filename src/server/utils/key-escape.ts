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

/** Whether the code unit is a UTF-16 high (leading) surrogate. */
const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff

/** Whether the code unit is a UTF-16 low (trailing) surrogate. */
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

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
  for (let i = 0; i < part.length; i += 1) {
    const unit = part.charCodeAt(i)
    const next = part.charCodeAt(i + 1)
    if (isHigh(unit) && isLow(next)) {
      const whole = part.slice(i, i + 2)
      out +=
        special.has(whole.charAt(0)) || special.has(whole.charAt(1))
          ? token(unit) + token(next)
          : whole
      i += 1
    } else if (special.has(part.charAt(i)) || isHigh(unit) || isLow(unit)) {
      out += token(unit)
    } else {
      out += part.charAt(i)
    }
  }
  return out
}

/**
 * Reverses {@link escapeKeyPart}.
 *
 * @param part - An escaped part.
 * @returns The original part, or `null` when `part` holds a `%` that starts no valid token or a
 *   `%XX` token naming a non-ASCII unit: such a part was not written by the escape.
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
