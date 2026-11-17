/**
 * End-to-end proof that the library writes no key of its own, against a REAL Redis (Testcontainers).
 *
 * A caller-chosen key can only collide with a library structure if the library keeps one. After a
 * workload that uses every service (strings, batches, hashes, sets, counters, expiry, Lua, Pub/Sub
 * and the administration reads), the server holds exactly the keys the caller built through the
 * key builder, and nothing else.
 */
import { CacheService, KeyBuilder, PubSubService } from '@bymax-one/nest-cache'
import { CacheAdminService, CacheStatusService, type CacheScope } from '@bymax-one/nest-cache/admin'
import { Redis } from 'ioredis'

import { bootAdminApp } from './fixtures/test-admin-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

const NAMESPACE = 'e2e-own-keys'
const SCOPES: readonly CacheScope[] = [
  {
    id: 'cache',
    label: 'Application cache',
    pattern: `${NAMESPACE}:*`,
    isReadable: true,
    origin: 'the application namespace'
  }
]
const COUNTER_LUA = 'return redis.call("INCRBY", KEYS[1], ARGV[1])'

describe('the library writes no key of its own (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let inspector: Redis

  beforeAll(async () => {
    redis = await startRedisContainer()
    inspector = new Redis(redis.url)
    app = await bootAdminApp(
      {
        connection: { url: redis.url },
        namespace: NAMESPACE,
        scripts: [{ name: 'counter', lua: COUNTER_LUA }]
      },
      { scopes: SCOPES }
    )
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    inspector?.disconnect()
    await redis?.container.stop()
  })

  // Scenario: every service is used once, including the ones that could plausibly keep state in
  // Redis (scripts, Pub/Sub, the administration reads).
  // Rule: the keys the server holds are exactly the keys the caller built, and the keyspace
  // outside the namespace is empty.
  it('leaves only caller-built keys in the keyspace after a mixed workload', async () => {
    const cache = app.get(CacheService)
    const keys = app.get(KeyBuilder)
    const pubsub = app.get(PubSubService)
    const admin = app.get(CacheAdminService)
    const status = app.get(CacheStatusService)

    await cache.set('str', 'a', { n: 1 })
    await cache.set('str', 'ttl', 'x', 600)
    await cache.setRaw('raw', 'a', 'plain')
    await cache.setNx('nx', 'a', 1)
    await cache.incr('count', 'hits')
    await cache.decr('count', 'misses')
    await cache.mset('batch', [
      ['x', 1],
      ['y', 2]
    ])
    await cache.mget('batch', ['x', 'y', 'none'])
    await cache.hset('hash', 'h', 'field', 'v')
    await cache.sadd('set', 's', 'm1', 'm2')
    await cache.expire('str', 'a', 900)
    await cache.del('raw', 'a')
    await cache.eval('counter', ['script:counter'], ['3'])

    const received: unknown[] = []
    const unsubscribe = await pubsub.subscribe('events', (message) => {
      received.push(message)
    })
    await pubsub.publish('events', { ok: true })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await unsubscribe()
    expect(received).toEqual([{ ok: true }])

    const page = await admin.listKeys('cache')
    for (const entry of page.entries) {
      await admin.describeKey('cache', entry.key)
      await admin.revealValue('cache', entry.key)
    }
    await status.health()
    await status.stats()

    const callerBuilt = [
      keys.build('str', 'a'),
      keys.build('str', 'ttl'),
      keys.build('nx', 'a'),
      keys.build('count', 'hits'),
      keys.build('count', 'misses'),
      keys.build('batch', 'x'),
      keys.build('batch', 'y'),
      keys.build('hash', 'h'),
      keys.build('set', 's'),
      keys.applyNamespace('script:counter')
    ].sort()

    expect((await inspector.keys('*')).sort()).toEqual(callerBuilt)
    expect(await inspector.dbsize()).toBe(callerBuilt.length)
  })
})
