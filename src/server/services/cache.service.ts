/**
 * Public typed cache facade.
 *
 * Layer: server. The single service consumers inject. Every method composes its
 * Redis key through {@link KeyBuilder} (structural namespace isolation), runs the
 * command on the singleton client from {@link ConnectionManager}, and encodes /
 * decodes values through the configured {@link ISerializer}. ioredis errors
 * (connection, timeout) bubble up unchanged; serialization failures surface as a
 * structured {@link CacheException}.
 *
 * Naming convention for the value commands: `(prefix, id)` always denotes the
 * entity group and entity, which {@link KeyBuilder} renders as
 * `{namespace}{sep}{prefix}{sep}{id}`. Passing an empty `prefix` or `id` to any
 * value method throws {@link CacheException} `INVALID_KEY` from the key builder.
 *
 * @see `docs/technical_specification.md` §5 — Main Service
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { ChainableCommander, Cluster, Redis } from 'ioredis'

import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER } from '../bymax-cache.constants'
import { ScriptManagerService } from './script-manager.service'
import type { ResolvedOptions } from '../config/resolved-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ISerializer } from '../interfaces/serializer.interface'
import { KeyBuilder } from '../utils/key-builder'
import { resolveSerializer } from '../utils/resolve-serializer'

/** Production value of `NODE_ENV` that gates the destructive flush guard. */
const PRODUCTION_ENV = 'production'

/** SCAN batch hint for the iterating helpers (`scan`, `flushNamespace`). */
const SCAN_COUNT = 100

/** Larger SCAN batch hint for the bulk delete path. */
const FLUSH_SCAN_COUNT = 1000

/**
 * Type guard narrowing the managed client to a standalone/sentinel `Redis` — the
 * only topology with a usable top-level `scanStream` cursor. Cluster exposes no
 * plain `scanStream` (its scan must be fanned out per node), so the SCAN-based
 * helpers reject it. Centralizing the narrowing here keeps `scan` / `flushNamespace`
 * free of inline type assertions while staying robust to a shadowed/undefined
 * `scanStream` (a single expression — no branch — so coverage is exercised purely
 * at the call site's guard).
 *
 * @param client - The managed ioredis client (standalone/sentinel or cluster).
 * @returns `true` when `client` is a scannable `Redis`.
 */
const isScannableClient = (client: Redis | Cluster): client is Redis =>
  typeof (client as Redis).scanStream === 'function'

@Injectable()
export class CacheService {
  /** Resolved serializer: explicit option wins, then injected token, then JSON. */
  private readonly serializer: ISerializer

