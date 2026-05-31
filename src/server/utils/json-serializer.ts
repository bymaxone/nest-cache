/**
 * Default JSON value serializer.
 *
 * Layer: server. The out-of-the-box {@link ISerializer} implementation used when
 * the consumer supplies neither `options.serializer` nor a custom
 * `BYMAX_CACHE_SERIALIZER` provider. Both directions fail closed: a value that
 * cannot be encoded or a payload that cannot be decoded throws a structured
 * {@link CacheException} rather than returning a partial / wrongly-typed result
 * (security invariant — CLAUDE.md §4).
 *
 * @see `docs/technical_specification.md` §6.3 — Serialization
 */
import { Injectable } from '@nestjs/common'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ISerializer } from '../interfaces/serializer.interface'

/** Longest raw payload echoed verbatim in a {@link CacheException} preview. */
const MAX_PREVIEW_LENGTH = 100

/**
 * Extracts a human-readable message from an unknown throw value.
 *
 * `JSON.stringify`/`JSON.parse` reject with `Error` subclasses, but a value's
 * `toJSON` hook can throw anything, so the non-`Error` branch is real and must
 * stay. Shared by both directions so the message-shaping logic lives once.
 *
 * @param err - The caught throw value (`Error`, string, or anything else).
 * @returns The error message, or `String(err)` when it is not an `Error`.
 */
const extractErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * `ISerializer` backed by `JSON.stringify` / `JSON.parse`.
 *
 * JSON limitations the consumer must account for:
 * - `Date` becomes an ISO string — rehydrate on read if a `Date` is needed.
 * - `Map`, `Set`, `BigInt`, and `undefined` are NOT preserved.
 * - `Buffer` is encoded as a verbose `{ type: 'Buffer', data: [...] }` object.
 *
 * Consumers needing a structure-preserving codec (MessagePack, CBOR, protobuf)
 * implement {@link ISerializer} directly — see the spec §6.3 MessagePack example.
 *
 * @example
 * ```ts
 * const s = new JsonSerializer()
 * s.serialize({ a: 1 })          // '{"a":1}'
 * s.deserialize<{ a: number }>('{"a":1}') // { a: 1 }
 * ```
 */
@Injectable()
export class JsonSerializer implements ISerializer {
  /**
   * Encodes a value as a JSON string.
   *
   * @typeParam T - The value's static type.
   * @param value - The value to encode.
   * @returns The JSON string representation.
   * @throws {CacheException} `SERIALIZATION_FAILED` when the value cannot be
   *   stringified. This covers `JSON.stringify` throwing (circular reference,
   *   `BigInt`) AND the silent cases where a top-level `undefined`, function, or
   *   `symbol` would make `JSON.stringify` return the JS value `undefined`
   *   instead of a string. The original message is attached under
   *   `details.error`; the value itself is never echoed, as it may carry secrets
   *   (CLAUDE.md §4).
   */
  serialize<T>(value: T): string {
    // `JSON.stringify(undefined)`, `JSON.stringify(() => {})`, and
    // `JSON.stringify(Symbol())` all return the JS value `undefined` (not a
    // string) WITHOUT throwing, which would escape the try/catch and break both
    // the `string` return contract and the fail-closed invariant (CLAUDE.md §4).
    // Reject those top-level cases up front; nested undefined/function/symbol
    // members remain valid JSON and pass through untouched.
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      throw new CacheException(CACHE_ERROR_CODES.SERIALIZATION_FAILED, {
        error: 'Cannot serialize a top-level undefined, function, or symbol value'
      })
    }
    try {
      return JSON.stringify(value)
    } catch (err) {
      throw new CacheException(CACHE_ERROR_CODES.SERIALIZATION_FAILED, {
        error: extractErrorMessage(err)
      })
    }
  }

  /**
   * Decodes a JSON string back into a value.
   *
   * Fails closed: a malformed payload throws instead of returning `undefined`
   * or a partial value, so a corrupted cache entry can never masquerade as a
   * valid `T` (security invariant — CLAUDE.md §4).
   *
   * @typeParam T - The expected decoded type.
   * @param raw - The JSON string to decode.
   * @returns The decoded value, typed as `T`.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when `raw` is not valid
   *   JSON. `details.preview` carries at most {@link MAX_PREVIEW_LENGTH}
   *   characters of `raw` (truncated with an ellipsis) to aid debugging without
   *   leaking a large payload that may contain PII.
   */
  deserialize<T>(raw: string): T {
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      throw new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, {
        error: extractErrorMessage(err),
        preview:
          raw.length > MAX_PREVIEW_LENGTH ? `${raw.substring(0, MAX_PREVIEW_LENGTH)}...` : raw
      })
    }
  }
}
