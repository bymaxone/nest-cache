/**
 * @fileoverview The hash and set commands of {@link CacheService}, kept in their own file so the
 * facade stays under the file-length limit. `CacheService` extends this class and supplies the
 * client, the key builder, the serializer and the operation tracking it needs.
 * @layer server/services
 */

import type {
  CacheOperationName,
  CacheOperationOutcome
} from '../../shared/types/cache-event.types'
import type { ConnectionManager } from '../connection/connection.manager'
import type { ReadOptions } from '../interfaces/read-options.interface'
import type { ISerializer } from '../interfaces/serializer.interface'
import type { KeyBuilder } from '../utils/key-builder'
import { found } from '../utils/track-operation'

/**
 * The hash and set commands; not constructed on its own, and not a supported extension point.
 * `CacheService` extends it, and every member it needs from the facade is protected and may change
 * without notice.
 */
export abstract class CacheCollectionCommands {
  /**
   * Composes every namespaced key.
   *
   * @internal
   */
  protected abstract readonly keyBuilder: KeyBuilder

  /**
   * The serializer every value goes through.
   *
   * @internal
   */
  protected abstract readonly serializer: ISerializer

  /**
   * The client every command goes through.
   *
   * @internal
   */
  protected abstract client(): ReturnType<ConnectionManager['getClient']>

  /**
   * Runs one command and reports how it ended.
   *
   * @internal
   */
  protected abstract track<T>(
    operation: CacheOperationName,
    run: () => Promise<T>,
    classify?: (result: T) => CacheOperationOutcome
  ): Promise<T>

  /**
   * Decodes one stored payload and applies the caller's validator.
   *
   * @internal
   */
  protected abstract decode<T>(
    raw: string,
    options: ReadOptions<T> | undefined,
    location?: Record<string, unknown>
  ): Promise<T>

  // ─── Hash commands ─────────────────────────────────────────────────────────

  /**
   * Reads one hash field and deserializes its value.
   *
   * @typeParam T - The expected decoded type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @param field - Hash field name (kept raw, never serialized).
   * @returns The decoded field value, or `null` when the field does not exist.
   * @param options - Optional read options; `validate` is applied to the decoded field value.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when the field payload is
   *   not decodable as `T`, and `VALIDATION_FAILED` when `validate` is given and the value does not
   *   satisfy it.
   */
  async hget<T>(
    prefix: string,
    id: string,
    field: string,
    options?: ReadOptions<T>
  ): Promise<T | null> {
    // Whether Redis returned a payload, not whether it decodes to a value: the JSON text `null` is a hit.
    let present = false
    return await this.track(
      'hget',
      async () => {
        const key = this.keyBuilder.build(prefix, id)
        const raw = await this.client().hget(key, field)
        if (raw === null) {
          return null
        }
        present = true
        return await this.decode<T>(raw, options)
      },
      () => found(present)
    )
  }

  /**
   * Serializes and writes one hash field.
   *
   * @typeParam T - The value's static type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @param field - Hash field name (kept raw, never serialized).
   * @param value - The value to store (passed through the serializer).
   * @returns `1` when the field is new, `0` when it overwrote an existing field.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `value` cannot be encoded.
   */
  async hset<T>(prefix: string, id: string, field: string, value: T): Promise<number> {
    return await this.track('hset', async () => {
      const key = this.keyBuilder.build(prefix, id)
      return await this.client().hset(key, field, this.serializer.serialize(value))
    })
  }

  /**
   * Reads every field of a hash and deserializes each value.
   *
   * @typeParam T - The expected decoded type of every field value.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @returns A record of field → decoded value; `{}` when the hash does not exist.
   * @param options - Optional read options; `validate` is applied to every field value.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when any field payload is
   *   not decodable as `T`, and `VALIDATION_FAILED` (naming `details.field`) for the first field
   *   that does not satisfy `validate`.
   */
  async hgetall<T>(
    prefix: string,
    id: string,
    options?: ReadOptions<T>
  ): Promise<Record<string, T>> {
    return await this.track(
      'hgetall',
      async () => {
        const key = this.keyBuilder.build(prefix, id)
        const all = await this.client().hgetall(key)
        // Build the record via fromEntries rather than a dynamic `result[field] = …`
        // write — the latter is a flagged object-injection sink (security plugin).
        const entries: Array<[string, T]> = []
        for (const [field, raw] of Object.entries(all)) {
          entries.push([field, await this.decode<T>(raw, options, { field })])
        }
        return Object.fromEntries(entries)
      },
      (all) => found(Object.keys(all).length > 0)
    )
  }

  /**
   * Deletes one or more hash fields.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @param fields - Field names to delete. No fields is a no-op (no Redis call).
   * @returns The number of fields actually removed.
   */
  async hdel(prefix: string, id: string, ...fields: readonly string[]): Promise<number> {
    // No command is sent, so nothing is reported either.
    if (fields.length === 0) {
      return 0
    }
    return await this.track('hdel', async () => {
      const key = this.keyBuilder.build(prefix, id)
      return await this.client().hdel(key, ...fields)
    })
  }

  // ─── Set commands ──────────────────────────────────────────────────────────

  /**
   * Adds members to a set.
   *
   * Members are stored as raw strings — sets hold ids, not serialized objects,
   * so the serializer is intentionally not applied here.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @param members - String members to add. No members is a no-op (no Redis call).
   * @returns The number of members newly added (excludes ones already present).
   */
  async sadd(prefix: string, id: string, ...members: readonly string[]): Promise<number> {
    if (members.length === 0) {
      return 0
    }
    return await this.track('sadd', async () => {
      return await this.client().sadd(this.keyBuilder.build(prefix, id), ...members)
    })
  }

  /**
   * Removes members from a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @param members - String members to remove. No members is a no-op (no Redis call).
   * @returns The number of members actually removed.
   */
  async srem(prefix: string, id: string, ...members: readonly string[]): Promise<number> {
    if (members.length === 0) {
      return 0
    }
    return await this.track('srem', async () => {
      return await this.client().srem(this.keyBuilder.build(prefix, id), ...members)
    })
  }

  /**
   * Reads every member of a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @returns The raw string members; `[]` when the set does not exist.
   */
  async smembers(prefix: string, id: string): Promise<string[]> {
    return await this.track(
      'smembers',
      async () => {
        return await this.client().smembers(this.keyBuilder.build(prefix, id))
      },
      (members) => found(members.length > 0)
    )
  }

  /**
   * Reports whether a member belongs to a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @param member - The member to test.
   * @returns `true` when the member is present, otherwise `false`.
   */
  async sismember(prefix: string, id: string, member: string): Promise<boolean> {
    return await this.track(
      'sismember',
      async () => {
        const result = await this.client().sismember(this.keyBuilder.build(prefix, id), member)
        return result === 1
      },
      found
    )
  }

  /**
   * Reads the cardinality of a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @returns The member count; `0` when the set does not exist.
   */
  async scard(prefix: string, id: string): Promise<number> {
    return await this.track('scard', async () => {
      return await this.client().scard(this.keyBuilder.build(prefix, id))
    })
  }
}
