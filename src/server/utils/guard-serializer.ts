/**
 * Fail-closed wrapper for the serializer a service uses.
 *
 * Layer: server. A custom `ISerializer` is a consumer's code, and whatever it throws is that code's own
 * error. The `ISerializer` contract promises a `CacheException` instead, so a host catches one type and
 * the error envelope keys on its code. This wraps every throw that is not already one, with fixed
 * details (never a byte of the value, since a codec's message often quotes its input) and the original
 * error kept as `cause`.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ISerializer } from '../interfaces/serializer.interface'

/** Fixed `details.error` of a failed encode. */
const SERIALIZATION_ERROR = 'the serializer could not encode the value'

/** Fixed `details.error` of a failed decode. */
const DESERIALIZATION_ERROR = 'the serializer could not decode the stored value'

/**
 * Returns a serializer that delegates to `inner` and turns anything it throws into a `CacheException`.
 *
 * A `CacheException` thrown by `inner` (the default JSON serializer throws them) passes through
 * unchanged. Every other throw becomes `SERIALIZATION_FAILED` or `DESERIALIZATION_FAILED`, with the
 * original as `cause` and details holding a fixed text, plus the length of the stored value on decode.
 *
 * @param inner - The serializer to guard.
 * @returns A serializer with the same results and a `CacheException`-only failure mode.
 */
export function guardSerializer(inner: ISerializer): ISerializer {
  return {
    serialize<T>(value: T): string {
      try {
        return inner.serialize(value)
      } catch (error) {
        if (error instanceof CacheException) {
          throw error
        }
        throw new CacheException(
          CACHE_ERROR_CODES.SERIALIZATION_FAILED,
          { error: SERIALIZATION_ERROR },
          undefined,
          error
        )
      }
    },
    deserialize<T>(raw: string): T {
      try {
        return inner.deserialize<T>(raw)
      } catch (error) {
        if (error instanceof CacheException) {
          throw error
        }
        throw new CacheException(
          CACHE_ERROR_CODES.DESERIALIZATION_FAILED,
          { error: DESERIALIZATION_ERROR, length: raw.length },
          undefined,
          error
        )
      }
    }
  }
}
