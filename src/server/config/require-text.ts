/**
 * The one check of a name or a Lua source: a string with something in it besides blanks and invisible
 * characters.
 *
 * Layer: server. Shared by the `scripts` option and the runtime `register`, so both hold a script to the
 * same rule and report it the same way.
 */
import { refuseOption } from './refuse-option'

/**
 * Blanks and the characters that print as nothing or are not text: the Unicode default-ignorable set,
 * the format (`Cf`) and control (`Cc`, the next-line control included) characters, the object
 * replacement character and the braille blank. A text made only of them is empty.
 */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\uFFFC\u2800]/gu

/**
 * Refuses a value that is not a non-empty string.
 *
 * @param option - The option or argument's name, echoed in the error.
 * @param value - The value to check.
 * @throws {CacheException} `INVALID_OPTIONS` naming `option`; only the type of the value is reported.
 */
export function requireText(option: string, value: unknown): void {
  if (typeof value !== 'string' || value.replace(INVISIBLE, '') === '') {
    refuseOption(option, 'must be a non-empty string', value)
  }
}
