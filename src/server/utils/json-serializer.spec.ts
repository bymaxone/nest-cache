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
  // partial value — the fail-closed security invariant for cached payloads. The
  // details.error must carry the bare `err.message`, NOT `String(err)` (which
  // would prepend the `SyntaxError:` constructor name) — pins the Error branch
  // of the shared message extractor.
  it('throws DESERIALIZATION_FAILED on malformed JSON with the bare error message', () => {
    expect(() => serializer.deserialize('not json')).toThrow(CacheException)
    try {
      serializer.deserialize('not json')
    } catch (error) {
      const cacheError = error as CacheException
      expect(cacheError.code).toBe(CACHE_ERROR_CODES.DESERIALIZATION_FAILED)
      expect(cacheError.details?.['error']).not.toMatch(/SyntaxError/)
    }
  })

  // A payload longer than the preview cap must be truncated to 100 chars plus an
  // ellipsis, so a large (possibly PII-bearing) value never lands in the error.
  it('truncates an over-long preview to 100 chars plus an ellipsis', () => {
    const longBad = 'x'.repeat(200)

    try {
      serializer.deserialize(longBad)
      throw new Error('expected deserialize to throw')
    } catch (error) {
      expect((error as CacheException).details?.['preview']).toMatch(/^x{100}\.\.\.$/)
    }
  })

  // A payload at exactly the preview cap is echoed verbatim with no ellipsis —
  // pins the boundary of the truncation guard (kills the `>=` / off-by-one mutant).
  it('keeps a preview at exactly the cap verbatim', () => {
    const boundaryBad = 'y'.repeat(100)

    try {
      serializer.deserialize(boundaryBad)
      throw new Error('expected deserialize to throw')
    } catch (error) {
      expect((error as CacheException).details?.['preview']).toBe(boundaryBad)
    }
  })
})
