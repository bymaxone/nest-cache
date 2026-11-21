/**
 * The one check of a name or a Lua source: a non-empty string.
 *
 * Layer: server. Shared by the `scripts` option and the runtime `register`, so both hold a script to the
 * same rule and report it the same way.
 */
import { refuseOption } from './refuse-option'

/**
 * Refuses a value that is not a non-empty string.
 *
 * @param option - The option or argument's name, echoed in the error.
 * @param value - The value to check.
 * @throws {CacheException} `INVALID_OPTIONS` naming `option`; only the type of the value is reported.
 */
export function requireText(option: string, value: unknown): void {
  if (typeof value !== 'string' || value === '') {
    refuseOption(option, 'must be a non-empty string', value)
  }
}
