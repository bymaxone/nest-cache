/**
 * End-to-end tests for `RedisIdempotencyStore` against a REAL Redis (Testcontainers), plus one
 * Redis Cluster row.
 *
 * Layer: idempotency, the store against the server it runs its scripts on.
 *
 * The Lua scripts, the TTL bounds, the compare-and-set on the token and the refusal of a stored
 * value this package did not write are only meaningful on a real server: `ioredis-mock` does not
 * run the scripts. Raw seeding goes through a second plain ioredis client so each row can plant
 * exactly the stored shape it needs.
 */
import { createHash } from 'node:crypto'

import {
  CacheException,
  CacheService,
  KeyBuilder,
  ScriptManagerService
} from '@bymax-one/nest-cache'
import { RedisIdempotencyStore } from '@bymax-one/nest-cache/idempotency'
import { Redis } from 'ioredis'

import { bootCacheApp, type CacheAppOptions } from './fixtures/test-cache-app.module'
import { startRedisCluster, type StartedRedisCluster } from './helpers/start-redis-cluster'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** A key as the port delivers it: 64 lower-case hexadecimal characters (SHA-256). */
const hashed = (name: string): string => createHash('sha256').update(name).digest('hex')

const NAMESPACE = 'e2e-idem'
const FP = 'fingerprint-a'
const RESPONSE = {
  status: 201,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}'
}

/** The store of an app context, wired the way a host module wires it. */
function storeOf(app: TestingModule): RedisIdempotencyStore {
  return new RedisIdempotencyStore(app.get(ScriptManagerService), app.get(KeyBuilder))
}

/** The Redis key a hashed idempotency key lives under. */
const redisKey = (key: string, namespace = NAMESPACE): string => `${namespace}:idem:${key}`

