/**
 * Boot-wait tests for {@link ConnectionManager}: the readiness deadline, the `end` event, release of
 * a failed boot's client, cluster timers and lazy clusters.
 *
 * Layer: server. The ioredis clients are fakes that emit the events a test drives.
 */
import { EventEmitter } from 'node:events'

import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from './connection.manager'

import type { ResolvedOptions } from '../config/resolved-options'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/** Shape of a captured fake client used by the assertions below. */
interface Captured extends EventEmitter {
  status: string
  quit: jest.Mock
  disconnect: jest.Mock
}

// Hoisted registries the mock factory fills with each constructed instance (`var`: see
// connection.manager.spec.ts for why `let`/`const` would sit in the temporal dead zone).
var redisInstances: Captured[]
var clusterInstances: Captured[]

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter implements Captured {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor() {
      super()
      redisInstances.push(this)
    }
  }
  class FakeCluster extends EventEmitter implements Captured {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor() {
      super()
      clusterInstances.push(this)
    }
  }
  return {
    __esModule: true,
    AbstractConnector: jest.requireActual<typeof import('ioredis')>('ioredis').AbstractConnector,
    Redis: FakeRedis,
    Cluster: FakeCluster,
    default: FakeRedis
  }
})

beforeEach(() => {
  redisInstances = []
  clusterInstances = []
})

/** Builds a manager from resolved defaults plus an optional events bag. */
const makeManager = (
  options: Partial<BymaxCacheModuleOptions>,
  events?: ICacheEvents
): ConnectionManager => {
  const resolved: ResolvedOptions = applyDefaults({ connection: { host: 'h' }, ...options })
  return new ConnectionManager(resolved, events)
}

