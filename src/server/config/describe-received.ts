/**
 * Describes a refused option value without echoing it.
 *
 * Layer: server. A refusal reaches logs and error reporters, and a configured value can be a
 * credential pasted into the wrong option, so a refusal names the value's type and, for a number, the
 * number: a quantity is not a secret.
 */

/** What a value of each `typeof` is called in a refusal. */
const TYPE_NAMES = {
  string: 'a string',
  symbol: 'a symbol',
  function: 'a function',
  boolean: 'a boolean',
  bigint: 'a bigint',
  object: 'an object',
  undefined: 'undefined'
} as const

/**
 * The value's type, or the number itself when it is finite.
 *
 * @param value - The refused option value.
 * @returns A finite number as itself; `NaN` and an infinity as their names; anything else as a
 *   phrase such as `a string`, `an array` or `null`. No part of a non-number value appears in it.
 */
export function describeReceived(value: unknown): number | string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'an array'
  }
  return TYPE_NAMES[typeof value as keyof typeof TYPE_NAMES]
}
