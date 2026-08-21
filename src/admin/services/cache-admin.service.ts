/**
 * Reads the keyspace an administration surface is allowed to see.
 *
 * Layer: admin. Three questions — what is in here, what is this key, and what
 * does it hold — answered under a declared allowlist that decides which keys are
 * reachable and which values are withheld.
 *
 * **Every command this service issues is read-only.** The client it holds can
 * delete, expire and flush; nothing here does. That is enforced rather than
 * asserted — `check:admin-readonly` fails the build if a mutating command
 * appears anywhere in this subpath.
 */
import { Inject, Injectable } from '@nestjs/common'

import { CACHE_ERROR_CODES, CacheException, CacheService } from '@bymax-one/nest-cache'

import { BYMAX_CACHE_ADMIN_OPTIONS } from '../bymax-cache-admin.constants'
import type { ResolvedAdminOptions } from '../config/resolved-admin-options'
import { findScope, isKeyInScope } from '../config/validate-scopes'
import type { CacheScope } from '../interfaces/cache-scope.interface'
import type {
  IRedisReader,
  IRedisReaderSource,
  PipelineReply
} from '../interfaces/redis-reader.interface'
import type {
  KeyDetail,
  KeyEntry,
  KeyspacePage,
  RedisKeyType,
  RevealResult,
  RevealedValue
} from '../types/keyspace.types'
import { readKeyTtl, readKeyType, readSizeBytes } from '../utils/read-replies'

/** The cursor Redis uses to mean "iteration finished". */
const SCAN_END_CURSOR = '0'

/** Commands one key costs to describe without sizing: `TYPE` and `TTL`. */
const DESCRIBE_COMMANDS_PER_KEY = 2

/** The extra `MEMORY USAGE` a sized key costs. */
const SIZING_COMMANDS_PER_KEY = 1

/** What `TYPE` answers for a key that does not exist. */
const TYPE_NONE = 'none'

/** Options for one keyspace listing. */
export interface ListKeysOptions {
  /** Cursor from a previous page; omit to start at the beginning of the scope. */
  cursor?: string
  /**
   * Measure each key's serialized size.
   *
   * Opt-in because it is not free: it adds a `MEMORY USAGE` per key, and Redis
   * is single-threaded, so the cost lands on every other client waiting behind
   * the batch — on a server an operator is inspecting precisely because it is
   * unwell.
   */
  includeSize?: boolean
}

/**
 * Reads a pipeline reply slot, treating a per-command error as an unknown
 * reading rather than a failure.
 *
 * One command erroring is a fact this surface could not learn about one key; it
 * is not a reason to drop the key from a listing it demonstrably belongs to.
 *
 * @param replies - The pipeline's replies, or `null` when it answered none.
 * @param index - The slot to read.
 * @returns The value, or `null` when absent or errored.
 */
function replyAt(replies: PipelineReply[] | null, index: number): unknown {
  // `.at` rather than a computed index: the same read without an object-injection sink.
  const slot = replies?.at(index)
  if (!slot || slot[0] !== null) {
    return null
  }
  return slot[1]
}

/**
 * Reads a `ZRANGE ... WITHSCORES` reply into members and scores.
 *
 * **Two wire shapes, both real.** ioredis 6 defaults to RESP3, where a
 * with-scores reply arrives as an array of `[member, score]` pairs; under RESP2
 * (and under `replyMapping: 'legacy'` for the typed commands) the same reply is
 * a flat alternating sequence. This was measured against a real server — the
 * flat shape alone passed a unit suite and produced `member: "z1,1"` against
 * Redis, because `String(['z1','1'])` is `'z1,1'`.
 *
 * An unpaired trailing element in the flat shape is dropped rather than given an
 * invented score.
 *
 * @param reply - Whatever the server answered.
 * @param limit - Most members to return.
 * @returns The paired members and whether the reply was returned whole.
 */
function readScoredMembers(
  reply: unknown,
  limit: number
): { members: { member: string; score: string }[]; isComplete: boolean } {
  if (!Array.isArray(reply)) {
    return { members: [], isComplete: true }
  }
  const members: { member: string; score: string }[] = []
  let pairCount = 0
  let pendingMember: string | null = null

  for (const element of reply) {
    if (Array.isArray(element)) {
      // RESP3: the element IS the pair.
      const [member, score] = element
      pairCount += 1
      if (members.length < limit) {
        members.push({ member: String(member), score: String(score) })
      }
      continue
    }
    // RESP2: alternating member, score. Paired by walking rather than by index,
    // so there is no unreachable bounds fallback to test.
    if (pendingMember === null) {
      pendingMember = String(element)
      continue
    }
    pairCount += 1
    if (members.length < limit) {
      members.push({ member: pendingMember, score: String(element) })
    }
    pendingMember = null
  }
  return { members, isComplete: members.length === pairCount }
}

