/**
 * Marks the refusals the library itself raises while it reads the host's options.
 *
 * Layer: server. A read of the host's objects can throw anything, a `CacheException` included, and
 * even a proxy as the thrown value, so a thrown value is never inspected: the library's own refusals
 * are recorded here as they are created, and only those pass through the guard unchanged. A
 * `WeakSet` lookup runs no trap, and nothing outside the package holds the set.
 */
import type { CacheErrorCode } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/** The refusals the library built. */
const OWN = new WeakSet<object>()

/**
 * Builds a refusal of the library's and records it as its own.
 *
 * @param code - The error code of the refusal.
 * @param details - Its fixed details; never an option value.
 * @returns The exception, to be thrown by the caller.
 */
export function refusal(code: CacheErrorCode, details: Record<string, unknown>): CacheException {
  const error = new CacheException(code, details)
  OWN.add(error)
  return error
}

/**
 * Whether a thrown value is a refusal the library built.
 *
 * @param thrown - Whatever was thrown.
 * @returns True only for an exception made by {@link refusal}.
 */
export function isOwnRefusal(thrown: unknown): boolean {
  return typeof thrown === 'object' && thrown !== null && OWN.has(thrown)
}
