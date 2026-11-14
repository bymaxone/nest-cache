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
        message:
          'Could not establish the Redis connection: the connection options are missing or invalid, or the client did not become ready.',
        details: null
      }
    })
  })

  // The error's own `message` is what a log line or an uncaught boot failure prints. It must carry
  // the catalog text, not the class-name default an object response would otherwise produce.
  it('uses the catalog message as the error message', () => {
    expect(new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED).message).toBe(
      'Could not establish the Redis connection: the connection options are missing or invalid, or the client did not become ready.'
    )
    expect(new CacheException('cache.not_a_real_code' as CacheErrorCode).message).toBe(
      'Cache error'
    )
  })

  // The original error of a wrapped failure is kept as `cause`, and absent when none is given.
  it('carries the cause it is given, and none otherwise', () => {
    const original = new Error('original')

    expect(
      new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, undefined, undefined, original)
        .cause
    ).toBe(original)
    expect(new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED).cause).toBeUndefined()
    // Construction without a cause must not create an own `cause` property.
    expect(
      Object.hasOwn(new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED), 'cause')
    ).toBe(false)
    expect(
      Object.hasOwn(
        new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, undefined, undefined, 0),
        'cause'
      )
    ).toBe(true)
    expect(
      new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, undefined, undefined, 0).cause
    ).toBe(0)
  })

  // A stored value of the wrong shape is a server-side data fault, like a payload that cannot be
  // decoded, so it is a 500 and not a client error.
  it('defaults VALIDATION_FAILED to INTERNAL_SERVER_ERROR with its catalog message', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.VALIDATION_FAILED)

    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(ex.message).toBe('The stored value does not match the expected shape.')
  })

  // A refused option is a boot-time configuration fault, a 500 with a message that does not read as
  // a network failure.
  it('defaults INVALID_OPTIONS to INTERNAL_SERVER_ERROR with its catalog message', () => {
    const ex = new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS)

    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(ex.message).toBe('A configuration option has a value the library cannot honour.')
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
    [CACHE_ERROR_CODES.COMMAND_TIMEOUT, HttpStatus.SERVICE_UNAVAILABLE],
    [CACHE_ERROR_CODES.CONNECTION_LOST, HttpStatus.SERVICE_UNAVAILABLE],
    [CACHE_ERROR_CODES.INVALID_KEY, HttpStatus.BAD_REQUEST],
    [CACHE_ERROR_CODES.INVALID_TTL, HttpStatus.BAD_REQUEST],
    [CACHE_ERROR_CODES.SCOPE_NOT_FOUND, HttpStatus.NOT_FOUND],
    [CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE, HttpStatus.NOT_FOUND],
    [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, HttpStatus.FORBIDDEN]
  ])('defaults %s to its canonical HTTP status', (code, status) => {
    expect(new CacheException(code).getStatus()).toBe(status)
  })

  // The whole table, so a code added or re-mapped later is a visible decision: an unavailable or
  // timed-out backing service and a refused connection answer 503 (one "retry later" status), a
  // caller's mistake a 4xx, and only a genuine internal fault or a boot-time configuration error 500.
  it('maps every error code to the documented HTTP status', () => {
    const status = (code: CacheErrorCode): number => new CacheException(code).getStatus()
    const table = Object.fromEntries(
      Object.values(CACHE_ERROR_CODES).map((code) => [code, status(code)])
    )

    expect(table).toEqual({
      'cache.connection_failed': 500,
      'cache.command_timeout': 503,
      'cache.connection_lost': 503,
      'cache.serialization_failed': 500,
      'cache.deserialization_failed': 500,
      'cache.invalid_namespace': 500,
      'cache.invalid_key': 400,
      'cache.script_not_registered': 500,
      'cache.script_execution_failed': 500,
      'cache.script_registry_missing': 500,
      'cache.flush_disabled_in_production': 403,
      'cache.cluster_misconfigured': 500,
      'cache.sentinel_misconfigured': 500,
      'cache.shutdown_timeout': 500,
      'cache.unsupported_in_cluster': 500,
      'cache.invalid_scope': 500,
      'cache.scope_not_found': 404,
      'cache.scope_not_readable': 500,
      'cache.key_not_in_scope': 404,
      'cache.invalid_ttl': 400,
      'cache.validation_failed': 500,
      'cache.invalid_options': 500
    })
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
