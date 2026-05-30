/**
 * Value serialization strategy contract.
 *
 * Layer: server. Lets a consumer swap the default JSON serializer for a custom
 * codec (e.g. MessagePack, a schema-aware encoder) without changing call sites.
 */

/**
 * Strategy for serializing/deserializing cache values.
 *
 * Implementations MUST be deterministic and MUST throw on malformed input
 * during `deserialize` — never return `undefined` or a partial value. The cache
 * service catches that throw and wraps it as a `CacheException` so deserialization
 * fails closed (security invariant — see CLAUDE.md §4).
 */
export interface ISerializer {
  /**
   * Encodes a value to its string representation.
   *
   * @param value - The value to encode.
   * @returns The serialized string.
   * @throws If the value cannot be serialized.
   */
  serialize<T>(value: T): string
  /**
   * Decodes a string back into a value.
   *
   * @param raw - The serialized string.
   * @returns The decoded value, typed as `T`.
   * @throws If `raw` is malformed (must fail closed, never return partial data).
   */
  deserialize<T>(raw: string): T
}
