/**
 * Unit tests for how {@link PubSubService} fans a message out to its handlers.
 *
 * Layer: server. Over ioredis-mock: the number of listeners the shared subscriber carries, the
 * isolation of one handler's failure from the others on the same channel, and the order in which
 * handlers start.
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

/** Yields to the event loop after a publish so Promise-chain listeners settle before assertions. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

describe('PubSubService dispatch', () => {
  let options: ResolvedOptions
  let connection: ConnectionManager
  let keyBuilder: KeyBuilder
  let pubsub: PubSubService

  beforeEach(async () => {
    options = applyDefaults({ connection: { host: 'h' }, namespace: 'dp' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    keyBuilder = new KeyBuilder(options)
    pubsub = new PubSubService(options, connection, keyBuilder)
  })

  afterEach(async () => {
    await pubsub.onApplicationShutdown()
    await connection.onApplicationShutdown()
  })

  // Scenario: an application holds more subscriptions than an EventEmitter tolerates listeners.
  // Rule: the subscriber carries one `message` and one `pmessage` listener however many handlers
  // are registered, so a message is not offered to every subscription in turn. (The leak warning a
  // real ioredis client prints past ten listeners is asserted end to end; the mock does not print it.)
  it('keeps one message listener and one pmessage listener for any number of subscriptions', async () => {
    const subscriber = connection.createSubscriberClient() as Redis
    jest.spyOn(connection, 'createSubscriberClient').mockReturnValue(subscriber)

    for (let i = 0; i < 12; i += 1) {
      await pubsub.subscribe(`c${i}`, () => undefined)
      await pubsub.psubscribe(`p${i}:*`, () => undefined)
    }

    expect([subscriber.listenerCount('message'), subscriber.listenerCount('pmessage')]).toEqual([
      1, 1
    ])
  })

  // Scenario: two handlers on one channel and the first throws.
  // Rule: the second still runs and the failure is reported exactly as it is for a single handler,
  // and the next message reaches both again.
  it('isolates a throwing handler from the others on the same channel', async () => {
    const onEvent = jest.fn()
    const observed = new PubSubService(options, connection, keyBuilder, undefined, { onEvent })
    const received: string[] = []
    await observed.subscribe('shared', () => {
      throw new Error('first failed')
    })
    await observed.subscribe<string>('shared', (message) => {
      received.push(message)
    })

    await observed.publish('shared', 'one')
    await observed.publish('shared', 'two')
    await tick()

    expect(received).toEqual(['one', 'two'])
    expect(onEvent.mock.calls).toEqual([
      [
        'error',
        { role: 'subscriber', reason: 'handler_error', channel: 'dp:shared', error: 'first failed' }
      ],
      [
        'error',
        { role: 'subscriber', reason: 'handler_error', channel: 'dp:shared', error: 'first failed' }
      ]
    ])
    await observed.onApplicationShutdown()
  })

  // Scenario: a payload one handler's validator refuses while another handler on the channel has none.
  // Rule: the refusal is that handler's own and the other still receives the message.
  it('applies each handler its own read options', async () => {
    const onEvent = jest.fn()
    const observed = new PubSubService(options, connection, keyBuilder, undefined, { onEvent })
    const strict: unknown[] = []
    const lax: unknown[] = []
    await observed.subscribe('mixed', (message) => void strict.push(message), {
      validate: (value: unknown): value is { n: number } => typeof value === 'object'
    })
    await observed.subscribe('mixed', (message) => void lax.push(message))

    await observed.publish('mixed', 7)
    await tick()

    expect([strict, lax]).toEqual([[], [7]])
    expect(onEvent).toHaveBeenCalledTimes(1)
    await observed.onApplicationShutdown()
  })

  // Scenario: the service has to create its subscriber again after the first attempt failed.
  // Rule: the listeners go on the subscriber that was kept, once, and the failed attempt leaves no
  // state behind that would double them.
  it('attaches the dispatcher once to the subscriber it keeps after a failed creation', async () => {
    const subscriber = connection.createSubscriberClient() as Redis
    jest
      .spyOn(connection, 'createSubscriberClient')
      .mockImplementationOnce(() => {
        throw new Error('creation failed')
      })
      .mockReturnValue(subscriber)

    await expect(pubsub.subscribe('late', () => undefined)).rejects.toThrow('creation failed')
    await pubsub.subscribe('late', () => undefined)
    await pubsub.subscribe('later', () => undefined)

    expect([subscriber.listenerCount('message'), subscriber.listenerCount('pmessage')]).toEqual([
      1, 1
    ])
  })

  // Scenario: five messages in a row to one handler whose work takes longer for the earlier ones.
  // Rule: the handler starts them in the order they arrived, even though it does not wait for one
  // to finish before the next starts.
  it('starts a handler on messages in the order they arrived', async () => {
    const started: number[] = []
    const finished: number[] = []
    await pubsub.subscribe<number>('ordered', async (message) => {
      started.push(message)
      await new Promise((resolve) => setTimeout(resolve, (5 - message) * 4))
      finished.push(message)
    })

    for (let n = 0; n < 5; n += 1) {
      await pubsub.publish('ordered', n)
    }
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(finished).toEqual([4, 3, 2, 1, 0])
  })

  // Scenario: the only handler of a channel is removed.
  // Rule: a later message reaches nobody, and a handler added afterwards on the same channel is the
  // only one called.
  it('stops calling a removed handler and calls only the one added after it', async () => {
    const calls: string[] = []
    const off = await pubsub.subscribe('swap', () => void calls.push('old'))
    await off()
    await pubsub.subscribe('swap', () => void calls.push('new'))

    await pubsub.publish('swap', 'x')
    await tick()

    expect(calls).toEqual(['new'])
  })
})
