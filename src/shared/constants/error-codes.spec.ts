import { CACHE_ERROR_CODES } from './error-codes'

describe('CACHE_ERROR_CODES', () => {
  // Every code must be namespaced under `cache.` so consumers can distinguish
  // cache failures from other domains by prefix.
  it('namespaces every code under "cache."', () => {
    for (const code of Object.values(CACHE_ERROR_CODES)) {
      expect(code).toMatch(/^cache\./)
    }
  })

  // Code values must be unique — a duplicate would make two distinct failure
  // modes indistinguishable to a consumer switching on the code.
  it('has unique code values', () => {
    const values = Object.values(CACHE_ERROR_CODES)
    expect(new Set(values).size).toBe(values.length)
  })

  // Lock the most common code's wire value explicitly (it is part of the
  // public contract and must stay stable across minor versions).
  it('maps CONNECTION_FAILED to its stable wire value', () => {
    expect(CACHE_ERROR_CODES.CONNECTION_FAILED).toBe('cache.connection_failed')
  })
})
