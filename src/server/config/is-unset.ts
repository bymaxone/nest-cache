/**
 * What counts as "not set" in a host's options.
 *
 * Layer: server. A key that is present and holds `undefined` or `null` is read as absent, so it
 * resolves to the library default and never reaches the driver as "no bound" or `NaN`.
 */

/**
 * Whether an option value is unset: `undefined`, or `null` where `null` has no meaning of its own.
 *
 * @param value - The option value as the host wrote it.
 * @returns `true` for `undefined` and `null`.
 */
export function isUnset(value: unknown): value is null | undefined {
  return value === undefined || value === null
}
