/**
 * End-to-end tests for {@link PubSubService} over a booted NestJS app.
 *
 * Uses `ioredis-mock`, whose in-memory Pub/Sub bus is shared across the main and
 * dedicated subscriber connections — enough to verify the publish→subscribe and
 * pattern-subscribe round trips through the real module wiring (namespacing,
 * serializer, dedicated subscriber connection).
 */
import { PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'

import type { TestingModule } from '@nestjs/testing'

// Swap real ioredis for the in-memory mock (its Pub/Sub bus is process-global).
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

// Yields to the event loop (a macrotask after the pending microtasks) so the
// async 'message'/'pmessage' listeners and ioredis-mock's delivery complete
// before assertions — deterministic, unlike a fixed wall-clock sleep.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('PubSubService E2E (ioredis-mock)', () => {
  let app: TestingModule
  let pubsub: PubSubService

  beforeAll(async () => {
    app = await bootCacheApp({ connection: { host: 'localhost' }, namespace: 'e2e-ps' })
    pubsub = app.get(PubSubService)
  })

  afterAll(async () => {
    await app?.close()
  })

  // A published message must reach a channel subscriber deserialized — the full
  // publish→subscribe path across the main and dedicated subscriber connections.
  it('delivers a published message to a channel subscriber', async () => {
    const received: Array<{ name: string }> = []
    await pubsub.subscribe<{ name: string }>('channel-direct', (message) => {
      received.push(message)
    })

    await pubsub.publish('channel-direct', { name: 'Grace' })
    await tick()

    expect(received).toEqual([{ name: 'Grace' }])
  })

  // A pattern subscription must receive matching messages with the concrete
  // namespaced channel and the matched namespaced pattern.
  it('delivers pattern-matched messages with channel and pattern', async () => {
    const received: Array<{ message: string; channel: string; pattern: string }> = []
    await pubsub.psubscribe<string>('orders:*', (message, channel, pattern) => {
      received.push({ message, channel, pattern })
    })

    await pubsub.publish('orders:42', 'created')
    await tick()

    expect(received).toEqual([
      { message: 'created', channel: 'e2e-ps:orders:42', pattern: 'e2e-ps:orders:*' }
    ])
  })

  // The unsubscribe handle returned by subscribe() must stop further delivery.
  it('stops delivery after unsubscribe', async () => {
    const received: string[] = []
    const off = await pubsub.subscribe<string>('channel-off', (message) => {
      received.push(message)
    })

    await off()
    await pubsub.publish('channel-off', 'ignored')
    await tick()

    expect(received).toEqual([])
  })
})
