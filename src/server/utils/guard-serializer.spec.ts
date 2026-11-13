/**
 * Unit tests for {@link guardSerializer}.
 *
 * Layer: server. A custom `ISerializer` is a consumer's code, so whatever it throws is wrapped in a
 * `CacheException` that names the operation and carries nothing from the value, with the original
 * error kept as `cause`. An error that is already a `CacheException` passes through untouched.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { guardSerializer } from './guard-serializer'

import type { ISerializer } from '../interfaces/serializer.interface'

/** Runs `call` and returns what it threw, failing the test if it did not throw. */
const thrownBy = (call: () => unknown): unknown => {
  try {
    call()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

/** A serializer that throws `error` from both methods. */
const throwing = (error: unknown): ISerializer => ({
  serialize: () => {
    throw error
  },
  deserialize: () => {
    throw error
  }
})

describe('guardSerializer', () => {
  // A throw from deserialize reaches the caller as DESERIALIZATION_FAILED, keeping the original as the
  // cause and exposing nothing from the stored value: the fixed text and its length only.
  it('wraps a deserialize throw as DESERIALIZATION_FAILED with the original as cause', () => {
    const original = new Error('bad payload: secret-token-123')
    const caught = thrownBy(() => guardSerializer(throwing(original)).deserialize('stored-secret'))

    expect(caught).toBeInstanceOf(CacheException)
    expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.DESERIALIZATION_FAILED)
    expect((caught as CacheException).cause).toBe(original)
    expect((caught as CacheException).details).toEqual({
      error: 'the serializer could not decode the stored value',
      length: 'stored-secret'.length
    })
    expect(JSON.stringify((caught as CacheException).getResponse())).not.toContain('secret')
  })

  // The same for serialize: SERIALIZATION_FAILED, original as cause, nothing from the value.
  it('wraps a serialize throw as SERIALIZATION_FAILED with the original as cause', () => {
    const original = new Error('cannot encode secret-token-123')
    const caught = thrownBy(() => guardSerializer(throwing(original)).serialize({ a: 1 }))

    expect(caught).toBeInstanceOf(CacheException)
    expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.SERIALIZATION_FAILED)
    expect((caught as CacheException).cause).toBe(original)
    expect((caught as CacheException).details).toEqual({
      error: 'the serializer could not encode the value'
    })
    expect(JSON.stringify((caught as CacheException).getResponse())).not.toContain('secret')
  })

  // A value thrown that is not an Error is kept as the cause as it came.
  it('keeps a non-Error throw as the cause', () => {
    const caught = thrownBy(() => guardSerializer(throwing('plain string')).deserialize('x'))

    expect((caught as CacheException).cause).toBe('plain string')
  })

  // A falsy thrown value is a cause like any other: Nest drops a falsy one, so the exception keeps it itself.
  it.each([0, '', false, null])('keeps a falsy throw %p as the cause', (thrown) => {
    const caught = thrownBy(() => guardSerializer(throwing(thrown)).deserialize('x'))

    expect((caught as CacheException).cause).toBe(thrown)
  })

  // A CacheException from the serializer (the default JSON one throws these) is not wrapped again.
  it('passes a CacheException through unchanged', () => {
    const own = new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, { error: 'x' })

    expect(thrownBy(() => guardSerializer(throwing(own)).deserialize('x'))).toBe(own)
    expect(thrownBy(() => guardSerializer(throwing(own)).serialize(1))).toBe(own)
  })

  // The wrapper delegates results untouched and calls the serializer as a method of its own object.
  it('returns the serializer results and keeps `this`', () => {
    const inner = {
      prefix: '<',
      serialize<T>(this: { prefix: string }, value: T): string {
        return this.prefix + String(value)
      },
      deserialize<T>(this: { prefix: string }, raw: string): T {
        return (this.prefix + raw) as T
      }
    }
    const guarded = guardSerializer(inner)

    expect(guarded.serialize(7)).toBe('<7')
    expect(guarded.deserialize<string>('a')).toBe('<a')
  })
})
