/**
 * Pub/Sub fan-out end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Layer: server. Many subscriptions on the one subscriber connection: Node must not report a
 * possible listener leak for the library's own connection, and every handler must still receive
 * its messages, in the order they were published.
 */
import { PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

describe('Pub/Sub fan-out (real Redis)', () => {
  let redis: StartedRedis

  beforeAll(async () => {
    redis = await startRedisContainer()
  }, 60_000)

  afterAll(async () => {
    await redis?.container.stop().catch(() => undefined)
  })

  // Scenario: twelve channel subscriptions and twelve pattern subscriptions on one subscriber.
  // Rule: Node reports no possible listener leak, and each handler gets the 100 messages of its
  // channel in publish order.
  it('reports no listener leak and delivers in order with many subscriptions', async () => {
    const warnings: string[] = []
    const onWarning = (warning: Error): void =>
      void warnings.push(`${warning.name}: ${warning.message}`)
    process.on('warning', onWarning)
    const app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-fanout' })
    try {
      const pubsub = app.get(PubSubService)
      const received = new Map<string, number[]>()
      for (let i = 0; i < 12; i += 1) {
        received.set(`c${i}`, [])
        await pubsub.subscribe<number>(
          `c${i}`,
          (message) => void received.get(`c${i}`)?.push(message)
        )
        await pubsub.psubscribe(`p${i}:*`, () => undefined)
      }

      for (let n = 0; n < 100; n += 1) {
        await pubsub.publish('c0', n)
        await pubsub.publish('c11', n)
      }
      const deadline = Date.now() + 5_000
      while ((received.get('c11')?.length ?? 0) < 100 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await new Promise((resolve) => setImmediate(resolve))

      const expected = Array.from({ length: 100 }, (_, n) => n)
      expect(warnings).toEqual([])
      expect(received.get('c0')).toEqual(expected)
      expect(received.get('c11')).toEqual(expected)
    } finally {
      process.off('warning', onWarning)
      await app.close()
    }
  }, 30_000)
})