/** Reads the keyspace an administration surface is allowed to see. */
@Injectable()
export class CacheAdminService {
  /**
   * @param cache - Supplies the client. `CacheService.getClient()` refuses
   *   cluster mode, so this surface inherits that rule rather than restating it.
   * @param options - The resolved administration options.
   */
  constructor(
    @Inject(CacheService) private readonly cache: IRedisReaderSource,
    @Inject(BYMAX_CACHE_ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions
  ) {}

  /**
   * Returns the declared scopes.
   *
   * **Never touches the connection**, and that is a property rather than an
   * accident of the current implementation. A surface reads this to decide what
   * it may offer at all, so it must answer during an outage — an operator whose
   * cache is down is exactly the person who needs to be told what the inspector
   * covers. The tempting change is a liveness check to make the list "more
   * accurate"; it would turn a declaration into a measurement, and a scope that
   * vanished during an outage reads as a scope that was removed.
   *
   * @returns The frozen allowlist, in declaration order.
   */
  listScopes(): readonly CacheScope[] {
    return this.options.scopes
  }

  /**
   * Lists one page of the keys in a scope.
   *
   * The page may carry slightly MORE than `scanLimit` entries: the limit stops
   * the scan loop, and the batch that crosses it is kept whole rather than
   * trimmed, because the cursor has already moved past those keys and trimming
   * would drop them from every subsequent page too.
   *
   * @param scopeId - The scope a caller named.
   * @param listOptions - Cursor and whether to measure sizes.
   * @returns The page, with the sample it read and whether it reached the end.
   * @throws {CacheException} `SCOPE_NOT_FOUND` for an undeclared id, or
   *   `UNSUPPORTED_IN_CLUSTER` in cluster mode.
   */
  async listKeys(scopeId: string, listOptions: ListKeysOptions = {}): Promise<KeyspacePage> {
    const scope = findScope(this.options.scopes, scopeId)
    const client = this.cache.getClient()
    const limit = this.options.scanLimit

    const keys: string[] = []
    let cursor = listOptions.cursor ?? SCAN_END_CURSOR
    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', scope.pattern, 'COUNT', limit)
      cursor = nextCursor
      keys.push(...batch)
    } while (cursor !== SCAN_END_CURSOR && keys.length < limit)

    // Everything collected is returned, deliberately: `SCAN` hands back whole
    // batches and the cursor has already moved past them, so trimming the tail
    // to hit an exact page size would drop keys that no later page can reach —
    // silent loss in the one screen whose job is to say what is there. The limit
    // therefore stops the LOOP rather than cutting the result, and the final
    // batch may overshoot it by up to one batch.
    const isComplete = cursor === SCAN_END_CURSOR
    const includeSize = listOptions.includeSize === true
    const entries = await this.describeAll(client, keys, includeSize)

    return {
      scopeId: scope.id,
      entries,
      sampledCount: entries.length,
      sampledBytes: includeSize ? sumMeasured(entries) : null,
      isComplete,
      scanLimit: limit,
      cursor: isComplete ? null : cursor
    }
  }

  /**
   * Describes one key without reading its value.
   *
   * Works on an unreadable scope: only the value is withheld, never the
   * description. {@link KeyDetail.isReadable} lets a surface disable the reveal
   * rather than discovering the refusal by attempting it.
   *
   * @param scopeId - The scope a caller named.
   * @param key - The key, which must belong to that scope.
   * @returns The key's type, remaining life, and whether its value may be read.
   * @throws {CacheException} `SCOPE_NOT_FOUND` or `KEY_NOT_IN_SCOPE`.
   */
  async describeKey(scopeId: string, key: string): Promise<KeyDetail> {
    const scope = this.resolve(scopeId, key)
    const client = this.cache.getClient()
    const [type, ttl] = await Promise.all([client.type(key), client.ttl(key)])
    return {
      scopeId: scope.id,
      key,
      type: readKeyType(type),
      ttl: readKeyTtl(ttl),
      sizeBytes: null,
      isReadable: scope.isReadable
    }
  }

  /**
   * Reads a key's value, or explains why it will not.
   *
   * @param scopeId - The scope a caller named.
   * @param key - The key, which must belong to that scope.
   * @returns The value, a refusal carrying the scope's `origin`, or `missing`.
   * @throws {CacheException} `SCOPE_NOT_FOUND` or `KEY_NOT_IN_SCOPE`.
   */
  async revealValue(scopeId: string, key: string): Promise<RevealResult> {
    const scope = this.resolve(scopeId, key)
    // Refused BEFORE any read. Fetching the value and discarding it would have
    // already pulled the secret into this process.
    if (!scope.isReadable) {
      return { status: 'withheld', key, scopeId: scope.id, origin: scope.origin }
    }
    const client = this.cache.getClient()
    const rawType = await client.type(key)
    if (rawType === TYPE_NONE) {
      return { status: 'missing', key }
    }
    const type = readKeyType(rawType)
    const value = await this.readValue(client, key, type)
    return value === null ? { status: 'missing', key } : { status: 'revealed', key, type, value }
  }

