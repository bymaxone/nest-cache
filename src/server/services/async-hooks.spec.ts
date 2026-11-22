/**
 * Unit tests for the host observability hooks when the host passes an async function.
 *
 * Layer: server. A hook typed `=> void` still accepts an async function, and a synchronous
 * `try`/`catch` does not see the rejected promise it returns; every call site must absorb it, or
 * the process dies on an unhandled rejection. One row per hook and call site.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'
import { PubSubService } from './pubsub.service'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { Redis } from 'ioredis'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return {
    __esModule: true,
    AbstractConnector: jest.requireActual<typeof import('ioredis')>('ioredis').AbstractConnector,
    Redis: Mock,
    default: Mock,
    Cluster: class FakeCluster {}
  }
})

/** A hook that is async and rejects, as an `async` arrow handed to a `=> void` slot does. */
const rejecting = (): jest.Mock => jest.fn(async () => Promise.reject(new Error('sink down')))

/** Lets a rejection that nobody handles reach the process-level event. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('an async host hook that rejects', () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }
  const connections: ConnectionManager[] = []
  const services: PubSubService[] = []

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', record)
  })

  afterEach(async () => {
    process.off('unhandledRejection', record)
    for (const pubsub of services.splice(0)) {
      await pubsub.onApplicationShutdown()
    }
    for (const connection of connections.splice(0)) {
      await connection.onApplicationShutdown()
    }
    jest.restoreAllMocks()
  })

  const connect = async (
    extra: Partial<BymaxCacheModuleOptions>,
    events?: ICacheEvents
  ): Promise<{ options: ReturnType<typeof applyDefaults>; connection: ConnectionManager }> => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'cc', ...extra })
    const connection = new ConnectionManager(options, events)
    await connection.onModuleInit()
    connections.push(connection)
    return { options, connection }
  }

  const pubsubOf = async (
    extra: Partial<BymaxCacheModuleOptions>,
    events: ICacheEvents
  ): Promise<{ pubsub: PubSubService; connection: ConnectionManager }> => {
    const { options, connection } = await connect(extra)
    const pubsub = new PubSubService(
      options,
      connection,
      new KeyBuilder(options),
      undefined,
      events
    )
    services.push(pubsub)
    return { pubsub, connection }
  }

  // The connection manager's own lifecycle events.
  it('does not escape from onEvent in the connection manager', async () => {
    const onEvent = rejecting()
    const { connection } = await connect({}, { onEvent })

    connection.getClient().emit('connect')
    await settle()

    expect(onEvent).toHaveBeenCalled()
    expect(unhandled).toEqual([])
  })

  // The command outcome.
  it('does not escape from onOperation after a command', async () => {
    const onOperation = rejecting()
    const { options, connection } = await connect({ events: { onOperation } })
    const cache = new CacheService(options, connection, new KeyBuilder(options))

    await cache.get('users', '1')
    await settle()

    expect(onOperation).toHaveBeenCalledWith('get', 'miss')
    expect(unhandled).toEqual([])
  })

  it('does not escape from onOperation when a scan finishes', async () => {
    const onOperation = rejecting()
    const { options, connection } = await connect({ events: { onOperation } })
    const cache = new CacheService(options, connection, new KeyBuilder(options))

    for await (const key of cache.scan('users', '*')) {
      void key
    }
    await settle()

    expect(onOperation).toHaveBeenCalledWith('scan', 'ok')
    expect(unhandled).toEqual([])
  })

  // A message that waits for a handler slot, then one that finds the queue full, then one whose
  // handler throws.
  it('does not escape from onQueue or from onEvent when a message is dropped', async () => {
    const onQueue = rejecting()
    const onEvent = rejecting()
    const { pubsub } = await pubsubOf(
      { pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: 1 },
      { onQueue, onEvent }
    )
    await pubsub.subscribe<number>('bound', () => new Promise<void>(() => undefined))

    for (let n = 0; n < 4; n += 1) {
      await pubsub.publish('bound', n)
    }
    await settle()

    expect(onQueue).toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ reason: 'handler_queue_full' })
    )
    expect(unhandled).toEqual([])
  })

  it('does not escape from onEvent when a handler throws', async () => {
    const onEvent = rejecting()
    const { pubsub } = await pubsubOf({}, { onEvent })
    await pubsub.subscribe<number>('boom', () => {
      throw new Error('handler down')
    })

    await pubsub.publish('boom', 1)
    await settle()

    expect(onEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ reason: 'handler_error' })
    )
    expect(unhandled).toEqual([])
  })

  it('does not escape from onEvent when the subscriber is forced closed', async () => {
    const onEvent = rejecting()
    const { options, connection } = await connect({})
    const fake = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockRejectedValue(new Error('quit refused')),
      disconnect: jest.fn()
    }
    jest.spyOn(connection, 'createSubscriberClient').mockReturnValue(fake as unknown as Redis)
    const pubsub = new PubSubService(options, connection, new KeyBuilder(options), undefined, {
      onEvent
    })
    await pubsub.subscribe('events', () => undefined)

    await pubsub.onApplicationShutdown()
    await settle()

    expect(onEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ reason: 'forced_disconnect' })
    )
    expect(unhandled).toEqual([])
  })
})
