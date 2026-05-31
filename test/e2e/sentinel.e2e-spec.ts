/**
 * End-to-end tests for sentinel mode against a REAL Redis Sentinel (Testcontainers).
 *
 * Proves the second advertised topology: `forRoot({ mode: 'sentinel' })` resolves
 * the master through the sentinel and serves cache operations against it. Uses the
 * `sentinel.natMap` passthrough to translate the sentinel-announced master IP to
 * the reachable host (the Docker NAT case; also relevant to k8s NAT). Boots its
 * own master+sentinel and tears them down in `afterAll`.
 */
import { CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisSentinel, type StartedRedisSentinel } from './helpers/start-redis-sentinel'

import type { TestingModule } from '@nestjs/testing'

describe('Redis Sentinel topology E2E (real sentinel)', () => {
  let redis: StartedRedisSentinel | undefined
  let app: TestingModule | undefined
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisSentinel()
    app = await bootCacheApp({
      mode: 'sentinel',
      sentinel: { name: redis.name, sentinels: redis.sentinels, natMap: redis.natMap },
      namespace: 'e2e-sentinel'
    })
    cache = app.get(CacheService)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await redis?.sentinel.stop()
    await redis?.master.stop()
    await redis?.network.stop()
  })

  // The cache must resolve the master via the sentinel and round-trip a value —
  // proving the sentinel discovery + natMap rewrite reach the real master.
  it('resolves the master via the sentinel and serves cache operations', async () => {
    await cache.set('user', 'sentinel', { name: 'Ada', tier: 'pro' })

    expect(await cache.get('user', 'sentinel')).toEqual({ name: 'Ada', tier: 'pro' })
    expect(await cache.isHealthy()).toBe(true)
  })

  // A counter must increment atomically through the sentinel-resolved master,
  // exercising a second command family over the discovered connection.
  it('runs numeric commands through the sentinel-resolved master', async () => {
    expect(await cache.incr('metric', 'hits')).toBe(1)
    expect(await cache.incr('metric', 'hits', 4)).toBe(5)
  })
})
