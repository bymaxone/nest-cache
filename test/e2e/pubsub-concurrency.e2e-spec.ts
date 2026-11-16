/**
 * Pub/Sub handler bounds end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Layer: server. With one handler slot, messages published to a real Redis reach a slow handler one
 * at a time and in the order they were published; with room for none to wait, the ones that find
 * the slot taken are dropped and reported.
 */
import { PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

describe('Pub/Sub handler bounds (real Redis)', () => {
  let redis: StartedRedis

  beforeAll(async () => {
    redis = await startRedisContainer()
  }, 60_000)

  afterAll(async () => {
    await redis?.container.stop().catch(() => undefined)
  })

  // Scenario: fifty messages are published in a burst to a handler that takes a few milliseconds.
  // Rule: with one slot the handler never runs twice at once and sees the messages in publish order;
  // with no bound it does overlap.
  it('runs a slow handler one message at a time and in publish order with one slot', async () => {
    const results: Record<string, { maxRunning: number; order: number[] }> = {}
    for (const [name, bound] of [
      ['bounded', 1],
      ['free', undefined]
    ] as const) {
      const app = await bootCacheApp({
        connection: { url: redis.url },
        namespace: `e2e-bound-${name}`,
        ...(bound === undefined ? {} : { pubsubMaxConcurrentHandlers: bound })
      })
      try {
        const pubsub = app.get(PubSubService)
        const order: number[] = []
        let running = 0
        let maxRunning = 0
        await pubsub.subscribe<number>('burst', async (message) => {
          running += 1
          maxRunning = Math.max(maxRunning, running)
          await new Promise((resolve) => setTimeout(resolve, 3))
          order.push(message)
          running -= 1
        })

        for (let n = 0; n < 50; n += 1) {
          await pubsub.publish('burst', n)
        }
        const deadline = Date.now() + 10_000
        while (order.length < 50 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        results[name] = { maxRunning, order }
      } finally {
        await app.close()
      }
    }

    const expected = Array.from({ length: 50 }, (_, n) => n)
    expect(results['bounded']).toEqual({ maxRunning: 1, order: expected })
    expect(results['free']?.maxRunning).toBeGreaterThan(1)
  }, 40_000)

  // Scenario: one slot and no room to wait, a handler that is busy, and a burst of messages.
  // Rule: the messages that find the slot taken are dropped and reported with the channel and no
  // payload: the first at once and the rest as one summary; the handler ran only what it admitted.
  it('drops and reports the messages that find no slot when nothing may wait', async () => {
    const events: Record<string, unknown>[] = []
    const app = await bootCacheApp({
      connection: { url: redis.url },
      namespace: 'e2e-bound-drop',
      pubsubMaxConcurrentHandlers: 1,
      pubsubMaxQueuedMessages: 0,
      events: {
        onEvent: (_name, data) => {
          if (data['reason'] === 'handler_queue_full') {
            events.push(data)
          }
        }
      }
    })
    try {
      const pubsub = app.get(PubSubService)
      const ran: number[] = []
      let release: () => void = () => undefined
      await pubsub.subscribe<number>('busy', (message) => {
        ran.push(message)
        return new Promise<void>((resolve) => {
          release = resolve
        })
      })

      for (let n = 0; n < 20; n += 1) {
        await pubsub.publish('busy', n)
      }
      const deadline = Date.now() + 5_000
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      release()

      expect(ran).toHaveLength(1)
      expect(events).toEqual([
        { role: 'subscriber', reason: 'handler_queue_full', channel: 'e2e-bound-drop:busy' }
      ])
    } finally {
      await app.close()
    }
  }, 30_000)
})
