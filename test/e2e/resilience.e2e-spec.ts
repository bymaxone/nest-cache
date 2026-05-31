/**
 * Resilience / failure-mode end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Proves the behaviour that actually matters in production and that a mock cannot
 * exercise: when the server bounces, ioredis transparently reconnects and the
 * cache resumes serving — and the dedicated Pub/Sub subscriber re-subscribes on
 * its own, so delivery survives a restart. The container is restarted live in the
 * middle of the test.
 */
import { CacheService, PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { getFreePort } from './helpers/free-port'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** Polls `isHealthy()` until the connection recovers, or throws on timeout. */
async function waitUntilHealthy(cache: CacheService, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cache.isHealthy()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`connection did not recover within ${timeoutMs}ms`)
}

describe('Resilience E2E (real Redis)', () => {
  let redis: StartedRedis | undefined
  let app: TestingModule | undefined
  let cache: CacheService

  beforeAll(async () => {
    // A FIXED host port survives the restart, so the client reconnects to the same
    // address (a random Testcontainers port is remapped on restart → no recovery).
    const hostPort = await getFreePort()
    redis = await startRedisContainer({ hostPort })
    app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-resilience' })
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // After the server restarts (connection dropped), ioredis must auto-reconnect
  // and the cache must resume serving — the core production-resilience guarantee.
  it('reconnects and resumes serving after the server restarts', async () => {
    await cache.setRaw('res', 'before', 'x')
    expect(await cache.isHealthy()).toBe(true)

    await redis.container.restart()

    await waitUntilHealthy(cache, 20_000)
    await cache.setRaw('res', 'after', 'y')
    expect(await cache.getRaw('res', 'after')).toBe('y')
  }, 40_000)

  // The dedicated subscriber connection must re-subscribe automatically after a
  // reconnect, so a message published post-restart is still delivered. ioredis
  // owns the re-subscription; this proves the Pub/Sub facade rides on top of it.
  it('re-subscribes the Pub/Sub connection after a restart', async () => {
    const pubsub = app.get(PubSubService)
    const received: string[] = []
    await pubsub.subscribe<string>('res-channel', (message) => {
      received.push(message)
    })

    await redis.container.restart()
    await waitUntilHealthy(cache, 20_000)

    // Retry the publish until the re-subscribed listener catches it (the subscriber
    // reconnects independently of the main client, so allow a short settle window).
    const deadline = Date.now() + 15_000
    while (received.length === 0 && Date.now() < deadline) {
      await pubsub.publish('res-channel', 'after-restart')
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    expect(received).toContain('after-restart')
  }, 40_000)
})
