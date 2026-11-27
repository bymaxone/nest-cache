/**
 * @fileoverview A Redis-backed {@link IIdempotencyStore} on this package's connection, namespace and
 * script machinery. `begin` is one atomic claim-or-report, `complete` and `release` one
 * compare-and-set on the token each, all on a single key under the `idem` prefix. The key arrives
 * already hashed and is not hashed again.
 *
 * A resent `begin` (a reply lost to a reconnect) finds the key held and answers `claimed: false`
 * with the in-progress record, so it never takes a second claim; the first claim stays orphaned
 * until its lease ends.
 */
import { randomUUID } from 'node:crypto'

import type {
  IdempotencyBeginResult,
  IdempotencyStoredResponse,
  IIdempotencyStore
} from '@bymax-one/nest-core/idempotency'
import { Inject, Injectable } from '@nestjs/common'

import {
  CACHE_ERROR_CODES,
  CacheException,
  KeyBuilder,
  ScriptManagerService
} from '@bymax-one/nest-cache'
import type { CacheErrorCode } from '@bymax-one/nest-cache'

import {
  BEGIN_LUA,
  BEGIN_SCRIPT,
  COMPLETE_LUA,
  COMPLETE_SCRIPT,
  RELEASE_LUA,
  RELEASE_SCRIPT
} from './idempotency-scripts'
import { assertSeconds, decodeHeld, encodeHeaders } from './stored-record'

/** The key prefix every claim is stored under. */
const PREFIX = 'idem'

/** A Redis error reply opens with its code, in capitals. */
const REPLY_CODE = /^[A-Z]{2,16}(?= )/

/**
 * The failure of a script run, with the same code, details and status, and a cause that is a new
 * error naming only the reply's code.
 */
function scrubbed(error: unknown): CacheException {
  const known = error instanceof CacheException
  if (known && error.cause === undefined) return error
  const cause: unknown = known ? error.cause : error
  const message = cause instanceof Error ? cause.message : ''
  return new CacheException(
    known ? (error.code as CacheErrorCode) : CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED,
    known ? (error.details ?? undefined) : undefined,
    known ? error.getStatus() : undefined,
    new Error(REPLY_CODE.exec(message)?.[0] ?? 'driver error')
  )
}

/** Refuses a reply that is not the shape a script of this package returns. */
function unexpected(): CacheException {
  return new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, { reason: 'reply_invalid' })
}

/**
 * Turns the answer of a compare-and-set script into the port's boolean.
 *
 * @throws {CacheException} `DESERIALIZATION_FAILED` for `-1` (the key holds something that is not
 *   a record) and for any other reply.
 */
function settled(reply: unknown): boolean {
  if (reply === 1) return true
  if (reply === 0) return false
  throw unexpected()
}

@Injectable()
export class RedisIdempotencyStore implements IIdempotencyStore {
  /**
   * @param scripts - Runs the three scripts, reloading one when the server lost it.
   * @param keys - Builds the namespaced key.
   */
  constructor(
    @Inject(ScriptManagerService) private readonly scripts: ScriptManagerService,
    @Inject(KeyBuilder) private readonly keys: KeyBuilder
  ) {
    scripts.register(BEGIN_SCRIPT, BEGIN_LUA)
    scripts.register(COMPLETE_SCRIPT, COMPLETE_LUA)
    scripts.register(RELEASE_SCRIPT, RELEASE_LUA)
  }

  /** @inheritdoc */
  async begin(
    key: string,
    fingerprint: string,
    leaseSeconds: number
  ): Promise<IdempotencyBeginResult> {
    assertSeconds('leaseSeconds', leaseSeconds)
    const token = randomUUID()
    const reply = await this.run(BEGIN_SCRIPT, key, [fingerprint, token, leaseSeconds])
    if (!Array.isArray(reply)) throw unexpected()
    if (reply[0] === 'c') return { claimed: true, token }
    if (reply[0] === 'h') return { claimed: false, record: decodeHeld(reply.slice(1)) }
    throw new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, { reason: 'not_a_record' })
  }

  /** @inheritdoc */
  async complete(
    key: string,
    token: string,
    response: IdempotencyStoredResponse,
    ttlSeconds: number
  ): Promise<boolean> {
    assertSeconds('ttlSeconds', ttlSeconds)
    const args: Array<string | number> = [
      token,
      response.status,
      encodeHeaders(response.headers),
      ttlSeconds
    ]
    if (response.body !== undefined) args.push(response.body)
    return settled(await this.run(COMPLETE_SCRIPT, key, args))
  }

  /** @inheritdoc */
  async release(key: string, token: string): Promise<boolean> {
    return settled(await this.run(RELEASE_SCRIPT, key, [token]))
  }

  /** Runs one script on the claim's key; a rejection is scrubbed before it leaves. */
  private async run(
    script: string,
    key: string,
    args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    const keys = [this.keys.build(PREFIX, key)]
    try {
      return await this.scripts.eval(script, keys, args)
    } catch (error) {
      throw scrubbed(error)
    }
  }
}
