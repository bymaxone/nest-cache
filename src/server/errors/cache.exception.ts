/**
 * Cache exception type and HTTP-status mapping.
 *
 * Layer: server — depends on `@nestjs/common` (`HttpException`). Error codes and
 * messages live in `cache-error-codes`; this module maps codes to HTTP statuses
 * and exposes the throwable. A `Map` (not an index signature) backs the status
 * lookup so a runtime `code` can never trigger object-injection.
 */
import { HttpException, HttpStatus } from '@nestjs/common'

import { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES, type CacheErrorCode } from './cache-error-codes'

/**
 * Canonical HTTP status per error code, from the error catalog in
 * `docs/technical_specification.md` §12.2. Only codes whose canonical status
 * differs from 500 are listed; every other code falls back to 500, so a throw
 * site never has to remember an override to get the documented status.
 */
const CACHE_ERROR_STATUS: ReadonlyMap<CacheErrorCode, HttpStatus> = new Map<
  CacheErrorCode,
  HttpStatus
>([
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT],
  [CACHE_ERROR_CODES.CONNECTION_LOST, HttpStatus.SERVICE_UNAVAILABLE],
  [CACHE_ERROR_CODES.INVALID_KEY, HttpStatus.BAD_REQUEST],
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, HttpStatus.FORBIDDEN]
])

/**
 * Exception thrown by the cache library. Serializes to a structured
 * `{ error: { code, message, details } }` body and carries an HTTP status, so it
 * surfaces cleanly when thrown inside a NestJS request pipeline. The `code` and
 * `details` are exposed as readonly fields for `catch`-block branching without a
 * cast.
 *
 * SECURITY: `details` is serialized verbatim into the response body, so throw
 * sites MUST keep it small and free of secret values (CLAUDE.md §4). The library
 * does not truncate it here — a response-shaping exception filter is the right
 * place for that and lands in a later phase.
 *
 * @example
 * throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })
 */
export class CacheException extends HttpException {
  /** The canonical error code (one of {@link CACHE_ERROR_CODES}). */
  readonly code: CacheErrorCode
  /** Structured, secret-free context attached at the throw site, or `null`. */
  readonly details: Record<string, unknown> | null

  /**
   * @param code - One of {@link CACHE_ERROR_CODES}.
   * @param details - Optional structured context. Never include secret values.
   * @param statusCode - HTTP status override. When omitted, defaults to the
   *   canonical status for `code` (§12.2), or 500 for codes whose canonical
   *   status is 500.
   */
  constructor(code: CacheErrorCode, details?: Record<string, unknown>, statusCode?: HttpStatus) {
    super(
      {
        error: {
          code,
          message: CACHE_ERROR_MESSAGES.get(code) ?? 'Cache error',
          details: details ?? null
        }
      },
      statusCode ?? CACHE_ERROR_STATUS.get(code) ?? HttpStatus.INTERNAL_SERVER_ERROR
    )
    this.code = code
    this.details = details ?? null
  }
}
