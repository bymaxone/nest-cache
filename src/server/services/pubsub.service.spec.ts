/**
 * Unit tests for {@link PubSubService}.
 *
 * Layer: server. Drives publish→subscribe and publish→psubscribe round trips
 * over ioredis-mock (which shares a pub/sub bus across instances), plus channel
 * namespacing, the cross-channel ignore path, handler-error swallowing, listener
 * detachment, and the graceful / forced subscriber shutdown.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { PubSubService } from './pubsub.service'

import type { ResolvedOptions } from '../config/resolved-options'
import type { Redis } from 'ioredis'

// Swap real ioredis for the in-memory mock so the main client and the dedicated
// subscriber connection share a working pub/sub bus without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

/** Lets the async 'message'/'pmessage' listeners run before assertions. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

describe('PubSubService', () => {
  let options: ResolvedOptions
  let connection: ConnectionManager
  let keyBuilder: KeyBuilder
  let pubsub: PubSubService

  beforeEach(async () => {
    options = applyDefaults({ connection: { host: 'h' }, namespace: 'ps' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    keyBuilder = new KeyBuilder(options)
    pubsub = new PubSubService(options, connection, keyBuilder)
  })

  afterEach(async () => {
    await pubsub.onModuleDestroy()
    await connection.onModuleDestroy()
  })

  // A published message must reach the subscriber's handler deserialized, and the
  // channel must be namespaced on the wire (publish called with `ps:events`).
  it('delivers a namespaced, deserialized message to the handler', async () => {
    const publishSpy = jest.spyOn(connection.getClient(), 'publish')
    const received: string[] = []
    await pubsub.subscribe<string>('events', (message) => {
      received.push(message)
    })

    const subscribers = await pubsub.publish('events', 'hello')
    await tick()

    expect(received).toEqual(['hello'])
    expect(subscribers).toBe(1)
    expect(publishSpy).toHaveBeenCalledWith('ps:events', '"hello"')
  })

  // A throwing handler must be swallowed (never crash the shared subscriber), and
  // a second subscription on the same connection must keep working — this also
  // exercises the lazy-subscriber reuse and the cross-channel ignore branch.
  it('swallows handler errors and keeps the shared subscriber alive', async () => {
    await pubsub.subscribe('boom', () => {
      throw new Error('handler failed')
    })
    const received: string[] = []
    await pubsub.subscribe<string>('safe', (message) => {
      received.push(message)
    })

    await pubsub.publish('boom', 'ignored')
    await pubsub.publish('safe', 'ok')
    await tick()

    expect(received).toEqual(['ok'])
  })

  // A swallowed handler error must be forwarded to the observability callback as
  // an 'error' event (role 'subscriber', reason 'handler_error') so it does not
  // vanish silently. (A distinct channel keeps the shared mock bus uncontended.)
  it('forwards a handler error to the events callback', async () => {
    const onEvent = jest.fn()
    const observed = new PubSubService(options, connection, keyBuilder, undefined, { onEvent })
    await observed.subscribe('obs', () => {
      throw new Error('handler boom')
    })

    await observed.publish('obs', 'x')
    await tick()

    expect(onEvent).toHaveBeenCalledWith('error', {
      role: 'subscriber',
      reason: 'handler_error',
      channel: 'ps:obs',
      error: 'handler boom'
    })
    await observed.onModuleDestroy()
  })

  // A non-Error handler throw must still be stringified into the forwarded event
  // (the non-Error branch of the message extractor).
  it('stringifies a non-Error handler throw for the events callback', async () => {
    const onEvent = jest.fn()
    const observed = new PubSubService(options, connection, keyBuilder, undefined, { onEvent })
    await observed.subscribe('obs', () => {
      throw 'plain-string-failure'
    })

    await observed.publish('obs', 'x')
    await tick()

    expect(onEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'plain-string-failure' })
    )
    await observed.onModuleDestroy()
  })

  // A throwing observability callback must itself be swallowed — a faulty
  // onEvent must never crash the subscriber either.
  it('swallows a throwing events callback', async () => {
    const onEvent = jest.fn(() => {
      throw new Error('observability boom')
    })
    const observed = new PubSubService(options, connection, keyBuilder, undefined, { onEvent })
    await observed.subscribe('obs', () => {
      throw new Error('handler boom')
    })

    await observed.publish('obs', 'x')
    await tick()

    expect(onEvent).toHaveBeenCalled()
    await observed.onModuleDestroy()
  })

  // An events bag without an onEvent must not throw — covers the `onEvent?.`
  // nullish short-circuit when a handler fails.
  it('tolerates an events bag with no onEvent', async () => {
    const observed = new PubSubService(options, connection, keyBuilder, undefined, {})
    await observed.subscribe('obs', () => {
      throw new Error('handler boom')
    })

    await expect(observed.publish('obs', 'x')).resolves.toEqual(expect.any(Number))
    await tick()
    await observed.onModuleDestroy()
  })

  // The unsubscribe returned by subscribe() must detach the listener (by the
  // 'message' event name) so a later publish is not delivered.
  it('detaches the listener via the returned unsubscribe', async () => {
    const subscriber = connection.createSubscriberClient() as Redis
    jest.spyOn(connection, 'createSubscriberClient').mockReturnValue(subscriber)
    const offSpy = jest.spyOn(subscriber, 'off')
    const received: string[] = []
    const off = await pubsub.subscribe<string>('events', (message) => {
      received.push(message)
    })

    await off()
    await pubsub.publish('events', 'after')
    await tick()

    expect(received).toEqual([])
    // Pin the 'message' event name on .off (channel unsubscribe alone would also
    // stop delivery, so without this the .off('message') mutant survives).
    expect(offSpy).toHaveBeenCalledWith('message', expect.any(Function))
  })

  // psubscribe must deliver messages from any matching channel with the concrete
  // channel and pattern, and its unsubscribe must pattern-unsubscribe.
  it('delivers pattern-matched messages and unsubscribes the pattern', async () => {
    const subscriber = connection.createSubscriberClient() as Redis
    jest.spyOn(connection, 'createSubscriberClient').mockReturnValue(subscriber)
    const offSpy = jest.spyOn(subscriber, 'off')
    const received: Array<{ message: string; channel: string; pattern: string }> = []
    const off = await pubsub.psubscribe<string>('users:*', (message, channel, pattern) => {
      received.push({ message, channel, pattern })
    })

    await pubsub.publish('users:1', 'hi')
    await tick()
    expect(received).toEqual([{ message: 'hi', channel: 'ps:users:1', pattern: 'ps:users:*' }])

    await off()
    await pubsub.publish('users:1', 'after')
    await tick()
    expect(received).toHaveLength(1)
    // Pin the 'pmessage' event name on .off (pattern unsubscribe alone would also
    // stop delivery, so without this the .off('pmessage') mutant survives).
    expect(offSpy).toHaveBeenCalledWith('pmessage', expect.any(Function))
  })

  // A throwing pattern handler must be swallowed, and a non-matching pattern
  // subscription must ignore the message (the matchedPattern !== fullPattern path).
  it('swallows pattern-handler errors and ignores non-matching patterns', async () => {
    await pubsub.psubscribe('boom:*', () => {
      throw new Error('pattern handler failed')
    })
    const received: string[] = []
    await pubsub.psubscribe<string>('safe:*', (message) => {
      received.push(message)
    })

    await pubsub.publish('boom:1', 'ignored')
    await pubsub.publish('safe:1', 'ok')
    await tick()

    expect(received).toEqual(['ok'])
  })

  // onModuleDestroy must be a safe no-op when no subscriber was ever opened.
  it('is a no-op on destroy when no subscriber exists', async () => {
    await expect(pubsub.onModuleDestroy()).resolves.toBeUndefined()
  })

  // When the subscriber fails to quit gracefully, destroy must force a disconnect.
  it('forces a disconnect when the subscriber fails to quit', async () => {
    const fakeSubscriber = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockRejectedValue(new Error('quit refused')),
      disconnect: jest.fn()
    }
    jest
      .spyOn(connection, 'createSubscriberClient')
      .mockReturnValue(fakeSubscriber as unknown as Redis)
    await pubsub.subscribe('events', () => undefined)

    await pubsub.onModuleDestroy()

    expect(fakeSubscriber.quit).toHaveBeenCalled()
    expect(fakeSubscriber.disconnect).toHaveBeenCalled()
  })

  // Destroying twice after a subscriber was opened must be idempotent: the second
  // destroy is a clean no-op (the subscriber reference was cleared), not a repeat
  // tear-down. Pins the `this.subscriber = null` clear (quit must run only once).
  it('is idempotent across repeated destroys once a subscriber exists', async () => {
    const fakeSubscriber = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn()
    }
    jest
      .spyOn(connection, 'createSubscriberClient')
      .mockReturnValue(fakeSubscriber as unknown as Redis)
    await pubsub.subscribe('events', () => undefined)

    await pubsub.onModuleDestroy()
    await pubsub.onModuleDestroy()

    expect(fakeSubscriber.quit).toHaveBeenCalledTimes(1)
    expect(fakeSubscriber.disconnect).not.toHaveBeenCalled()
  })
})