/** Rejects with the code of the library's error, or fails the row. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof CacheException) return error.code
    throw error
  }
  throw new Error('expected a rejection')
}

describe('RedisIdempotencyStore E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let second: TestingModule
  let raw: Redis
  let store: RedisIdempotencyStore

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({ connection: { url: redis.url }, namespace: NAMESPACE })
    second = await bootCacheApp({ connection: { url: redis.url }, namespace: NAMESPACE })
    raw = new Redis(redis.url)
    store = storeOf(app)
  }, 60_000)

  afterAll(async () => {
    raw?.disconnect()
    await second?.close()
    await app?.close()
    await redis?.container.stop()
  })

  // A first begin claims with a lease: the token it returns is the one the hash holds, and the
  // hash has the lease as its TTL.
  it('claims a free key with a lease and returns a token', async () => {
    const result = await store.begin(hashed('k-claim'), FP, 30)
    if (!result.claimed) throw new Error('expected a claim')

    expect(result.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(await raw.hget(redisKey(hashed('k-claim')), 't')).toBe(result.token)
    const ttl = await raw.ttl(redisKey(hashed('k-claim')))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30)
  })

  // The second begin finds the claim: in_progress, same fingerprint, never a second claim.
  it('answers a held key with the in-progress record and no token', async () => {
    await store.begin(hashed('k-held'), FP, 30)

    const again = await store.begin(hashed('k-held'), FP, 30)

    expect(again).toEqual({ claimed: false, record: { state: 'in_progress', fingerprint: FP } })
  })

  // Two connections race on one key: the script is atomic, so exactly one claims.
  it('lets exactly one of two concurrent begins from two connections claim', async () => {
    const other = storeOf(second)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? store : other).begin(hashed('k-race'), FP, 30)
      )
    )

    expect(results.filter((r) => r.claimed)).toHaveLength(1)
  })

  // complete stores the answer, drops the token, and a later begin replays it byte for byte.
  it('completes with the token and replays the stored response', async () => {
    const claim = await store.begin(hashed('k-done'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')

    expect(await store.complete(hashed('k-done'), claim.token, RESPONSE, 60)).toBe(true)

    const replay = await store.begin(hashed('k-done'), FP, 30)
    expect(replay).toEqual({
      claimed: false,
      record: { state: 'completed', fingerprint: FP, response: RESPONSE }
    })
    const ttl = await raw.ttl(redisKey(hashed('k-done')))
    expect(ttl).toBeGreaterThan(30)
    expect(await raw.hexists(redisKey(hashed('k-done')), 't')).toBe(0)
  })

  // A token that is not the holder's changes nothing and answers false.
  it('refuses complete and release with a token that does not hold the claim', async () => {
    await store.begin(hashed('k-wrong'), FP, 30)
    const before = await raw.hgetall(redisKey(hashed('k-wrong')))

    expect(await store.complete(hashed('k-wrong'), 'not-the-token', RESPONSE, 60)).toBe(false)
    expect(await store.release(hashed('k-wrong'), 'not-the-token')).toBe(false)
    expect(await raw.hgetall(redisKey(hashed('k-wrong')))).toEqual(before)
  })

  // release frees an in-progress claim so the next begin claims anew.
  it('releases a claim so the key can be claimed again', async () => {
    const claim = await store.begin(hashed('k-rel'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')

    expect(await store.release(hashed('k-rel'), claim.token)).toBe(true)

    expect((await store.begin(hashed('k-rel'), FP, 30)).claimed).toBe(true)
  })

  // A completed record is never released or completed again.
  it('answers false for release after complete and for a second complete', async () => {
    const claim = await store.begin(hashed('k-twice'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')
    await store.complete(hashed('k-twice'), claim.token, RESPONSE, 60)

    expect(await store.release(hashed('k-twice'), claim.token)).toBe(false)
    expect(await store.complete(hashed('k-twice'), claim.token, RESPONSE, 60)).toBe(false)
    expect((await store.begin(hashed('k-twice'), FP, 30)).claimed).toBe(false)
  })

  // After the lease ends the claim is gone: complete and release answer false and write nothing.
  it('answers false for complete and release after the lease expired', async () => {
    const claim = await store.begin(hashed('k-exp'), FP, 1)
    if (!claim.claimed) throw new Error('expected a claim')
    await new Promise((resolve) => setTimeout(resolve, 1_300))

    expect(await store.complete(hashed('k-exp'), claim.token, RESPONSE, 60)).toBe(false)
    expect(await store.release(hashed('k-exp'), claim.token)).toBe(false)
    expect(await raw.exists(redisKey(hashed('k-exp')))).toBe(0)
  })

  // After a takeover the first holder's token is stale: its complete is refused and the new
  // holder's claim is untouched.
  it('answers false for complete after another caller took the key over', async () => {
    const first = await store.begin(hashed('k-take'), FP, 1)
    if (!first.claimed) throw new Error('expected a claim')
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    const taker = await storeOf(second).begin(hashed('k-take'), FP, 30)
    if (!taker.claimed) throw new Error('expected a takeover')

    expect(await store.complete(hashed('k-take'), first.token, RESPONSE, 60)).toBe(false)
    expect(await storeOf(second).complete(hashed('k-take'), taker.token, RESPONSE, 60)).toBe(true)
  })

  // The key space is the namespace: another namespace on the same server never sees the claim.
  it('keeps claims of two namespaces apart', async () => {
    const elsewhere = await bootCacheApp({
      connection: { url: redis.url },
      namespace: 'e2e-idem-b'
    })
    try {
      await store.begin(hashed('k-ns'), FP, 30)

      expect((await storeOf(elsewhere).begin(hashed('k-ns'), FP, 30)).claimed).toBe(true)
    } finally {
      await elsewhere.close()
    }
  })

  // Documented durability limit: claims live in the namespace, so flushNamespace removes them.
  it('is removed by flushNamespace, as the README states', async () => {
    const flushed = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-idem-f' })
    try {
      const fs = storeOf(flushed)
      await fs.begin(hashed('k-flush'), FP, 30)

      await flushed.get(CacheService).flushNamespace()

      expect((await fs.begin(hashed('k-flush'), FP, 30)).claimed).toBe(true)
    } finally {
      await flushed.close()
    }
  })

  // The bounds are checked before any command, so nothing is written for a refused value.
  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    'refuses lease %p with the invalid-options code and writes nothing',
    async (lease) => {
      const key = hashed(`k-bound-${String(lease)}`)

      expect(await codeOf(store.begin(key, FP, lease))).toBe('cache.invalid_options')
      expect(await raw.exists(redisKey(key))).toBe(0)
    }
  )

  // A ttl above Redis's EXPIRE limit would fail inside the script after the write; it is
  // refused first, so the claim stays in progress and untouched.
  it('refuses an overflowing ttl in complete before the script runs', async () => {
    const claim = await store.begin(hashed('k-ttl'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')

    expect(
      await codeOf(store.complete(hashed('k-ttl'), claim.token, RESPONSE, 2_147_483_648))
    ).toBe('cache.invalid_options')
    expect(await raw.hget(redisKey(hashed('k-ttl')), 's')).toBe('p')
  })

  // The largest accepted lease is a valid EXPIRE on a real server.
  it('accepts the largest lease and sets it as the TTL', async () => {
    expect((await store.begin(hashed('k-max'), FP, 2_147_483_647)).claimed).toBe(true)
    expect(await raw.ttl(redisKey(hashed('k-max')))).toBeGreaterThan(2_000_000_000)
  })

  // A hash this package wrote but with no expiry is never trusted as a record.
  it('rejects a held record with no TTL as a bad record', async () => {
    await raw.hset(redisKey(hashed('k-nottl')), { s: 'p', f: FP, t: 'tok' })

    expect(await codeOf(store.begin(hashed('k-nottl'), FP, 30))).toBe(
      'cache.deserialization_failed'
    )
  })

  // A foreign field is refused however few fields the hash holds, in either state.
  it.each([
    ['completed', { s: 'c', f: FP, st: '200', h: '{}', zz: '1' }],
    ['in progress', { s: 'p', f: FP, t: 'tok', a: '1' }],
    ['unknown only', { a: '1' }]
  ])('rejects a %s hash that holds a foreign field', async (name, fields) => {
    const key = hashed(`k-foreign-${name}`)
    await raw.hset(redisKey(key), fields)
    await raw.expire(redisKey(key), 60)

    expect(await codeOf(store.begin(key, FP, 30))).toBe('cache.deserialization_failed')
  })

  // A key of another type, or a hash with extra fields, is never claimed and never replayed.
  it('rejects a key of the wrong type and a hash with extra fields', async () => {
    await raw.set(redisKey(hashed('k-string')), 'x')
    await raw.hset(redisKey(hashed('k-extra')), {
      s: 'p',
      f: FP,
      t: 'tok',
      a: '1',
      b: '2',
      c: '3',
      d: '4'
    })
    await raw.expire(redisKey(hashed('k-extra')), 60)

    expect(await codeOf(store.begin(hashed('k-string'), FP, 30))).toBe(
      'cache.deserialization_failed'
    )
    expect(await codeOf(store.begin(hashed('k-extra'), FP, 30))).toBe(
      'cache.deserialization_failed'
    )
    expect(await codeOf(store.complete(hashed('k-string'), 't', RESPONSE, 60))).toBe(
      'cache.deserialization_failed'
    )
    expect(await codeOf(store.release(hashed('k-string'), 't'))).toBe(
      'cache.deserialization_failed'
    )
  })

  // Truncated or unknown-state values reject and are never replayed.
  it('rejects an unknown state and a truncated completed record', async () => {
    await raw.hset(redisKey(hashed('k-state')), { s: 'z', f: FP })
    await raw.expire(redisKey(hashed('k-state')), 60)
    await raw.hset(redisKey(hashed('k-trunc')), { s: 'c', f: FP, st: '200' })
    await raw.expire(redisKey(hashed('k-trunc')), 60)

    expect(await codeOf(store.begin(hashed('k-state'), FP, 30))).toBe(
      'cache.deserialization_failed'
    )
    expect(await codeOf(store.begin(hashed('k-trunc'), FP, 30))).toBe(
      'cache.deserialization_failed'
    )
  })

  // An empty body and an absent body are different answers and stay different.
  it('keeps an empty body distinct from an absent one', async () => {
    const empty = await store.begin(hashed('k-empty'), FP, 30)
    const absent = await store.begin(hashed('k-absent'), FP, 30)
    if (!empty.claimed || !absent.claimed) throw new Error('expected claims')
    await store.complete(hashed('k-empty'), empty.token, { status: 204, headers: {}, body: '' }, 60)
    await store.complete(hashed('k-absent'), absent.token, { status: 204, headers: {} }, 60)

    const a = await store.begin(hashed('k-empty'), FP, 30)
    const b = await store.begin(hashed('k-absent'), FP, 30)
    expect(a).toMatchObject({ record: { response: { body: '' } } })
    expect(b).toMatchObject({ claimed: false })
    expect('body' in (b as { record: { response: object } }).record.response).toBe(false)
  })

  // The body is opaque: a 1 MB body with multi-byte text comes back byte for byte. Enforcing a
  // size limit is the caller's, not the store's.
  it('stores a 1 MB body byte for byte', async () => {
    const body = 'é€𝄞\u0000'.repeat(100_000)
    const claim = await store.begin(hashed('k-big'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')

    await store.complete(hashed('k-big'), claim.token, { status: 200, headers: {}, body }, 60)

    const replay = await store.begin(hashed('k-big'), FP, 30)
    expect(replay).toMatchObject({ record: { response: { body } } })
  })

  // The store's own header guard (core's interceptor normally keeps a response under it):  complete rejects and the claim
  // stays in progress until its lease ends, so the key is not executed a second time at once.
  it('rejects an oversized header map and leaves the claim in progress', async () => {
    const claim = await store.begin(hashed('k-hdr'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')
    const headers = { 'x-big': 'v'.repeat(70_000) }

    expect(
      await codeOf(store.complete(hashed('k-hdr'), claim.token, { status: 200, headers }, 60))
    ).toBe('cache.invalid_options')
    expect((await store.begin(hashed('k-hdr'), FP, 30)).claimed).toBe(false)
    expect(await raw.hget(redisKey(hashed('k-hdr')), 's')).toBe('p')
  })

  // After SCRIPT FLUSH the next call reloads the scripts and succeeds.
  it('recovers after the server script cache is flushed', async () => {
    await raw.script('FLUSH')

    expect((await store.begin(hashed('k-noscript'), FP, 30)).claimed).toBe(true)
  })

  // A second begin of a resend never claims again; the first claim stays held until its lease ends.
  it('answers a resent begin as held, never as a second claim', async () => {
    const first = await store.begin(hashed('k-resend'), FP, 30)

    const resend = await store.begin(hashed('k-resend'), FP, 30)

    expect(first.claimed).toBe(true)
    expect(resend.claimed).toBe(false)
  })
})

describe('RedisIdempotencyStore E2E (Redis Cluster)', () => {
  let cluster: StartedRedisCluster
  let app: TestingModule

  beforeAll(async () => {
    cluster = await startRedisCluster()
    const options: CacheAppOptions = {
      mode: 'cluster',
      cluster: { nodes: cluster.nodes },
      namespace: 'e2e-idem-cluster'
    }
    app = await bootCacheApp(options)
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await cluster?.container.stop()
  })

  // Every script touches one key, so one slot: claim, hold, complete and replay work on a cluster.
  it('claims, holds, completes and replays across the cluster', async () => {
    const store = storeOf(app)
    const claim = await store.begin(hashed('c-1'), FP, 30)
    if (!claim.claimed) throw new Error('expected a claim')

    expect((await store.begin(hashed('c-1'), FP, 30)).claimed).toBe(false)
    expect(await store.complete(hashed('c-1'), claim.token, RESPONSE, 60)).toBe(true)
    expect(await store.begin(hashed('c-1'), FP, 30)).toEqual({
      claimed: false,
      record: { state: 'completed', fingerprint: FP, response: RESPONSE }
    })
  })
})
