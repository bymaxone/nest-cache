import { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES } from './cache-error-codes'

describe('CACHE_ERROR_MESSAGES', () => {
  // The catalog must be a Map (not a plain object) so a runtime `code` value can
  // never trigger object-injection on lookup (security invariant, file header).
  it('is backed by a Map', () => {
    expect(CACHE_ERROR_MESSAGES).toBeInstanceOf(Map)
  })

  // Every one of the 15 canonical codes must have a message — a missing entry
  // would surface as the generic fallback, hiding the specific failure mode.
  it('covers every canonical error code', () => {
    const codes = Object.values(CACHE_ERROR_CODES)
    expect(CACHE_ERROR_MESSAGES.size).toBe(codes.length)
    for (const code of codes) {
      expect(CACHE_ERROR_MESSAGES.has(code)).toBe(true)
    }
  })

  // No message may be empty or whitespace-only — an end user must always get an
  // actionable sentence, never a blank string.
  it('has a non-empty message for every code', () => {
    for (const message of CACHE_ERROR_MESSAGES.values()) {
      expect(message.trim().length).toBeGreaterThan(0)
    }
  })

  // Lock one representative message to its exact wire value; it is part of the
  // public contract surfaced to consumers and must stay stable.
  it('maps CONNECTION_FAILED to its stable message', () => {
    expect(CACHE_ERROR_MESSAGES.get(CACHE_ERROR_CODES.CONNECTION_FAILED)).toBe(
      'Could not connect to Redis after retries.'
    )
  })
})
