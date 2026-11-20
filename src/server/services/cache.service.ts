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

import type {
  CacheOperationName,
  CacheOperationOutcome
} from '../../shared/types/cache-event.types'
import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER } from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ReadOptions } from '../interfaces/read-options.interface'
import type { ISerializer } from '../interfaces/serializer.interface'
import { chunkOf, MAX_COMMAND_ARGUMENTS } from '../utils/chunk'
import { execTransaction } from '../utils/exec-transaction'
import { guardClient } from '../utils/guard-client'
import { guardSerializer } from '../utils/guard-serializer'
import { KeyBuilder } from '../utils/key-builder'
import { resolveSerializer } from '../utils/resolve-serializer'
import { found, reportOperation, trackOperation } from '../utils/track-operation'
import { assertTtlSeconds, MIN_WRITE_TTL_SECONDS } from '../utils/ttl'
import { validateRead } from '../utils/validate-read'
import { CacheCollectionCommands } from './cache-collection-commands'
import { ScriptManagerService } from './script-manager.service'

/** Production value of `NODE_ENV` that gates the destructive flush guard. */
const PRODUCTION_ENV = 'production'

/** SCAN batch hint for the iterating helpers (`scan`, `flushNamespace`). */
const SCAN_COUNT = 100

/** Largest `COUNT` hint a `scan` call passes to Redis. */
const MAX_SCAN_COUNT = 10_000

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
export class CacheService extends CacheCollectionCommands {
  /**
   * Resolved serializer: explicit option wins, then injected token, then JSON.
   *
   * @internal
   */
  protected readonly serializer: ISerializer

