/**
 * Unit tests for the record codec of the idempotency store: lease and ttl bounds, the header map
 * bound, and the decoding of a held key, where anything that is not exactly a record this package
 * wrote is refused as DESERIALIZATION_FAILED with a fixed reason and never a part of the value.
 *
 * Layer: idempotency.
 */
import { CACHE_ERROR_CODES } from '../server/errors/cache-error-codes'
import { CacheException } from '../server/errors/cache.exception'
import {
  assertFingerprint,
  assertSeconds,
  assertStatus,
  decodeHeld,
  encodeHeaders,
  MAX_HEADERS_BYTES,
  MAX_SECONDS
} from './stored-record'

/** The code and `details` a call throws, so a test pins both. */
function refusal(run: () => unknown): { code: string; details: unknown } {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CacheException)
    const { code, details } = error as CacheException
    return { code, details }
  }
  throw new Error('expected a refusal')
}

/** A held completed record as the script returns it: pttl, s, f, t, st, h, b. */
const completed = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base: unknown[] = [5000, 'c', 'fp', null, '201', '{"x-a":"1"}', 'body']
  for (const [index, value] of Object.entries(over)) base[Number(index)] = value
  return base
}

/** A held in-progress record as the script returns it. */
const inProgress = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base: unknown[] = [5000, 'p', 'fp', 'tok', null, null, null]
  for (const [index, value] of Object.entries(over)) base[Number(index)] = value
  return base
}

describe('assertSeconds', () => {
  it('accepts 1 and the maximum', () => {
    // Arrange / Act / Assert
    expect(() => assertSeconds('leaseSeconds', 1)).not.toThrow()
    expect(() => assertSeconds('leaseSeconds', MAX_SECONDS)).not.toThrow()
  })

  it.each([0, -1, 1.5, NaN, Infinity, MAX_SECONDS + 1, Number.MAX_SAFE_INTEGER])(
    'refuses %p as INVALID_OPTIONS naming the option',
    (value) => {
      // Arrange / Act
      const got = refusal(() => assertSeconds('ttlSeconds', value))

      // Assert
      expect(got).toEqual({
        code: CACHE_ERROR_CODES.INVALID_OPTIONS,
        details: { option: 'ttlSeconds', reason: 'must be an integer from 1 to 2147483647' }
      })
    }
  )
})

// What the read refuses must not be written: the key would stay blocked until its ttl ends.
describe('assertFingerprint', () => {
  it('accepts a non-empty string', () => {
    // Arrange / Act / Assert
    expect(() => assertFingerprint('f')).not.toThrow()
  })

  it.each(['', undefined, null, 7])('refuses %p as INVALID_OPTIONS', (value) => {
    // Arrange / Act
    const got = refusal(() => assertFingerprint(value))

    // Assert
    expect(got).toEqual({
      code: CACHE_ERROR_CODES.INVALID_OPTIONS,
      details: { option: 'fingerprint', reason: 'must be a non-empty string' }
    })
  })
})

describe('assertStatus', () => {
  it.each([100, 204, 599])('accepts %p', (value) => {
    // Arrange / Act / Assert
    expect(() => assertStatus(value)).not.toThrow()
  })

  it.each([99, 600, 200.5, NaN, Infinity, '200', undefined])(
    'refuses %p as INVALID_OPTIONS',
    (value) => {
      // Arrange / Act
      const got = refusal(() => assertStatus(value))

      // Assert
      expect(got).toEqual({
        code: CACHE_ERROR_CODES.INVALID_OPTIONS,
        details: { option: 'response.status', reason: 'must be an integer from 100 to 599' }
      })
    }
  )
})

describe('encodeHeaders', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'x-a'],
    ['a number', 5],
    ['an array of strings', ['a']],
    ['a value that is not a string', { 'x-a': 1 }],
    ['a list as a value', { 'set-cookie': ['a', 'b'] }]
  ])('refuses %s as INVALID_OPTIONS', (_name, headers) => {
    // Arrange / Act
    const got = refusal(() => encodeHeaders(headers as unknown as Record<string, string>))

    // Assert
    expect(got).toEqual({
      code: CACHE_ERROR_CODES.INVALID_OPTIONS,
      details: { option: 'response.headers', reason: 'must be an object of strings' }
    })
  })

  it('leaves out a header whose value is undefined, as JSON does', () => {
    // Arrange
    const headers = { 'x-a': '1', 'x-b': undefined } as unknown as Record<string, string>

    // Act / Assert
    expect(encodeHeaders(headers)).toBe('{"x-a":"1"}')
  })

  it('serialises the map as JSON', () => {
    // Arrange / Act / Assert
    expect(encodeHeaders({ 'content-type': 'application/json' })).toBe(
      '{"content-type":"application/json"}'
    )
  })

  it('accepts a map of exactly the bound and refuses one byte over', () => {
    // Arrange: `{"k":"…"}` is 8 bytes of frame around the value.
    const exact = { k: 'a'.repeat(MAX_HEADERS_BYTES - 8) }
    const over = { k: 'a'.repeat(MAX_HEADERS_BYTES - 7) }

    // Act / Assert
    expect(encodeHeaders(exact).length).toBe(MAX_HEADERS_BYTES)
    expect(refusal(() => encodeHeaders(over))).toEqual({
      code: CACHE_ERROR_CODES.INVALID_OPTIONS,
      details: { option: 'response.headers', reason: 'serialised headers exceed 65536 bytes' }
    })
  })

  it('counts bytes, not characters', () => {
    // Arrange: each "é" is two bytes in UTF-8.
    const over = { k: 'é'.repeat(MAX_HEADERS_BYTES / 2) }

    // Act / Assert
    expect(refusal(() => encodeHeaders(over)).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })
})

