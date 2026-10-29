/**
 * Unit tests for {@link JsonSerializer}.
 *
 * Layer: server. Covers the round-trip happy paths and every fail-closed branch —
 * circular reference, a non-Error throw from a `toJSON` hook, malformed JSON, and
 * a top-level `undefined` / function value — plus the PII-safe preview truncation
 * and its exact-cap boundary.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { JsonSerializer } from './json-serializer'

describe('JsonSerializer', () => {
  const serializer = new JsonSerializer()

  // Primitives must survive a serialize→deserialize round trip unchanged — the
  // baseline contract every typed get/set relies on.
  it('round-trips primitives', () => {
    expect(serializer.deserialize<number>(serializer.serialize(42))).toBe(42)
    expect(serializer.deserialize<string>(serializer.serialize('x'))).toBe('x')
    expect(serializer.deserialize<boolean>(serializer.serialize(true))).toBe(true)
    expect(serializer.deserialize<null>(serializer.serialize(null))).toBeNull()
  })

  // Nested objects and arrays must round-trip structurally — exercises the JSON
  // codec on the composite shapes consumers actually cache.
  it('round-trips nested objects and arrays', () => {
    const value = { a: 1, b: [2, 3], c: { d: null } }

    expect(serializer.deserialize(serializer.serialize(value))).toEqual(value)
  })

  // A circular reference makes JSON.stringify throw a TypeError; serialize must
  // wrap it as SERIALIZATION_FAILED (fail closed, never emit a partial string).
  it('throws SERIALIZATION_FAILED on a circular reference', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(() => serializer.serialize(circular)).toThrow(CacheException)
    try {
      serializer.serialize(circular)
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
    }
  })

  // A `toJSON` hook can throw a non-Error value; the message extractor must fall
  // back to String(err) so `details.error` is still populated (covers the
  // non-Error branch of the shared helper that JSON.parse alone cannot reach).
  it('stringifies a non-Error throw from a toJSON hook', () => {
    const hostile = {
      toJSON(): never {
        throw 'boom-as-string'
      }
    }

    try {
      serializer.serialize(hostile)
      throw new Error('expected serialize to throw')
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
      expect((error as CacheException).details?.['error']).toBe('boom-as-string')
    }
  })

  // A top-level `undefined` makes JSON.stringify return the JS value `undefined`
  // (not a string) WITHOUT throwing; serialize must reject it up front so the
  // `string` return contract and the fail-closed invariant hold at write time.
  // The exact `details` payload is asserted with `toEqual` to pin the fail-closed
  // throw at L77-78: it kills the ObjectLiteral→`{}` mutant (empty details) AND
  // the StringLiteral→`''` mutant (blanked message).
  it('throws SERIALIZATION_FAILED for a top-level undefined value', () => {
    expect(() => serializer.serialize(undefined)).toThrow(CacheException)
    try {
      serializer.serialize(undefined)
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
      expect((error as CacheException).details).toEqual({
        error: 'Cannot serialize a top-level undefined, function, or symbol value'
      })
    }
  })

  // A top-level function is the other JSON.stringify→undefined case and must
  // likewise fail closed rather than silently writing a non-string. Asserting the
  // exact `details` again guards the same L77-78 ObjectLiteral→`{}` and
  // StringLiteral→`''` mutants from this entry path.
  it('throws SERIALIZATION_FAILED for a top-level function value', () => {
    expect(() => serializer.serialize(() => undefined)).toThrow(CacheException)
    try {
      serializer.serialize(() => undefined)
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
      expect((error as CacheException).details).toEqual({
        error: 'Cannot serialize a top-level undefined, function, or symbol value'
      })
    }
  })

  // A top-level symbol is the third JSON.stringify→undefined case (flagged in
  // review) and must fail closed exactly like undefined / function. The exact
  // `details` assertion covers the L77-78 ObjectLiteral→`{}` and StringLiteral→`''`
  // mutants from the symbol entry path.
  it('throws SERIALIZATION_FAILED for a top-level symbol value', () => {
    expect(() => serializer.serialize(Symbol('x'))).toThrow(CacheException)
    try {
      serializer.serialize(Symbol('x'))
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
      expect((error as CacheException).details).toEqual({
        error: 'Cannot serialize a top-level undefined, function, or symbol value'
      })
    }
  })

  // The guard is TOP-LEVEL only: nested undefined/function/symbol members are
  // dropped by standard JSON semantics and the surviving members still serialize
  // — pins the guard's scope so a broadened-condition mutant (firing on nested
  // values) dies.
  it('drops nested undefined/function/symbol members and serializes the rest', () => {
    const value = { a: undefined, b: (): void => undefined, s: Symbol('x'), c: 1 }

    expect(serializer.serialize(value)).toBe('{"c":1}')
  })

  // Malformed JSON must throw DESERIALIZATION_FAILED rather than returning a
  // partial value — the fail-closed security invariant for cached payloads.
  it('throws DESERIALIZATION_FAILED on malformed JSON', () => {
    expect(() => serializer.deserialize('not json')).toThrow(CacheException)
  })

  // A stored value that is not JSON may hold PII or a credential, and the exception
  // body travels to the HTTP client through a default Nest filter. No byte of it may
  // appear anywhere in the exception: neither in the response body, nor in `message`,
  // nor in `details` — including the engine's own parse message, which quotes the
  // start of the input. The marker sits at the start (where V8 quotes) and far past
  // it, and the payload is longer than any preview, so a truncating echo fails too.
  it('never echoes any part of a non-JSON stored value into the exception', () => {
    const secret = 'sk-live-4eC39HqLyjWDarjtT1zdp7dc'
    const late = 'late-marker-ZZ9'
    const raw = `${secret} not json ${'x'.repeat(200)} ${late}`

    let thrown: unknown
    try {
      serializer.deserialize(raw)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheException)
    const cacheError = thrown as CacheException
    const everything = JSON.stringify(cacheError.getResponse()) + cacheError.message
    expect(everything).not.toContain('sk-live')
    expect(everything).not.toContain(secret.slice(0, 10))
    expect(everything).not.toContain('late-marker')
    expect(everything).not.toContain('x'.repeat(10))
    expect(cacheError.details).toEqual({
      error: 'stored value is not valid JSON',
      length: raw.length
    })
  })

  // The exception still carries the code and a fixed reason, so a consumer can branch
  // on DESERIALIZATION_FAILED and tell a codec mismatch from a corrupted entry by size.
  it('keeps the DESERIALIZATION_FAILED code and reports only the value length', () => {
    try {
      serializer.deserialize('{')
      throw new Error('expected deserialize to throw')
    } catch (error) {
      const cacheError = error as CacheException
      expect(cacheError.code).toBe(CACHE_ERROR_CODES.DESERIALIZATION_FAILED)
      expect(cacheError.details?.['length']).toBe(1)
      expect(cacheError.details).not.toHaveProperty('preview')
    }
  })
})