  /**
   * @param options - Resolved module options (frozen). Supplies `serializer`
   *   and `allowFlushInProduction`.
   * @param connection - Owns the singleton ioredis client every command runs on.
   * @param keyBuilder - Composes every namespaced key.
   * @param injectedSerializer - Optional `BYMAX_CACHE_SERIALIZER` provider; used
   *   only when `options.serializer` is absent. `@Optional()` so the token may be
   *   unprovided in tests / minimal wirings.
   * @param scriptRegistry - Optional `ScriptManagerService`; required only for
   *   {@link CacheService.eval}. `@Optional()` so the cache works without scripts.
   */
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    // Explicit class tokens — the published bundle is built without
    // emitDecoratorMetadata, so type-only (implicit) DI cannot be resolved
    // for these providers (CLAUDE.md §5, AGENTS.md §7).
    @Inject(ConnectionManager) private readonly connection: ConnectionManager,
    @Inject(KeyBuilder) private readonly keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
    @Optional()
    @Inject(ScriptManagerService)
    private readonly scriptRegistry?: ScriptManagerService
  ) {
    this.serializer = resolveSerializer(options, injectedSerializer)
  }

  // ─── String / value commands ───────────────────────────────────────────────

  /**
   * Reads a value and deserializes it through the configured serializer.
   *
   * @typeParam T - The expected decoded type.
   * @param prefix - Entity-group prefix (e.g. `'users'`).
   * @param id - Entity id.
   * @returns The decoded value, or `null` when the key does not exist.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when the stored payload is
   *   not decodable as `T`.
   */
  async get<T>(prefix: string, id: string): Promise<T | null> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = await this.connection.getClient().get(key)
    if (raw === null) {
      return null
    }
    return this.serializer.deserialize<T>(raw)
  }

  /**
   * Reads the raw stored string without deserialization.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns The raw string, or `null` when the key does not exist.
   */
  async getRaw(prefix: string, id: string): Promise<string | null> {
    return this.connection.getClient().get(this.keyBuilder.build(prefix, id))
  }

  /**
   * Serializes and writes a value, optionally with a TTL.
   *
   * @typeParam T - The value's static type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The value to store (passed through the serializer).
   * @param ttlSeconds - Optional expiry in seconds; omit for no expiration.
   * @returns Resolves once the write completes.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `value` cannot be encoded.
   */
  async set<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<void> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    if (ttlSeconds !== undefined) {
      await this.connection.getClient().set(key, raw, 'EX', ttlSeconds)
    } else {
      await this.connection.getClient().set(key, raw)
    }
  }

  /**
   * Writes a raw string without serialization, optionally with a TTL.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The raw string to store as-is.
   * @param ttlSeconds - Optional expiry in seconds; omit for no expiration.
   * @returns Resolves once the write completes.
   */
  async setRaw(prefix: string, id: string, value: string, ttlSeconds?: number): Promise<void> {
    const key = this.keyBuilder.build(prefix, id)
    if (ttlSeconds !== undefined) {
      await this.connection.getClient().set(key, value, 'EX', ttlSeconds)
    } else {
      await this.connection.getClient().set(key, value)
    }
  }

  /**
   * Atomically writes a value only if the key does not already exist (`SET NX`).
   *
   * @typeParam T - The value's static type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The value to store (passed through the serializer).
   * @param ttlSeconds - Optional expiry in seconds applied on the same atomic write.
   * @returns `true` when the value was stored, `false` when the key already existed.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `value` cannot be encoded.
   */
  async setNx<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = this.serializer.serialize(value)
    const result =
      ttlSeconds !== undefined
        ? await this.connection.getClient().set(key, raw, 'EX', ttlSeconds, 'NX')
        : await this.connection.getClient().set(key, raw, 'NX')
    return result === 'OK'
  }

  /**
   * Deletes a single key.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns The number of keys removed (`0` or `1`).
   */
  async del(prefix: string, id: string): Promise<number> {
    return this.connection.getClient().del(this.keyBuilder.build(prefix, id))
  }

  /**
   * Deletes many keys under the same prefix in one round trip.
   *
   * @param prefix - Entity-group prefix shared by every id.
   * @param ids - Entity ids to delete. An empty list is a no-op (no Redis call).
   * @returns The number of keys actually removed.
   */
  async delMany(prefix: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0
    }
    const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
    return this.connection.getClient().del(...keys)
  }

  /**
   * Reports whether a key exists.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns `true` when the key exists, otherwise `false`.
   */
  async exists(prefix: string, id: string): Promise<boolean> {
    const count = await this.connection.getClient().exists(this.keyBuilder.build(prefix, id))
    return count > 0
  }

  // ─── Numeric commands ──────────────────────────────────────────────────────

  /**
   * Atomically increments a counter.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param by - Increment step. Defaults to `1` (uses `INCR`); any other value
   *   uses `INCRBY`.
   * @returns The value after the increment.
   */
  async incr(prefix: string, id: string, by = 1): Promise<number> {
    const key = this.keyBuilder.build(prefix, id)
    return by === 1
      ? this.connection.getClient().incr(key)
      : this.connection.getClient().incrby(key, by)
  }

  /**
   * Atomically decrements a counter.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param by - Decrement step. Defaults to `1` (uses `DECR`); any other value
   *   uses `DECRBY`.
   * @returns The value after the decrement.
   */
  async decr(prefix: string, id: string, by = 1): Promise<number> {
    const key = this.keyBuilder.build(prefix, id)
    return by === 1
      ? this.connection.getClient().decr(key)
      : this.connection.getClient().decrby(key, by)
  }

  // ─── Expiration commands ───────────────────────────────────────────────────

  /**
   * Sets a TTL on an existing key.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param ttlSeconds - Expiry in seconds.
   * @returns `true` when the timeout was set, `false` when the key does not exist.
   */
  async expire(prefix: string, id: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.connection
      .getClient()
      .expire(this.keyBuilder.build(prefix, id), ttlSeconds)
    return result === 1
  }

  /**
   * Reads the remaining TTL of a key.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns TTL in seconds; `-2` when the key does not exist, `-1` when it
   *   exists with no expiration.
   */
  async ttl(prefix: string, id: string): Promise<number> {
    return this.connection.getClient().ttl(this.keyBuilder.build(prefix, id))
  }

  /**
   * Removes the TTL of a key, making it persistent.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns `true` when a timeout was removed, `false` when the key has no TTL
   *   or does not exist.
   */
  async persist(prefix: string, id: string): Promise<boolean> {
    const result = await this.connection.getClient().persist(this.keyBuilder.build(prefix, id))
    return result === 1
  }

  // ─── Batch commands ────────────────────────────────────────────────────────

  /**
   * Reads many keys under the same prefix and deserializes each present value.
   *
   * @typeParam T - The expected decoded type of every value.
   * @param prefix - Entity-group prefix shared by every id.
   * @param ids - Entity ids to read. An empty list returns `[]` with no Redis call.
   * @returns Values positionally aligned with `ids`; `null` for missing keys.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when any present payload is
   *   not decodable as `T`.
   */
  async mget<T>(prefix: string, ids: readonly string[]): Promise<Array<T | null>> {
    if (ids.length === 0) {
      return []
    }
    const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
    const values = await this.connection.getClient().mget(...keys)
    return values.map((value) => (value === null ? null : this.serializer.deserialize<T>(value)))
  }

  /**
   * Writes many `[id, value]` pairs under the same prefix in one round trip.
   *
   * @typeParam T - The values' static type.
   * @param prefix - Entity-group prefix shared by every entry.
   * @param entries - `[id, value]` tuples. An empty list is a no-op (no Redis call).
   * @returns Resolves once the write completes.
   * @throws {CacheException} `SERIALIZATION_FAILED` when any value cannot be encoded.
   */
  async mset<T>(prefix: string, entries: ReadonlyArray<readonly [string, T]>): Promise<void> {
    if (entries.length === 0) {
      return
    }
    const pairs: string[] = []
    for (const [id, value] of entries) {
      pairs.push(this.keyBuilder.build(prefix, id), this.serializer.serialize(value))
    }
    await this.connection.getClient().mset(...pairs)
  }

  // ─── Hash commands ─────────────────────────────────────────────────────────

  /**
   * Reads one hash field and deserializes its value.
   *
   * @typeParam T - The expected decoded type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @param field - Hash field name (kept raw, never serialized).
   * @returns The decoded field value, or `null` when the field does not exist.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when the field payload is
   *   not decodable as `T`.
   */
  async hget<T>(prefix: string, id: string, field: string): Promise<T | null> {
    const key = this.keyBuilder.build(prefix, id)
    const raw = await this.connection.getClient().hget(key, field)
    if (raw === null) {
      return null
    }
    return this.serializer.deserialize<T>(raw)
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
    const key = this.keyBuilder.build(prefix, id)
    return this.connection.getClient().hset(key, field, this.serializer.serialize(value))
  }

  /**
   * Reads every field of a hash and deserializes each value.
   *
   * @typeParam T - The expected decoded type of every field value.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the hash key).
   * @returns A record of field → decoded value; `{}` when the hash does not exist.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when any field payload is
   *   not decodable as `T`.
   */
  async hgetall<T>(prefix: string, id: string): Promise<Record<string, T>> {
    const key = this.keyBuilder.build(prefix, id)
    const all = await this.connection.getClient().hgetall(key)
    // Build the record via fromEntries rather than a dynamic `result[field] = …`
    // write — the latter is a flagged object-injection sink (security plugin).
    const entries = Object.entries(all).map(([field, raw]): [string, T] => [
      field,
      this.serializer.deserialize<T>(raw)
    ])
    return Object.fromEntries(entries)
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
    if (fields.length === 0) {
      return 0
    }
    const key = this.keyBuilder.build(prefix, id)
    return this.connection.getClient().hdel(key, ...fields)
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
    return this.connection.getClient().sadd(this.keyBuilder.build(prefix, id), ...members)
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
    return this.connection.getClient().srem(this.keyBuilder.build(prefix, id), ...members)
  }

  /**
   * Reads every member of a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @returns The raw string members; `[]` when the set does not exist.
   */
  async smembers(prefix: string, id: string): Promise<string[]> {
    return this.connection.getClient().smembers(this.keyBuilder.build(prefix, id))
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
    const result = await this.connection
      .getClient()
      .sismember(this.keyBuilder.build(prefix, id), member)
    return result === 1
  }

  /**
   * Reads the cardinality of a set.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id (the set key).
   * @returns The member count; `0` when the set does not exist.
   */
  async scard(prefix: string, id: string): Promise<number> {
    return this.connection.getClient().scard(this.keyBuilder.build(prefix, id))
  }

  // ─── Iteration ─────────────────────────────────────────────────────────────

  /**
   * Lists keys matching a pattern under a prefix.
   *
   * WARNING: `KEYS` is O(N) and BLOCKS the Redis server for the whole scan —
   * prefer {@link CacheService.scan} in production.
   *
   * @param prefix - Entity-group prefix.
   * @param pattern - Glob pattern for the id segment, e.g. `'*'`.
   * @returns The matching fully-namespaced keys.
   * @example
   * ```ts
   * await cache.keys('users', '*') // ['app:users:u_1', 'app:users:u_2']
   * ```
   */
  async keys(prefix: string, pattern: string): Promise<string[]> {
    const fullPattern = this.keyBuilder.build(prefix, pattern)
    return this.connection.getClient().keys(fullPattern)
  }

  /**
   * Iterates keys matching a pattern under a prefix using a non-blocking cursor.
   *
   * Safe for production: `SCAN` never blocks the server. Standalone / sentinel
   * only — Cluster exposes different scan semantics and is rejected.
   *
   * @param prefix - Entity-group prefix.
   * @param pattern - Glob pattern for the id segment, e.g. `'*'`.
   * @param count - Per-batch hint passed to `SCAN` (not a hard limit).
   * @returns An async iterable of fully-namespaced keys.
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` when called in cluster mode
   *   (no usable top-level `scanStream`).
   * @example
   * ```ts
   * for await (const key of cache.scan('users', '*')) {
   *   // key === 'app:users:u_1'
   * }
   * ```
   */
  async *scan(prefix: string, pattern: string, count = SCAN_COUNT): AsyncIterable<string> {
    const fullPattern = this.keyBuilder.build(prefix, pattern)
    const client = this.connection.getClient()
    if (!isScannableClient(client)) {
      throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, { operation: 'scan' })
    }
    const stream = client.scanStream({ match: fullPattern, count })
    for await (const chunk of stream) {
      for (const key of chunk as string[]) {
        // ScanStream pushes string[] batches — ioredis internal contract
        yield key
      }
    }
  }

  // ─── Pipeline / escape hatch ───────────────────────────────────────────────

  /**
   * Opens an ioredis pipeline for batching arbitrary commands.
   *
   * NOTE: keys passed to pipeline commands are NOT auto-namespaced — compose
   * them through {@link KeyBuilder} yourself.
   *
   * @returns A chainable commander; call `.exec()` to flush.
   * @example
   * ```ts
   * const pipe = cache.pipeline()
   * pipe.set(keyBuilder.build('p', 'a'), '1')
   * pipe.set(keyBuilder.build('p', 'b'), '2')
   * await pipe.exec()
   * ```
   */
  pipeline(): ChainableCommander {
    return this.connection.getClient().pipeline()
  }

  /**
   * Returns the raw ioredis client (escape hatch).
   *
   * Keys used through the returned client are NOT auto-namespaced. Reach for
   * this only to run a command this facade does not expose.
   *
   * @returns The singleton ioredis client.
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` when called in cluster
   *   mode — `Cluster` does not share the full `Redis` API surface.
   */
  getClient(): Redis {
    const client = this.connection.getClient()
    if (!isScannableClient(client)) {
      throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, { operation: 'getClient' })
    }
    return client
  }

  // ─── Destructive maintenance ───────────────────────────────────────────────

  /**
   * Deletes EVERY key under the configured namespace via `SCAN` + `UNLINK`.
   *
   * Uses `UNLINK` (asynchronous reclaim) rather than `DEL` so a large keyset
   * does not block the server. The `SCAN` pattern is scoped to
   * `{namespace}{sep}*`, so keys of other namespaces are never touched.
   *
   * SAFETY: throws {@link CacheException} `FLUSH_DISABLED_IN_PRODUCTION` when
   * `NODE_ENV === 'production'` unless `options.allowFlushInProduction` is `true`.
   * Intended for tests and tooling — in production prefer
   * {@link CacheService.del} / {@link CacheService.delMany}.
   *
   * @returns The total number of keys removed.
   * @throws {CacheException} `FLUSH_DISABLED_IN_PRODUCTION` under the production guard.
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` when called in cluster mode
   *   (no usable top-level `scanStream`).
   */
  async flushNamespace(): Promise<number> {
    if (process.env['NODE_ENV'] === PRODUCTION_ENV && !this.options.allowFlushInProduction) {
      throw new CacheException(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION)
    }

    const client = this.connection.getClient()
    if (!isScannableClient(client)) {
      throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, {
        operation: 'flushNamespace'
      })
    }

    const pattern = `${this.keyBuilder.getNamespacePrefix()}*`
    const stream = client.scanStream({ match: pattern, count: FLUSH_SCAN_COUNT })
    let total = 0

    for await (const chunk of stream) {
      const keys = chunk as string[] // ScanStream pushes string[] batches — ioredis internal contract
      if (keys.length > 0) {
        total += await client.unlink(...keys)
      }
    }
    return total
  }

  // ─── Lua scripts ───────────────────────────────────────────────────────────

  /**
   * Executes a Lua script registered with the {@link ScriptManagerService}. The
   * `keys` are namespaced before reaching Redis (the same isolation guarantee as
   * every other command); `args` are passed through untouched.
   *
   * @param scriptName - Name the script was registered under (via `options.scripts`
   *   or `ScriptManagerService.register`).
   * @param keys - `KEYS[]` (bare; namespaced here before execution).
   * @param args - `ARGV[]` for the script.
   * @returns The script's return value, typed `unknown` (Redis Lua is dynamic).
   * @throws {CacheException} `SCRIPT_REGISTRY_MISSING` when no script manager is
   *   wired (the module always wires one; this guards manual instantiations).
   * @throws {CacheException} `SCRIPT_NOT_REGISTERED` / `SCRIPT_EXECUTION_FAILED`
   *   propagated from the script manager.
   * @example
   * ```ts
   * const swapped = (await cache.eval('compareAndSet', ['session:abc'], ['v1', 'v2'])) as number
   * ```
   */
  async eval(
    scriptName: string,
    keys: readonly string[],
    args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    if (!this.scriptRegistry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
    }
    const namespacedKeys = keys.map((key) => this.keyBuilder.applyNamespace(key))
    return this.scriptRegistry.eval(scriptName, namespacedKeys, args)
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  /**
   * Reports whether Redis answers `PING`. Never throws — a connection failure
   * resolves to `false`, making it safe to wire directly into a health endpoint
   * (e.g. `@nestjs/terminus`).
   *
   * @returns `true` when the server replies `PONG`, otherwise `false`.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.connection.getClient().ping()
      return pong === 'PONG'
    } catch {
      return false
    }
  }

  /**
   * Sends a raw `PING`. Unlike {@link CacheService.isHealthy}, this propagates a
   * connection failure — use it when the caller wants to handle the error.
   *
   * @returns `'PONG'` on a healthy connection.
   * @throws The underlying ioredis error when the connection is down.
   */
  async ping(): Promise<string> {
    return this.connection.getClient().ping()
  }

  /**
   * Returns the Redis `INFO` output, optionally scoped to a single section.
   *
   * @param section - Optional section name (e.g. `'memory'`, `'clients'`,
   *   `'replication'`); omit for the full report.
   * @returns The `INFO` text.
   */
  async info(section?: string): Promise<string> {
    const client = this.connection.getClient()
    return section === undefined ? client.info() : client.info(section)
  }
}