  /**
   * Composes every namespaced key.
   *
   * @internal
   */
  protected readonly keyBuilder: KeyBuilder

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
    @Inject(KeyBuilder) keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
    @Optional()
    @Inject(ScriptManagerService)
    private readonly scriptRegistry?: ScriptManagerService
  ) {
    super()
    this.keyBuilder = keyBuilder
    this.serializer = guardSerializer(resolveSerializer(options, injectedSerializer))
  }

  /**
   * The client every command goes through, wrapped so a timed-out command reports `COMMAND_TIMEOUT`.
   *
   * @returns The connection's client behind the timeout mapping.
   * @internal
   */
  protected client(): ReturnType<ConnectionManager['getClient']> {
    return guardClient(this.connection.getClient())
  }

  /**
   * Runs one command and reports how it ended; see {@link trackOperation}.
   *
   * @internal
   */
  protected track<T>(
    operation: CacheOperationName,
    run: () => Promise<T>,
    classify?: (result: T) => CacheOperationOutcome
  ): Promise<T> {
    return trackOperation(this.options.events, operation, run, classify)
  }

  // ─── String / value commands ───────────────────────────────────────────────

  /**
   * Reads a value and deserializes it through the configured serializer.
   *
   * @typeParam T - The expected decoded type.
   * @param prefix - Entity-group prefix (e.g. `'users'`).
   * @param id - Entity id.
   * @returns The decoded value, or `null` when the key does not exist.
   * @param options - Optional read options. `validate` checks the decoded value against a type
   *   predicate or a Standard Schema validator; with none, the value is returned as decoded.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when the stored payload is
   *   not decodable as `T`, and `VALIDATION_FAILED` when `validate` is given and the decoded value
   *   does not satisfy it (the entry is left in place).
   */
  async get<T>(prefix: string, id: string, options?: ReadOptions<T>): Promise<T | null> {
    // Whether Redis returned a payload, not whether it decodes to a value: the JSON text `null` is a hit.
    let present = false
    return this.track(
      'get',
      async () => {
        const key = this.keyBuilder.build(prefix, id)
        const raw = await this.client().get(key)
        if (raw === null) {
          return null
        }
        present = true
        return this.decode<T>(raw, options)
      },
      () => found(present)
    )
  }

  /**
   * Reads the raw stored string without deserialization.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns The raw string, or `null` when the key does not exist.
   */
  async getRaw(prefix: string, id: string): Promise<string | null> {
    return this.track(
      'getRaw',
      async () => {
        return this.client().get(this.keyBuilder.build(prefix, id))
      },
      (value) => found(value !== null)
    )
  }

  /**
   * Serializes and writes a value, optionally with a TTL.
   *
   * @typeParam T - The value's static type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The value to store (passed through the serializer).
   * @param ttlSeconds - Optional expiry in seconds, a safe integer of at least 1; omit for
   *   no expiration.
   * @returns Resolves once the write completes.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `value` cannot be encoded.
   * @throws {CacheException} `INVALID_TTL` when `ttlSeconds` is not a safe integer of at least 1.
   */
  async set<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<void> {
    return this.track('set', async () => {
      const key = this.keyBuilder.build(prefix, id)
      const raw = this.serializer.serialize(value)
      if (ttlSeconds !== undefined) {
        assertTtlSeconds(ttlSeconds, MIN_WRITE_TTL_SECONDS)
        await this.client().set(key, raw, 'EX', ttlSeconds)
      } else {
        await this.client().set(key, raw)
      }
    })
  }

  /**
   * Writes a raw string without serialization, optionally with a TTL.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The raw string to store as-is.
   * @param ttlSeconds - Optional expiry in seconds, a safe integer of at least 1; omit for
   *   no expiration.
   * @returns Resolves once the write completes.
   * @throws {CacheException} `INVALID_TTL` when `ttlSeconds` is not a safe integer of at least 1.
   */
  async setRaw(prefix: string, id: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.track('setRaw', async () => {
      const key = this.keyBuilder.build(prefix, id)
      if (ttlSeconds !== undefined) {
        assertTtlSeconds(ttlSeconds, MIN_WRITE_TTL_SECONDS)
        await this.client().set(key, value, 'EX', ttlSeconds)
      } else {
        await this.client().set(key, value)
      }
    })
  }

  /**
   * Atomically writes a value only if the key does not already exist (`SET NX`).
   *
   * @typeParam T - The value's static type.
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param value - The value to store (passed through the serializer).
   * @param ttlSeconds - Optional expiry in seconds applied on the same atomic write, a safe
   *   integer of at least 1.
   * @returns `true` when the value was stored, `false` when the key already existed.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `value` cannot be encoded.
   * @throws {CacheException} `INVALID_TTL` when `ttlSeconds` is not a safe integer of at least 1.
   */
  async setNx<T>(prefix: string, id: string, value: T, ttlSeconds?: number): Promise<boolean> {
    return this.track('setNx', async () => {
      const key = this.keyBuilder.build(prefix, id)
      const raw = this.serializer.serialize(value)
      if (ttlSeconds !== undefined) assertTtlSeconds(ttlSeconds, MIN_WRITE_TTL_SECONDS)
      const result =
        ttlSeconds !== undefined
          ? await this.client().set(key, raw, 'EX', ttlSeconds, 'NX')
          : await this.client().set(key, raw, 'NX')
      return result === 'OK'
    })
  }

  /**
   * Deletes a single key.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns The number of keys removed (`0` or `1`).
   */
  async del(prefix: string, id: string): Promise<number> {
    return this.track('del', async () => {
      return this.client().del(this.keyBuilder.build(prefix, id))
    })
  }

  /**
   * Deletes many keys under the same prefix.
   *
   * @param prefix - Entity-group prefix shared by every id.
   * @param ids - Entity ids to delete. An empty list is a no-op (no Redis call).
   * @returns The number of keys actually removed.
   */
  async delMany(prefix: string, ids: readonly string[]): Promise<number> {
    return this.track('delMany', async () => {
      const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
      let removed = 0
      for (const part of chunkOf(keys, MAX_COMMAND_ARGUMENTS)) {
        removed += await this.client().del(...part)
      }
      return removed
    })
  }

  /**
   * Reports whether a key exists.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @returns `true` when the key exists, otherwise `false`.
   */
  async exists(prefix: string, id: string): Promise<boolean> {
    return this.track(
      'exists',
      async () => {
        const count = await this.client().exists(this.keyBuilder.build(prefix, id))
        return count > 0
      },
      found
    )
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
    return this.track('incr', async () => {
      const key = this.keyBuilder.build(prefix, id)
      return by === 1 ? this.client().incr(key) : this.client().incrby(key, by)
    })
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
    return this.track('decr', async () => {
      const key = this.keyBuilder.build(prefix, id)
      return by === 1 ? this.client().decr(key) : this.client().decrby(key, by)
    })
  }

  // ─── Expiration commands ───────────────────────────────────────────────────

  /**
   * Sets a TTL on an existing key.
   *
   * @param prefix - Entity-group prefix.
   * @param id - Entity id.
   * @param ttlSeconds - Expiry in seconds, a safe integer. As in Redis, zero or a negative
   *   value deletes the key.
   * @returns `true` when the timeout was set, `false` when the key does not exist.
   * @throws {CacheException} `INVALID_TTL` when `ttlSeconds` is not a safe integer.
   */
  async expire(prefix: string, id: string, ttlSeconds: number): Promise<boolean> {
    return this.track('expire', async () => {
      assertTtlSeconds(ttlSeconds, undefined)
      const result = await this.client().expire(this.keyBuilder.build(prefix, id), ttlSeconds)
      return result === 1
    })
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
    return this.track('ttl', async () => {
      return this.client().ttl(this.keyBuilder.build(prefix, id))
    })
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
    return this.track('persist', async () => {
      const result = await this.client().persist(this.keyBuilder.build(prefix, id))
      return result === 1
    })
  }

  // ─── Batch commands ────────────────────────────────────────────────────────

  /**
   * Reads many keys under the same prefix and deserializes each present value.
   *
   * @typeParam T - The expected decoded type of every value.
   * @param prefix - Entity-group prefix shared by every id.
   * @param ids - Entity ids to read. An empty list returns `[]` with no Redis call.
   * @returns Values positionally aligned with `ids`; `null` for missing keys.
   * @param options - Optional read options; `validate` is applied to every present value.
   * @throws {CacheException} `DESERIALIZATION_FAILED` when any present payload is
   *   not decodable as `T`, and `VALIDATION_FAILED` (naming `details.index`) for the first present
   *   value that does not satisfy `validate`.
   */
  async mget<T>(
    prefix: string,
    ids: readonly string[],
    options?: ReadOptions<T>
  ): Promise<Array<T | null>> {
    // As for `get`: a payload that decodes to `null` is still a hit. Set before the classifier runs.
    let present: boolean
    return this.track(
      'mget',
      async () => {
        const keys = ids.map((id) => this.keyBuilder.build(prefix, id))
        const values: Array<string | null> = []
        for (const part of chunkOf(keys, MAX_COMMAND_ARGUMENTS)) {
          values.push(...(await this.client().mget(...part)))
        }
        present = values.some((value) => value !== null)
        const decoded: Array<T | null> = []
        // One at a time, in order, so the element a failure names is the first bad one.
        for (const [index, value] of values.entries()) {
          decoded.push(value === null ? null : await this.decode<T>(value, options, { index }))
        }
        return decoded
      },
      () => found(present)
    )
  }

  /**
   * Writes many `[id, value]` pairs under the same prefix.
   *
   * @typeParam T - The values' static type.
   * @param prefix - Entity-group prefix shared by every entry.
   * @param entries - `[id, value]` tuples. An empty list is a no-op (no Redis call).
   * @returns Resolves once the write completes.
   * @throws {CacheException} `SERIALIZATION_FAILED` when any value cannot be encoded.
   */
  async mset<T>(prefix: string, entries: ReadonlyArray<readonly [string, T]>): Promise<void> {
    return this.track('mset', async () => {
      if (entries.length === 0) {
        return
      }
      const pairs: string[] = []
      for (const [id, value] of entries) {
        pairs.push(this.keyBuilder.build(prefix, id), this.serializer.serialize(value))
      }
      if (pairs.length <= MAX_COMMAND_ARGUMENTS) {
        await this.client().mset(...pairs)
        return
      }
      const transaction = this.client().multi()
      for (const part of chunkOf(pairs, MAX_COMMAND_ARGUMENTS)) {
        transaction.mset(...part)
      }
      await execTransaction(transaction)
    })
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
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` when called in cluster mode:
   *   `KEYS` carries no key, so the cluster client sends it to one sampled node and the
   *   reply would cover only that node's share of the keyspace.
   * @example
   * ```ts
   * await cache.keys('users', '*') // ['app:users:u_1', 'app:users:u_2']
   * ```
   */
  async keys(prefix: string, pattern: string): Promise<string[]> {
    return this.track('keys', async () => {
      const fullPattern = this.keyBuilder.buildPattern(prefix, pattern)
      const client = this.client()
      if (!isScannableClient(client)) {
        throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, { operation: 'keys' })
      }
      return client.keys(fullPattern)
    })
  }

  /**
   * Iterates keys matching a pattern under a prefix using a non-blocking cursor.
   *
   * Safe for production: `SCAN` never blocks the server. Standalone / sentinel
   * only — Cluster exposes different scan semantics and is rejected.
   *
   * @param prefix - Entity-group prefix.
   * @param pattern - Glob pattern for the id segment, e.g. `'*'`.
   * @param count - Per-batch hint passed to `SCAN` (not a hard limit): a whole number from 1 to
   *   10 000. Anything else is clamped into that range, and a value that is not a whole number
   *   falls back to 100.
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
    const events = this.options.events
    let outcome: CacheOperationOutcome = 'ok'
    try {
      yield* this.scanKeys(prefix, pattern, count)
    } catch (error) {
      outcome = 'error'
      throw error
    } finally {
      reportOperation(events, 'scan', outcome)
    }
  }

  /**
   * Iterates the keys of {@link CacheService.scan}, with no reporting of its own.
   *
   * @param prefix - Entity-group prefix.
   * @param pattern - Glob for the id segment.
   * @param count - `SCAN` `COUNT` hint.
   * @returns The matching keys, one at a time.
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` in cluster mode.
   */
  private async *scanKeys(prefix: string, pattern: string, count: number): AsyncIterable<string> {
    const fullPattern = this.keyBuilder.buildPattern(prefix, pattern)
    const client = this.client()
    if (!isScannableClient(client)) {
      throw new CacheException(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER, { operation: 'scan' })
    }
    const hint = Number.isInteger(count) ? Math.min(Math.max(count, 1), MAX_SCAN_COUNT) : SCAN_COUNT
    const stream = client.scanStream({ match: fullPattern, count: hint })
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
    return this.client().pipeline()
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
   * `NODE_ENV` is `production` (trimmed, any letter case) unless `options.allowFlushInProduction` is `true`.
   * Intended for tests and tooling — in production prefer
   * {@link CacheService.del} / {@link CacheService.delMany}.
   *
   * @returns The total number of keys removed.
   * @throws {CacheException} `FLUSH_DISABLED_IN_PRODUCTION` under the production guard.
   * @throws {CacheException} `UNSUPPORTED_IN_CLUSTER` when called in cluster mode
   *   (no usable top-level `scanStream`).
   */
  async flushNamespace(): Promise<number> {
    return this.track('flushNamespace', async () => {
      if (
        process.env['NODE_ENV']?.trim().toLowerCase() === PRODUCTION_ENV &&
        !this.options.allowFlushInProduction
      ) {
        throw new CacheException(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION)
      }

      const client = this.client()
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
    })
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
    return this.track('eval', async () => {
      if (!this.scriptRegistry) {
        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
      }
      const namespacedKeys = keys.map((key) => this.keyBuilder.applyNamespace(key))
      return this.scriptRegistry.eval(scriptName, namespacedKeys, args)
    })
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
    return this.track(
      'isHealthy',
      async () => {
        try {
          const pong = await this.client().ping()
          return pong === 'PONG'
        } catch {
          return false
        }
      },
      (healthy) => (healthy ? 'ok' : 'error')
    )
  }

  /**
   * Sends a raw `PING`. Unlike {@link CacheService.isHealthy}, this propagates a
   * connection failure — use it when the caller wants to handle the error.
   *
   * @returns `'PONG'` on a healthy connection.
   * @throws The underlying ioredis error when the connection is down.
   */
  async ping(): Promise<string> {
    return this.track('ping', async () => {
      return this.client().ping()
    })
  }

  /**
   * Returns the Redis `INFO` output, optionally scoped to a single section.
   *
   * @param section - Optional section name (e.g. `'memory'`, `'clients'`,
   *   `'replication'`); omit for the full report.
   * @returns The `INFO` text.
   */
  async info(section?: string): Promise<string> {
    return this.track('info', async () => {
      const client = this.client()
      return section === undefined ? client.info() : client.info(section)
    })
  }

  /**
   * Decodes one stored payload and, when the caller passed `validate`, checks it.
   *
   * @typeParam T - The expected decoded type.
   * @param raw - The stored string.
   * @param options - The read options of the calling method.
   * @param location - Where the value came from (`{ index }`, `{ field }`), named in a failure.
   * @returns The decoded value; the validator's output when it transforms.
   * @internal
   */
  protected async decode<T>(
    raw: string,
    options: ReadOptions<T> | undefined,
    location?: Record<string, unknown>
  ): Promise<T> {
    const value = this.serializer.deserialize<T>(raw)
    return options?.validate === undefined ? value : validateRead(value, options.validate, location)
  }
}
