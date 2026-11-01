/**
 * Unit tests for {@link createConnectionManager}.
 *
 * Layer: server. Pins the contract of the factory: it validates and defaults the options
 * exactly as `BymaxCacheModule.forRoot` does, and what it returns is a lifecycle-managed
 * `ConnectionManager` that Nest connects on init and quits on shutdown.
 */
import { EventEmitter } from 'node:events'

import { Test } from '@nestjs/testing'

import { BymaxCacheModule } from '../bymax-cache.module'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from './connection.manager'
import { createConnectionManager } from './create-connection-manager'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

interface CapturedRedis extends EventEmitter {
  status: string
  options: Record<string, unknown>
  quit: jest.Mock
  disconnect: jest.Mock
}

// Hoisted registry the mock factory fills with each constructed client. `var` is required so
// it is initialized before the transpiler-hoisted import triggers the factory.
var redisInstances: CapturedRedis[]

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter implements CapturedRedis {
    // Already ready: onModuleInit returns without waiting for a socket.
    status = 'ready'
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      redisInstances.push(this)
    }
  }
  class FakeCluster extends FakeRedis {}
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeCluster, default: FakeRedis }
})

/** What a throw carries, so two throws can be compared as the same error. */
const failureOf = (run: () => unknown): { code: string; details: unknown } => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CacheException)
    const { code, details } = error as CacheException
    return { code, details }
  }
  throw new Error('expected the call to throw')
}

describe('createConnectionManager', () => {
  beforeEach(() => {
    redisInstances = []
  })

  // The factory returns the library's own manager class, not a lookalike, so everything
  // the module's manager offers (getClient, createSubscriberClient, hooks) is there.
  it('returns a ConnectionManager', () => {
    const manager = createConnectionManager({ connection: { host: 'h' } })

    expect(manager).toBeInstanceOf(ConnectionManager)
  })

  // The same violations forRoot refuses must be refused here with the same code and details,
  // before any client exists. One case per distinct validation path.
  describe.each<[string, BymaxCacheModuleOptions, string]>([
    [
      'a sentinel mode without sentinels',
      { mode: 'sentinel' },
      CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED
    ],
    ['a cluster mode without nodes', { mode: 'cluster' }, CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED],
    [
      'a namespace holding a glob metacharacter',
      { connection: { host: 'h' }, namespace: 'a*' },
      CACHE_ERROR_CODES.INVALID_NAMESPACE
    ],
    [
      'a connectTimeout below the minimum',
      { connection: { connectTimeout: 1 } },
      CACHE_ERROR_CODES.CONNECTION_FAILED
    ],
    [
      'a shutdownTimeoutMs below the minimum',
      { connection: { host: 'h' }, shutdownTimeoutMs: 1 },
      CACHE_ERROR_CODES.CONNECTION_FAILED
    ],
    ['no connection in standalone mode', {}, CACHE_ERROR_CODES.CONNECTION_FAILED]
  ])('with %s', (_label, options, code) => {
    it('throws the error forRoot throws and creates no client', () => {
      const fromFactory = failureOf(() => createConnectionManager(options))
      const fromModule = failureOf(() => BymaxCacheModule.forRoot(options))

      expect(fromFactory).toEqual(fromModule)
      expect(fromFactory.code).toBe(code)
      expect(redisInstances).toHaveLength(0)
    })
  })

  it('throws INVALID_NAMESPACE for a namespace holding the separator', () => {
    const error = failureOf(() =>
      createConnectionManager({ connection: { host: 'h' }, namespace: 'a:b' })
    )

    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_NAMESPACE)
  })

  // The defaults the module applies reach the client: the offline queue is off (fail fast) and
  // a bounded retry strategy and the READONLY reconnect policy are installed.
  it('applies the module defaults to the client it builds', () => {
    const manager = createConnectionManager({ connection: { host: 'h' } })

    manager.getClient()

    const [client] = redisInstances
    expect(client?.options['enableOfflineQueue']).toBe(false)
    expect(typeof client?.options['retryStrategy']).toBe('function')
    expect(typeof client?.options['reconnectOnError']).toBe('function')
  })

  // The event callbacks the consumer supplies are carried over, so lifecycle events reach them.
  it('forwards the consumer events to the manager', () => {
    const onEvent = jest.fn()
    const manager = createConnectionManager({ connection: { host: 'h' }, events: { onEvent } })

    manager.getClient()
    redisInstances[0]?.emit('connect')

    expect(onEvent).toHaveBeenCalledWith('connect', { role: 'main' })
  })

  // Registered as a provider, the manager is connected on init and quit on shutdown by Nest
  // itself: the library owns both hooks, the consumer writes neither.
  it('is connected on init and quit on close when registered as a provider', async () => {
    const token = Symbol('AUTH_REDIS')
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: token,
          useFactory: () => createConnectionManager({ connection: { host: 'h' } })
        }
      ]
    }).compile()

    await moduleRef.init()
    expect(redisInstances).toHaveLength(1)

    await moduleRef.close()
    expect(redisInstances[0]?.quit).toHaveBeenCalledTimes(1)
  })
})
