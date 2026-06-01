import { HttpStatus } from '@nestjs/common'

import { CACHE_ERROR_CODES, type CacheErrorCode } from '../../shared/constants/error-codes'
import { CacheException } from './cache.exception'

describe('CacheException', () => {
  // A known code resolves to its mapped message and the default 500 status,
  // wrapped in the structured { error: { code, message, details } } body.
  it('builds a structured body with the mapped message for a known code', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED)

    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(ex.getResponse()).toEqual({
      error: {
        code: 'cache.connection_failed',
        message: 'Could not connect to Redis after retries.',
        details: null
      }
    })
  })

  // An unknown code must fall back to the generic message, never `undefined`.
  it('falls back to a generic message for an unknown code', () => {
    const ex = new CacheException('cache.not_a_real_code' as CacheErrorCode)

    const body = ex.getResponse() as { error: { message: string } }
    expect(body.error.message).toBe('Cache error')
  })

  // Details pass through unchanged and an explicit status overrides the
  // canonical default. The override (418) differs from INVALID_KEY's canonical
  // status (400) so this proves precedence, not coincidence.
  it('passes details through and honors an explicit status override', () => {
    const ex = new CacheException(
      CACHE_ERROR_CODES.INVALID_KEY,
      { key: 'user:' },
      HttpStatus.I_AM_A_TEAPOT
    )

    expect(ex.getStatus()).toBe(HttpStatus.I_AM_A_TEAPOT)
    const body = ex.getResponse() as { error: { details: unknown } }
    expect(body.error.details).toEqual({ key: 'user:' })
  })

  // Codes with a non-500 entry in the error catalog (§12.2) default to their
  // canonical status without the caller passing `statusCode`.
  it.each([
    [CACHE_ERROR_CODES.COMMAND_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT],
    [CACHE_ERROR_CODES.CONNECTION_LOST, HttpStatus.SERVICE_UNAVAILABLE],
    [CACHE_ERROR_CODES.INVALID_KEY, HttpStatus.BAD_REQUEST],
    [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, HttpStatus.FORBIDDEN]
  ])('defaults %s to its canonical HTTP status', (code, status) => {
    expect(new CacheException(code).getStatus()).toBe(status)
  })

  // A catalog code whose canonical status is 500 falls back to it.
  it('defaults a 500-catalog code to INTERNAL_SERVER_ERROR', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.SERIALIZATION_FAILED)

    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
  })

  // The public readonly `.code` field must equal the code passed, so a `catch`
  // block can branch on it without parsing the response body.
  it('exposes the passed code on the readonly .code field', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })

    expect(ex.code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
  })

  // The public readonly `.details` field must equal the object passed, so
  // structured context is reachable without a cast on the response.
  it('exposes the passed details on the readonly .details field', () => {
    const details = { reason: 'empty_prefix' }
    const ex = new CacheException(CACHE_ERROR_CODES.INVALID_KEY, details)

    expect(ex.details).toEqual(details)
  })

  // When no details are supplied, `.details` must be `null` (never `undefined`)
  // so consumers can rely on a stable empty sentinel.
  it('exposes null on the .details field when details are omitted', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED)

    expect(ex.details).toBeNull()
  })
})