  /**
   * Resolves a scope and confirms the key belongs to it.
   *
   * The membership check is the reason scope patterns are restricted to a
   * literal prefix: it makes this decidable exactly, rather than by a matcher
   * that could be more permissive than the server's.
   *
   * @param scopeId - The scope a caller named.
   * @param key - The key a caller named.
   * @returns The resolved scope.
   * @throws {CacheException} `SCOPE_NOT_FOUND` or `KEY_NOT_IN_SCOPE`.
   */
  private resolve(scopeId: string, key: string): CacheScope {
    const scope = findScope(this.options.scopes, scopeId)
    if (!isKeyInScope(scope.pattern, key)) {
      throw new CacheException(CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE, { scopeId: scope.id, key })
    }
    return scope
  }

  /**
   * Describes every key on a page, in batches bounded by command count.
   *
   * The bound is in commands rather than keys because that is the resource
   * actually spent: describing a key costs two commands, or three when sized,
   * and Redis works through a flush single-threaded while every other client
   * waits. At least one key goes per batch, so a limit below one key's cost
   * still makes progress instead of dividing to nothing.
   *
   * @param client - The reader.
   * @param keys - The page's keys.
   * @param includeSize - Whether to add `MEMORY USAGE`.
   * @returns One entry per key, in page order.
   */
  private async describeAll(
    client: IRedisReader,
    keys: readonly string[],
    includeSize: boolean
  ): Promise<KeyEntry[]> {
    const perKey = DESCRIBE_COMMANDS_PER_KEY + (includeSize ? SIZING_COMMANDS_PER_KEY : 0)
    const chunkSize = Math.max(1, Math.floor(this.options.commandBatchLimit / perKey))
    const entries: KeyEntry[] = []

    for (let start = 0; start < keys.length; start += chunkSize) {
      const chunk = keys.slice(start, start + chunkSize)
      const pipeline = client.pipeline()
      for (const key of chunk) {
        pipeline.type(key).ttl(key)
        if (includeSize) {
          pipeline.memory('USAGE', key)
        }
      }
      const replies = await pipeline.exec()
      chunk.forEach((key, index) => {
        const base = index * perKey
        entries.push({
          key,
          type: readKeyType(replyAt(replies, base)),
          ttl: readKeyTtl(replyAt(replies, base + 1)),
          sizeBytes: includeSize ? readSizeBytes(replyAt(replies, base + 2)) : null
        })
      })
    }
    return entries
  }

  /**
   * Reads a value according to its Redis type, truncating to the configured caps.
   *
   * @param client - The reader.
   * @param key - The key to read.
   * @param type - The key's type.
   * @returns The value, or `null` when the key vanished between reads.
   */
  private async readValue(
    client: IRedisReader,
    key: string,
    type: RedisKeyType
  ): Promise<RevealedValue | null> {
    const limit = this.options.revealLimit
    switch (type) {
      case 'string': {
        const value = await client.get(key)
        if (value === null) {
          return null
        }
        const capped = value.slice(0, this.options.revealStringLimit)
        return { kind: 'string', value: capped, isComplete: capped.length === value.length }
      }
      case 'hash': {
        const all = Object.entries(await client.hgetall(key))
        const kept = all.slice(0, limit)
        return {
          kind: 'hash',
          // `field`, not `name`: Redis's own vocabulary for a hash is field/value
          // (`HSET key field value`, `HDEL key field`). A generic `name` loses the
          // domain term in the one place a reader would check it against the
          // server's documentation.
          fields: kept.map(([field, value]) => ({ field, value })),
          isComplete: kept.length === all.length
        }
      }
      case 'set':
      case 'list': {
        const all = type === 'set' ? await client.smembers(key) : await client.lrange(key, 0, limit)
        const kept = all.slice(0, limit)
        return { kind: 'members', members: kept, isComplete: kept.length === all.length }
      }
      case 'zset': {
        // Through `call` because ioredis's `zrange` overload set cannot be
        // narrowed to a four-argument signature — see the reader interface.
        const reply = await client.call('ZRANGE', key, 0, limit, 'WITHSCORES')
        const { members, isComplete } = readScoredMembers(reply, limit)
        return { kind: 'scored', members, isComplete }
      }
      default:
        return { kind: 'unsupported', type }
    }
  }
}

/**
 * Sums the sizes that were actually measured.
 *
 * Keys the server declined to size contribute nothing rather than zero — the
 * total is a sum over what was measured, not a claim about the rest.
 *
 * @param entries - The described keys.
 * @returns The total measured bytes.
 */
function sumMeasured(entries: readonly KeyEntry[]): number {
  return entries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0)
}