describe('decodeHeld', () => {
  it('decodes an in-progress claim without the token', () => {
    // Arrange / Act / Assert
    expect(decodeHeld(inProgress())).toEqual({ state: 'in_progress', fingerprint: 'fp' })
  })

  it('decodes a completed record with its body byte for byte', () => {
    // Arrange / Act / Assert
    expect(decodeHeld(completed({ 6: ' \u0000é\n' }))).toEqual({
      state: 'completed',
      fingerprint: 'fp',
      response: { status: 201, headers: { 'x-a': '1' }, body: ' \u0000é\n' }
    })
  })

  it('accepts a live key in its last millisecond (PTTL 0)', () => {
    // Redis expires a key only when now > its expiry, so PTTL 0 is still a live record.
    expect(decodeHeld(completed({ 0: 0 }))).toMatchObject({ state: 'completed' })
  })

  it('keeps an empty body and leaves an absent one out', () => {
    // Arrange / Act
    const empty = decodeHeld(completed({ 6: '' }))
    const absent = decodeHeld(completed({ 6: null }))

    // Assert
    expect(empty).toMatchObject({ response: { body: '' } })
    expect(absent).toEqual({
      state: 'completed',
      fingerprint: 'fp',
      response: { status: 201, headers: { 'x-a': '1' } }
    })
    expect('body' in (absent.response ?? {})).toBe(false)
  })

  it('accepts stored headers of exactly the bound', () => {
    // Arrange: `{"k":"` and `"}` are eight bytes.
    const value = 'a'.repeat(MAX_HEADERS_BYTES - 8)

    // Act
    const record = decodeHeld(completed({ 5: `{"k":"${value}"}` }))

    // Assert
    expect(record.response?.headers).toEqual({ k: value })
  })

  it('keeps a __proto__ header as an own entry and does not pollute', () => {
    // Arrange / Act
    const record = decodeHeld(completed({ 5: '{"__proto__":"x"}' }))

    // Assert
    expect(Object.keys(record.response?.headers ?? {})).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>)['x']).toBeUndefined()
  })

  it.each([
    ['no lifetime (-1)', completed({ 0: -1 }), 'no_lifetime'],
    ['gone (-2)', completed({ 0: -2 }), 'no_lifetime'],
    ['a lifetime that is not a number', completed({ 0: '5000' }), 'no_lifetime'],
    ['a field that is not text', completed({ 1: 7 }), 'field_type'],
    ['a missing fingerprint', completed({ 2: null }), 'fingerprint_missing'],
    ['an empty fingerprint', completed({ 2: '' }), 'fingerprint_missing'],
    ['an unknown state', completed({ 1: 'z' }), 'state_unknown'],
    ['no state', completed({ 1: null }), 'state_unknown'],
    ['a completed record that still holds a token', completed({ 3: 'tok' }), 'state_unknown'],
    ['an in-progress claim with no token', inProgress({ 3: null }), 'in_progress_invalid'],
    ['an in-progress claim with a status', inProgress({ 4: '200' }), 'in_progress_invalid'],
    ['an in-progress claim with headers', inProgress({ 5: '{}' }), 'in_progress_invalid'],
    ['an in-progress claim with a body', inProgress({ 6: 'x' }), 'in_progress_invalid'],
    ['a completed record without status', completed({ 4: null }), 'status_invalid'],
    ['a status of two digits', completed({ 4: '20' }), 'status_invalid'],
    ['a status of 099', completed({ 4: '099' }), 'status_invalid'],
    ['a status of 600', completed({ 4: '600' }), 'status_invalid'],
    ['a status of four digits', completed({ 4: '1200' }), 'status_invalid'],
    ['a status with a trailing newline', completed({ 4: '200\n' }), 'status_invalid'],
    ['a completed record without headers', completed({ 5: null }), 'headers_invalid'],
    ['headers that are not JSON', completed({ 5: '{' }), 'headers_invalid'],
    ['headers that are null', completed({ 5: 'null' }), 'headers_invalid'],
    ['headers that are an array', completed({ 5: '[]' }), 'headers_invalid'],
    ['headers that are a string', completed({ 5: '"a"' }), 'headers_invalid'],
    ['a header value that is not text', completed({ 5: '{"a":1}' }), 'headers_invalid'],
    ['one text and one other header value', completed({ 5: '{"a":"1","b":2}' }), 'headers_invalid'],
    [
      'headers over the bound',
      completed({ 5: `{"k":"${'a'.repeat(MAX_HEADERS_BYTES)}"}` }),
      'headers_invalid'
    ]
  ])('refuses %s', (_name, reply, reason) => {
    // Arrange / Act / Assert
    expect(refusal(() => decodeHeld(reply))).toEqual({
      code: CACHE_ERROR_CODES.DESERIALIZATION_FAILED,
      details: { reason }
    })
  })

  it('refuses a reply that is too short as missing fields, never as a record', () => {
    // Arrange / Act / Assert
    expect(refusal(() => decodeHeld([5000, 'c', 'fp'])).code).toBe(
      CACHE_ERROR_CODES.DESERIALIZATION_FAILED
    )
  })

  it('never puts a part of the stored value in a refusal', () => {
    // Arrange
    const secret = 'sk_live_secret_value'

    // Act
    const got = refusal(() => decodeHeld(completed({ 5: secret })))

    // Assert
    expect(JSON.stringify(got)).not.toContain(secret)
  })
})