describe('ConnectionManager boot wait', () => {
  // Scenario: the host's connectTimeout sits behind a getter that counts its reads.
  // Rule: the option is read once, when the manager is built, and the boot wait uses that value.
  it('reads connectTimeout once for the client options and the boot deadline', async () => {
    let reads = 0
    const connection = Object.defineProperty({ host: 'h' }, 'connectTimeout', {
      get: (): number => {
        reads += 1
        return 5_000
      },
      enumerable: true
    })
    const manager = makeManager({ connection })
    const init = manager.onModuleInit()
    redisInstances[0]?.emit('ready')
    await init

    expect(reads).toBe(1)
  })

  // A failed boot must not leave a client that keeps reconnecting: the readiness wait gives up
  // and disconnects it, whichever way the wait fails.
  it('disconnects the client when it errors before ready', async () => {
    const manager = makeManager({})

    const init = manager.onModuleInit()
    const client = redisInstances[0]
    client?.emit('error', new Error('boom'))

    await expect(init).rejects.toBeInstanceOf(CacheException)
    expect(client?.disconnect).toHaveBeenCalledTimes(1)
  })

  // A client that never became ready is a backing service that is unavailable, so every way the
  // wait fails answers 503; the boot-time configuration errors keep 500.
  it.each([
    ['an error', (client: Captured): boolean => client.emit('error', new Error('boom'))],
    ['the end of the connection', (client: Captured): boolean => client.emit('end')]
  ])('answers 503 when the wait fails by %s', async (_label, fail) => {
    const manager = makeManager({})

    const init = manager.onModuleInit()
    fail(redisInstances[0] as Captured)

    await expect(init).rejects.toMatchObject({ status: 503 })
  })

  // `end` means ioredis stopped reconnecting (a retryStrategy returned null) without an error, so
  // neither `ready` nor `error` would ever fire.
  it('rejects and disconnects when the client ends before ready', async () => {
    const manager = makeManager({})

    const init = manager.onModuleInit()
    const client = redisInstances[0]
    client?.emit('end')

    await expect(init).rejects.toMatchObject({
      code: CACHE_ERROR_CODES.CONNECTION_FAILED,
      details: { error: 'connection ended before ready' }
    })
    expect(client?.disconnect).toHaveBeenCalledTimes(1)
  })

  // The wait is bounded by `connectTimeout`: a server that accepts the socket and never answers
  // would otherwise hold the boot forever.
  it('rejects and disconnects when the client is not ready by connectTimeout', async () => {
    jest.useFakeTimers()
    try {
      const manager = makeManager({ connection: { host: 'h', connectTimeout: 2_000 } })

      const init = manager.onModuleInit()
      const settled = init.then(
        () => 'resolved',
        (error: unknown) => error
      )
      await jest.advanceTimersByTimeAsync(1_999)
      expect(redisInstances[0]?.disconnect).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(1)

      await expect(settled).resolves.toMatchObject({
        code: CACHE_ERROR_CODES.CONNECTION_FAILED,
        details: { error: 'not ready within connectTimeout' }
      })
      expect(redisInstances[0]?.disconnect).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  // A cluster takes its timers from cluster.options.redisOptions, so the boot deadline is that
  // connectTimeout and not the default (10 s) nor a `connection` value a cluster ignores.
  it('uses the cluster redisOptions.connectTimeout as the boot deadline', async () => {
    jest.useFakeTimers()
    try {
      const manager = makeManager({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: 'c', port: 6379 }],
          options: { redisOptions: { connectTimeout: 60_000 } }
        }
      })

      const init = manager.onModuleInit()
      const settled = init.then(
        () => 'resolved',
        (error: unknown) => error
      )
      await jest.advanceTimersByTimeAsync(59_999)
      expect(clusterInstances[0]?.disconnect).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(1)

      await expect(settled).resolves.toMatchObject({
        code: CACHE_ERROR_CODES.CONNECTION_FAILED,
        details: { error: 'not ready within connectTimeout' }
      })
      expect(clusterInstances[0]?.disconnect).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  // A boot that failed released its client, so the shutdown Nest runs afterwards finds nothing to
  // quit and reports no forced disconnect for a connection that was already closed.
  it('leaves nothing to quit or report at shutdown after a failed boot', async () => {
    const events: [string, Record<string, unknown>][] = []
    const manager = makeManager({}, { onEvent: (name, data) => void events.push([name, data]) })

    const init = manager.onModuleInit()
    const client = redisInstances[0]
    client?.emit('error', new Error('boom'))
    await init.catch(() => undefined)
    await manager.onApplicationShutdown()

    expect(client?.quit).not.toHaveBeenCalled()
    expect(events.filter(([, data]) => data['reason'] === 'forced_disconnect')).toEqual([])
  })

  // A failed boot closed its client on purpose, so a later `getClient()` or subscriber must not
  // quietly open another one and undo that: nothing would have waited for it to become ready.
  it.each([
    ['getClient', (manager: ConnectionManager): unknown => manager.getClient()],
    [
      'createSubscriberClient',
      (manager: ConnectionManager): unknown => manager.createSubscriberClient()
    ]
  ])('refuses %s after a failed boot instead of opening a client', async (_name, reach) => {
    const manager = makeManager({})
    const init = manager.onModuleInit()
    redisInstances[0]?.emit('error', new Error('boom'))
    await init.catch(() => undefined)
    const opened = redisInstances.length

    let thrown: unknown
    try {
      reach(manager)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheException)
    expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
    expect((thrown as CacheException).getStatus()).toBe(503)
    expect((thrown as CacheException).details).toEqual({ reason: 'boot_failed' })
    expect(JSON.stringify((thrown as CacheException).getResponse())).not.toContain('boom')
    expect(((thrown as CacheException).cause as CacheException).details).toEqual({
      error: 'connection error before ready'
    })
    expect((((thrown as CacheException).cause as CacheException).cause as Error).message).toBe(
      'boom'
    )
    expect(redisInstances).toHaveLength(opened)
  })

  // The control: before any boot failure the same calls open a client, so the refusal above is the
  // failed boot's doing and not a manager that refuses everything.
  it('still opens a client for getClient and a subscriber when no boot failed', () => {
    const manager = makeManager({ connection: { host: 'h', lazyConnect: true } })

    manager.getClient()
    manager.createSubscriberClient()

    expect(redisInstances).toHaveLength(2)
  })

  // A client that becomes ready leaves no timer behind and is not disconnected.
  it('clears the deadline and keeps the client when it becomes ready', async () => {
    jest.useFakeTimers()
    try {
      const manager = makeManager({})

      const init = manager.onModuleInit()
      redisInstances[0]?.emit('ready')
      await init

      expect(jest.getTimerCount()).toBe(0)
      expect(redisInstances[0]?.disconnect).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  // A cluster created with `cluster.options.lazyConnect` connects on first command, like a lazy
  // standalone client: init must not wait for a `ready` that has not been asked for.
  it('does not await readiness when the cluster is lazy', async () => {
    const manager = makeManager({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'c', port: 6379 }], options: { lazyConnect: true } }
    })

    await expect(manager.onModuleInit()).resolves.toBeUndefined()
  })
})
