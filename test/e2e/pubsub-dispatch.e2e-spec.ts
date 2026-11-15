/**
 * Pub/Sub fan-out end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Layer: server. Many subscriptions on the one subscriber connection: the real ioredis client must
 * carry fewer listeners than the count at which Node reports a possible leak, and every handler
 * must still receive its messages, in the order they were published.
 */
import { PubSubService } from '@bymax-one/nest-cache'

import { ConnectionManager } from '../../src/server/connection/connection.manager'

import type { Redis } from 'ioredis'

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
  // Rule: the subscriber carries one listener of each kind, well under the ten an emitter allows
  // before Node reports a possible leak (the jest sandbox does not see that warning, so the count
  // is read from the client), and each handler gets the 100 messages of its channel in publish order.
  it('keeps the subscriber under the emitter listener limit and delivers in order', async () => {
    const app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-fanout' })
    const create = jest.spyOn(app.get(ConnectionManager), 'createSubscriberClient')
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
      const subscriber = create.mock.results[0]?.value as Redis
      expect(
        [subscriber.listenerCount('message'), subscriber.listenerCount('pmessage')].map(
          (count) => count < subscriber.getMaxListeners()
        )
      ).toEqual([true, true])
      expect(received.get('c0')).toEqual(expected)
      expect(received.get('c11')).toEqual(expected)
    } finally {
      await app.close()
    }
  }, 30_000)
})
