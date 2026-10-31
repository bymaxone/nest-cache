/**
 * TTL contract for the write methods of {@link CacheService}.
 *
 * Layer: server. Redis refuses a non-integer expiry, and `SET ... EX` also refuses
 * zero and negative ones, each with a raw reply error that names no cache key and
 * carries no `cache.*` code. Checking here turns that into a structured exception
 * before anything is sent.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/** Smallest TTL, in seconds, that `SET ... EX` accepts. */
export const MIN_WRITE_TTL_SECONDS = 1

/**
 * Throws `INVALID_TTL` unless `ttlSeconds` is a safe integer that reaches `minimum`.
 *
 * `EXPIRE` keeps Redis's meaning for zero and negative integers (the key is
 * deleted), so a caller that relies on it keeps working: it passes no `minimum`.
 *
 * @param ttlSeconds - The TTL the caller passed.
 * @param minimum - Smallest accepted value, or `undefined` for any safe integer.
 * @throws {CacheException} `INVALID_TTL` with `reason: 'not_a_safe_integer'` or
 *   `reason: 'below_minimum'` and the `minimum`.
 */
export function assertTtlSeconds(ttlSeconds: number, minimum: number | undefined): void {
  if (!Number.isSafeInteger(ttlSeconds)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_TTL, { reason: 'not_a_safe_integer' })
  }
  if (minimum !== undefined && ttlSeconds < minimum) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_TTL, { reason: 'below_minimum', minimum })
  }
}
