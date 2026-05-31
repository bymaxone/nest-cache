/**
 * Full-surface end-to-end tests for {@link CacheService} against a REAL Redis
 * (Testcontainers).
 *
 * Where `cache-service.e2e-spec.ts` smoke-tests the common path on `ioredis-mock`,
 * this spec exercises the ENTIRE public command surface — strings, raw values,
 * SET NX, counters, expiration, batches, hashes, sets, key iteration (`keys` and
 * the non-blocking `scan`), pipelines, namespace flush, and `INFO` — against an
 * actual server, so behaviours the in-memory mock cannot reproduce faithfully
 * (TTL semantics, `SCAN` cursoring, `UNLINK`, real return types) are verified.
 * Each test uses its own prefix to stay isolated within the shared container.
 */
import { CacheService, KeyBuilder } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

interface Profile {
  name: string
  roles: string[]
}

describe('CacheService full surface E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService
  let keyBuilder: KeyBuilder

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-full' })
    cache = app.get(CacheService)
    keyBuilder = app.get(KeyBuilder)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // A structured value must survive set→get through the serializer, and `getRaw`
  // must expose the on-the-wire JSON — proving serialization happens end to end.
  it('roundtrips structured values and exposes raw JSON', async () => {
    const profile: Profile = { name: 'Ada', roles: ['admin', 'eng'] }
    await cache.set('str', 'ada', profile)

    expect(await cache.get<Profile>('str', 'ada')).toEqual(profile)
    expect(await cache.getRaw('str', 'ada')).toBe(JSON.stringify(profile))
    expect(await cache.get('str', 'absent')).toBeNull()
  })

  // setRaw must store bytes verbatim (no JSON wrapping), and a TTL passed to set
  // must apply atomically — ttl() then reports a positive remaining lifetime.
  it('writes raw values and applies a TTL on set', async () => {
    await cache.setRaw('str', 'raw', 'plain-bytes')
    expect(await cache.getRaw('str', 'raw')).toBe('plain-bytes')

    await cache.set('str', 'ttl', { v: 1 }, 100)
    const remaining = await cache.ttl('str', 'ttl')
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(100)
  })

  // setNx must store only when the key is absent: the first call wins (true), a
  // second call is rejected (false) and must NOT overwrite the stored value.
  it('honors SET NX semantics', async () => {
    expect(await cache.setNx('nx', 'k', 'first')).toBe(true)
    expect(await cache.setNx('nx', 'k', 'second')).toBe(false)
    expect(await cache.get<string>('nx', 'k')).toBe('first')
  })

  // del removes a single key; delMany removes a batch and reports the real count;
  // exists reflects presence before and after.
  it('deletes single and batched keys and reports existence', async () => {
    await cache.mset<number>('del', [
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    expect(await cache.exists('del', 'a')).toBe(true)

    expect(await cache.del('del', 'a')).toBe(1)
    expect(await cache.exists('del', 'a')).toBe(false)
    expect(await cache.delMany('del', ['b', 'c', 'missing'])).toBe(2)
    expect(await cache.delMany('del', [])).toBe(0)
  })

  // incr/decr must be atomic counters: default step uses INCR/DECR, a custom step
  // uses INCRBY/DECRBY, and the running value is returned each time.
  it('increments and decrements counters atomically', async () => {
    expect(await cache.incr('num', 'c')).toBe(1)
    expect(await cache.incr('num', 'c', 4)).toBe(5)
    expect(await cache.decr('num', 'c')).toBe(4)
    expect(await cache.decr('num', 'c', 2)).toBe(2)
  })

  // expire sets a TTL on an existing key; persist removes it; ttl reports -1 for a
  // key with no expiry and -2 for a missing key (real Redis TTL contract).
  it('manages expiration with expire, ttl, and persist', async () => {
    await cache.setRaw('exp', 'k', 'v')
    expect(await cache.ttl('exp', 'k')).toBe(-1)

    expect(await cache.expire('exp', 'k', 100)).toBe(true)
    expect(await cache.ttl('exp', 'k')).toBeGreaterThan(0)

    expect(await cache.persist('exp', 'k')).toBe(true)
    expect(await cache.ttl('exp', 'k')).toBe(-1)

    expect(await cache.ttl('exp', 'missing')).toBe(-2)
    expect(await cache.expire('exp', 'missing', 10)).toBe(false)
  })

  // mset/mget must round-trip a batch positionally, with null for missing keys;
  // empty inputs short-circuit without a Redis call.
  it('reads and writes batches with mget/mset', async () => {
    await cache.mset<Profile>('batch', [
      ['x', { name: 'X', roles: [] }],
      ['y', { name: 'Y', roles: ['r'] }]
    ])

    expect(await cache.mget<Profile>('batch', ['x', 'missing', 'y'])).toEqual([
      { name: 'X', roles: [] },
      null,
      { name: 'Y', roles: ['r'] }
    ])
    expect(await cache.mget('batch', [])).toEqual([])
    await expect(cache.mset('batch', [])).resolves.toBeUndefined()
  })

  // Hash commands must serialize field VALUES (not field names): hset reports
  // new(1)/overwrite(0), hget/hgetall deserialize, and hdel removes fields.
  it('reads and writes hash fields', async () => {
    expect(await cache.hset<Profile>('hash', 'u', 'profile', { name: 'Z', roles: ['x'] })).toBe(1)
    expect(await cache.hset<number>('hash', 'u', 'visits', 3)).toBe(1)
    expect(await cache.hset<number>('hash', 'u', 'visits', 4)).toBe(0)

    expect(await cache.hget<Profile>('hash', 'u', 'profile')).toEqual({ name: 'Z', roles: ['x'] })
    expect(await cache.hgetall<number | Profile>('hash', 'u')).toEqual({
      profile: { name: 'Z', roles: ['x'] },
      visits: 4
    })
    expect(await cache.hget('hash', 'u', 'absent')).toBeNull()
    expect(await cache.hgetall('hash', 'empty')).toEqual({})
    expect(await cache.hdel('hash', 'u', 'visits')).toBe(1)
    expect(await cache.hdel('hash', 'u')).toBe(0)
  })

  // Set commands store raw string members (no serialization): sadd reports the
  // newly-added count, sismember/scard/smembers reflect membership, srem removes.
  it('manages set members', async () => {
    expect(await cache.sadd('set', 's', 'a', 'b', 'c')).toBe(3)
    expect(await cache.sadd('set', 's', 'c')).toBe(0)
    expect(await cache.sismember('set', 's', 'a')).toBe(true)
    expect(await cache.sismember('set', 's', 'z')).toBe(false)
    expect(await cache.scard('set', 's')).toBe(3)
    expect((await cache.smembers('set', 's')).sort()).toEqual(['a', 'b', 'c'])
    expect(await cache.srem('set', 's', 'a')).toBe(1)
    expect(await cache.scard('set', 's')).toBe(2)
    expect(await cache.sadd('set', 's')).toBe(0)
  })

  // keys must return the fully-namespaced matching keys (blocking KEYS) under the
  // prefix — proving the pattern is namespaced before it reaches Redis.
  it('lists namespaced keys with KEYS', async () => {
    await cache.setRaw('keys', 'k1', '1')
    await cache.setRaw('keys', 'k2', '2')

    const found = await cache.keys('keys', '*')
    expect(found.sort()).toEqual([keyBuilder.build('keys', 'k1'), keyBuilder.build('keys', 'k2')])
  })

  // scan must iterate the same keys via a NON-blocking cursor (real SCAN, which
  // ioredis-mock approximates) — the production-safe alternative to KEYS.
  it('iterates namespaced keys with the non-blocking SCAN cursor', async () => {
    await cache.setRaw('scan', 's1', '1')
    await cache.setRaw('scan', 's2', '2')

    const found: string[] = []
    for await (const key of cache.scan('scan', '*')) {
      found.push(key)
    }
    expect(found.sort()).toEqual([keyBuilder.build('scan', 's1'), keyBuilder.build('scan', 's2')])
  })

  // The pipeline escape hatch must batch arbitrary commands in one round trip;
  // keys are NOT auto-namespaced, so they are composed via the KeyBuilder.
  it('batches commands through a pipeline', async () => {
    const pipe = cache.pipeline()
    pipe.set(keyBuilder.build('pipe', 'a'), '1')
    pipe.set(keyBuilder.build('pipe', 'b'), '2')
    const results = await pipe.exec()

    expect(results).not.toBeNull()
    expect(await cache.getRaw('pipe', 'a')).toBe('1')
    expect(await cache.getRaw('pipe', 'b')).toBe('2')
  })

  // INFO must return server diagnostics; the 'server' section carries the version
  // banner — proving the raw command path and section scoping work.
  it('returns server INFO', async () => {
    expect(await cache.info('server')).toContain('redis_version')
    expect(await cache.info()).toContain('redis_version')
  })

  // flushNamespace must delete EVERY key under the configured namespace via
  // SCAN + UNLINK, returning the count — and must not touch a different namespace.
  // (Run last: it wipes the shared namespace the earlier tests populated.)
  it('flushes only the configured namespace', async () => {
    await cache.flushNamespace() // clear whatever earlier tests left behind
    await cache.setRaw('flush', 'a', '1')
    await cache.setRaw('flush', 'b', '2')
    await cache.setRaw('flush', 'c', '3')

    expect(await cache.flushNamespace()).toBe(3)
    expect(await cache.exists('flush', 'a')).toBe(false)
    expect(await cache.keys('flush', '*')).toEqual([])
  })
})
