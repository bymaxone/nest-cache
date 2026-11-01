/**
 * Printable text for whatever a `catch` or a rejected promise delivered.
 *
 * Layer: server. The helper runs on error paths, where a throw of its own would replace the
 * failure being reported.
 */

/** Text returned when the value cannot be printed at all. */
const UNPRINTABLE = 'unprintable error'

/**
 * Describes a thrown or rejected value without throwing.
 *
 * A string `message` is read from the value itself rather than gated on `instanceof Error`,
 * which is false for an `Error` from another realm and for an error-shaped object. Anything
 * else goes through `String()`, which throws for a prototype-less object or a hostile
 * `toString`; the same `try` also covers a throwing `message` getter.
 *
 * @param reason - The caught value, of any type.
 * @returns Its `message` when that is a string, else `String(reason)`, else a fixed phrase.
 */
export function describeError(reason: unknown): string {
  try {
    const message = (reason as { message?: unknown } | null | undefined)?.message
    return typeof message === 'string' ? message : String(reason)
  } catch {
    return UNPRINTABLE
  }
}
