/**
 * End-to-end tests for the connection lifecycle against a REAL Redis
 * (Testcontainers).
 *
 * Verifies that the booted module actually talks to a server (value roundtrip,
 * health check) and shuts down gracefully (`close()` quits the client without
 * error) — behaviors tied to a real socket rather than the in-memory mock.
 */
import { CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

describe('Connection lifecycle E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-conn' })
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // A structured value must roundtrip through a real server, proving the URL
  // connection, key namespacing, and serializer all line up over a live socket.
  it('roundtrips a value against a real server', async () => {
    await cache.set('session', 'live', { token: 'abc', ttl: 60 })

    expect(await cache.get('session', 'live')).toEqual({ token: 'abc', ttl: 60 })
  })

  // isHealthy must report true while the connection is up (PING → PONG).
  it('reports a healthy connection', async () => {
    expect(await cache.isHealthy()).toBe(true)
    expect(await cache.ping()).toBe('PONG')
  })

  // close() must run the module's onModuleDestroy and quit the client gracefully
  // — no timeout, no thrown error. A dedicated throwaway app (not the shared one,
  // which the suite keeps open until afterAll) keeps this order-independent.
  it('shuts down gracefully', async () => {
    const throwaway = await bootCacheApp({
      connection: { url: redis.url },
      namespace: 'e2e-conn-shutdown'
    })

    await expect(throwaway.close()).resolves.toBeUndefined()
  })
})
