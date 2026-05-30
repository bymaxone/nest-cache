import { HttpStatus } from '@nestjs/common'

import { CACHE_ERROR_CODES } from '../../shared/constants/error-codes'
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
    const ex = new CacheException('cache.not_a_real_code')

    const body = ex.getResponse() as { error: { message: string } }
    expect(body.error.message).toBe('Cache error')
  })

  // Details pass through unchanged and a custom status overrides the default.
  it('passes details through and honors a custom status', () => {
    const ex = new CacheException(
      CACHE_ERROR_CODES.INVALID_KEY,
      { key: 'user:' },
      HttpStatus.BAD_REQUEST
    )

    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST)
    const body = ex.getResponse() as { error: { details: unknown } }
    expect(body.error.details).toEqual({ key: 'user:' })
  })
})
