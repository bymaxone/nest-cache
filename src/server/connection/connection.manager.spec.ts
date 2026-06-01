import { EventEmitter } from 'node:events'

import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import * as cacheExceptionModule from '../errors/cache.exception'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from './connection.manager'

import type { ResolvedOptions } from '../config/resolved-options'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/** Shape of a captured fake standalone client used by the assertions below. */
interface CapturedRedis extends EventEmitter {
  status: string
  options: Record<string, unknown>
  quit: jest.Mock
  disconnect: jest.Mock
}

/** Shape of a captured fake cluster client used by the assertions below. */
interface CapturedCluster extends EventEmitter {
  status: string
  nodes: unknown
  options: unknown
  quit: jest.Mock
  disconnect: jest.Mock
}

// Hoisted registries the mock factory fills with each constructed instance.
// `var` is required so these are initialized (to `undefined`) before the
// transpiler-hoisted ES `import` triggers the mock factory; `let`/`const` would
// sit in the temporal dead zone at that point. (`no-var` is not enforced on spec
// files — it is scoped to production sources in eslint.config.mjs.)
var redisInstances: CapturedRedis[]
var clusterInstances: CapturedCluster[]
// Initial `status` for the next constructed FakeRedis. Most tests want 'wait'
// (drives the readiness wait); the already-ready short-circuit test flips it.
var nextRedisStatus: string = 'wait'

jest.mock('ioredis', () => {
  // Defined inside the factory so the classes exist before any captured import
  // runs them — avoids the class-declaration temporal dead zone under hoisting.
  // They implement the Captured* shapes so `this` registers without a cast.
  class FakeRedis extends EventEmitter implements CapturedRedis {
    status = nextRedisStatus
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      redisInstances.push(this)
    }
  }
  class FakeCluster extends EventEmitter implements CapturedCluster {
    status = 'wait'
    nodes: unknown
    options: unknown
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor(nodes: unknown, options: unknown) {
      super()
      this.nodes = nodes
      this.options = options
      clusterInstances.push(this)
    }
  }
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeCluster, default: FakeRedis }
})

beforeEach(() => {
  redisInstances = []
  clusterInstances = []
  nextRedisStatus = 'wait'
})

/** Builds a manager from resolved defaults plus an optional events bag. */
const makeManager = (
  options: Partial<BymaxCacheModuleOptions>,
  events?: ICacheEvents
): ConnectionManager => {
  const resolved: ResolvedOptions = applyDefaults({ connection: { host: 'h' }, ...options })
  return new ConnectionManager(resolved, events)
}

/**
 * Installs a spy on the `CacheException` constructor (via the live module
 * namespace binding the source also imports) and returns the array it fills with
 * every instance the system under test constructs — including exceptions the
 * manager swallows internally (e.g. the shutdown-timeout exception caught by
 * `onModuleDestroy`). Lets a test assert the raw `details` of an otherwise
 * unobservable throw. Restore with `jest.restoreAllMocks()` in `afterEach`.
 */
const captureCacheExceptions = (): CacheException[] => {
  const captured: CacheException[] = []
  const original = cacheExceptionModule.CacheException
  jest
    .spyOn(cacheExceptionModule, 'CacheException')
    .mockImplementation((...args: ConstructorParameters<typeof CacheException>): CacheException => {
      const instance = new original(...args)
      captured.push(instance)
      return instance
    })
  return captured
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('ConnectionManager', () => {
  describe('onModuleInit', () => {
    // Standalone init creates the main client and resolves once the client emits
    // `ready` — the happy path that gates app bootstrap on a live connection. The
    // `ready` resolution must also detach BOTH one-shot listeners via cleanup()
    // (mutants L237 BlockStatement → {}, L238 'ready' → '', L239 'error' → '').
    it('creates the client and resolves on ready', async () => {
      const manager = makeManager({})

      const init = manager.onModuleInit()
      const client = redisInstances[0]
      expect(client).toBeDefined()
      const offSpy = jest.spyOn(client as EventEmitter, 'off')
      client?.emit('ready')

      await expect(init).resolves.toBeUndefined()
      // cleanup() must remove both the 'ready' and 'error' listeners on resolve.
      expect(offSpy).toHaveBeenCalledWith('ready', expect.any(Function))
      expect(offSpy).toHaveBeenCalledWith('error', expect.any(Function))
    })

    // With `lazyConnect`, init must NOT await readiness — it resolves even though
    // the client never emits `ready`, deferring connection to first command.
    it('does not await readiness when lazyConnect is set', async () => {
      const manager = makeManager({ connection: { host: 'h', lazyConnect: true } })

      await expect(manager.onModuleInit()).resolves.toBeUndefined()
    })

    // When the client reports `ready` before waitUntilReady runs, the wait must
    // short-circuit via its early-return branch (no emit needed to resolve).
    it('short-circuits when the client is already ready at wait time', async () => {
      nextRedisStatus = 'ready'
      const manager = makeManager({})

      // No `ready` emit is issued — resolution can only come from the
      // status==='ready' early return inside waitUntilReady.
      await expect(manager.onModuleInit()).resolves.toBeUndefined()
    })

    // A connection error during the readiness wait must reject onModuleInit with
    // a CONNECTION_FAILED CacheException — bootstrap fails loud, not silent. The
    // error path must also detach BOTH one-shot listeners via cleanup() (mutants
    // L237 BlockStatement → {}, L238 'ready' → '', L239 'error' → '') and pin the
    // CONNECTION_FAILED details payload (mutant L247 ObjectLiteral → {}).
    it('rejects with CONNECTION_FAILED when the client errors before ready', async () => {
      const manager = makeManager({})

      const init = manager.onModuleInit()
      const client = redisInstances[0]
      const offSpy = jest.spyOn(client as EventEmitter, 'off')
      client?.emit('error', new Error('boom'))

      await expect(init).rejects.toBeInstanceOf(CacheException)
      await init.catch((error: unknown) => {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
        // `ObjectLiteral → {}` would empty these details — fails this toEqual.
        expect((error as CacheException).details).toEqual({ error: 'boom' })
      })
      // cleanup() must remove both the 'ready' and 'error' listeners on reject.
      expect(offSpy).toHaveBeenCalledWith('ready', expect.any(Function))
      expect(offSpy).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('createClient — modes', () => {
    // A valid sentinel block (with sentinelPassword/password/role/natMap) yields a
    // FakeRedis seeded with the sentinel options — the true side of every spread.
    it('creates a sentinel client with all optional fields', () => {
      const natMap = { '10.0.0.2:6379': { host: '127.0.0.1', port: 6390 } }
      const manager = makeManager({
        mode: 'sentinel',
        sentinel: {
          name: 'mymaster',
          sentinels: [{ host: 's', port: 26379 }],
          sentinelPassword: 'sp',
          password: 'p',
          role: 'master',
          natMap
        }
      })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['name']).toBe('mymaster')
      expect(opts['sentinelPassword']).toBe('sp')
      expect(opts['password']).toBe('p')
      expect(opts['role']).toBe('master')
      expect(opts['natMap']).toBe(natMap)
    })

    // The modern 'replica' role must be normalised to 'slave' before reaching
    // ioredis 5 (which only accepts 'slave' at the wire level).
    it("normalises role: 'replica' to 'slave' for ioredis", () => {
      const manager = makeManager({
        mode: 'sentinel',
        sentinel: {
          name: 'mymaster',
          sentinels: [{ host: 's', port: 26379 }],
          role: 'replica'
        }
      })

      manager.getClient()
      expect(redisInstances[0]?.options['role']).toBe('slave')
    })

    // A sentinel block WITHOUT the optional secrets/role covers the false side of
    // the three conditional spreads — those keys must be absent.
    it('creates a sentinel client without optional fields', () => {
      const manager = makeManager({
        mode: 'sentinel',
        sentinel: { name: 'mymaster', sentinels: [{ host: 's', port: 26379 }] }
      })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['name']).toBe('mymaster')
      expect('sentinelPassword' in opts).toBe(false)
      // Pins the ConditionalExpression on the `password` spread (mutant L172):
      // `→ true` would always spread `{ password: undefined }`, adding the key.
      expect(opts).not.toHaveProperty('password')
      expect('role' in opts).toBe(false)
      // Same for the natMap spread — absent when not supplied.
      expect(opts).not.toHaveProperty('natMap')
    })

    // Sentinel mode with a missing sentinel block (forced past validation) must
    // throw SENTINEL_MISCONFIGURED from createClient's runtime guard.
    it('throws SENTINEL_MISCONFIGURED when the sentinel block is missing', () => {
      const resolved: ResolvedOptions = {
        ...applyDefaults({ connection: { host: 'h' } }),
        mode: 'sentinel',
        sentinel: undefined as never
      }
      const manager = new ConnectionManager(resolved)

      expect(() => manager.getClient()).toThrow(CacheException)
      try {
        manager.getClient()
      } catch (error) {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED)
        // Pins the details payload on the SENTINEL_MISCONFIGURED throw (mutant
        // L162): `ObjectLiteral → {}` would drop the key and `StringLiteral
        // 'sentinel' → ''` would blank the value — both fail this toEqual.
        expect((error as CacheException).details).toEqual({ mode: 'sentinel' })
      }
    })

    // A valid cluster block WITH options yields a FakeCluster carrying both the
    // seed nodes and the provided options.
    it('creates a cluster client with options', () => {
      const manager = makeManager({
        mode: 'cluster',
        cluster: { nodes: [{ host: 'c', port: 6379 }], options: { enableReadyCheck: true } }
      })

      manager.getClient()
      expect(clusterInstances).toHaveLength(1)
      expect(clusterInstances[0]?.options).toEqual({ enableReadyCheck: true })
      expect(clusterInstances[0]?.nodes).toEqual([{ host: 'c', port: 6379 }])
    })

    // A cluster block WITHOUT options covers the `?? {}` default — options must
    // resolve to an empty object.
    it('creates a cluster client without options', () => {
      const manager = makeManager({
        mode: 'cluster',
        cluster: { nodes: [{ host: 'c', port: 6379 }] }
      })

      manager.getClient()
      expect(clusterInstances[0]?.options).toEqual({})
    })

    // Cluster mode with a missing cluster block (forced past validation) must
    // throw CLUSTER_MISCONFIGURED from createClient's runtime guard.
    it('throws CLUSTER_MISCONFIGURED when the cluster block is missing', () => {
      const resolved: ResolvedOptions = {
        ...applyDefaults({ connection: { host: 'h' } }),
        mode: 'cluster',
        cluster: undefined as never
      }
      const manager = new ConnectionManager(resolved)

      expect(() => manager.getClient()).toThrow(CacheException)
      try {
        manager.getClient()
      } catch (error) {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED)
        // Pins the details payload on the CLUSTER_MISCONFIGURED throw (mutant
        // L179): `ObjectLiteral → {}` would drop the key and `StringLiteral
        // 'cluster' → ''` would blank the value — both fail this toEqual.
        expect((error as CacheException).details).toEqual({ mode: 'cluster' })
      }
    })
  })

  describe('getClient', () => {
    // getClient before init must lazily create a client; calling it twice must
    // return the very same singleton instance (no duplicate connections).
    it('lazily creates and memoizes the client', () => {
      const manager = makeManager({})

      const first = manager.getClient()
      const second = manager.getClient()

      expect(first).toBe(second)
      expect(redisInstances).toHaveLength(1)
    })
  })

  describe('createSubscriberClient', () => {
    // A subscriber client must be a NEW, distinct instance (a subscriber socket
    // cannot run normal commands) and its events carry role 'subscriber'. Unlike
    // the data-plane main client, its offline queue is enabled so a subscribe
    // issued before the socket is ready buffers instead of failing fast.
    it('creates a distinct client with subscriber-role events and an offline queue', () => {
      const onEvent = jest.fn()
      const manager = makeManager({}, { onEvent })

      const main = manager.getClient()
      const sub = manager.createSubscriberClient()

      expect(sub).not.toBe(main)
      expect(redisInstances).toHaveLength(2)
      expect(redisInstances[0]?.options['enableOfflineQueue']).toBe(false)
      expect(redisInstances[1]?.options['enableOfflineQueue']).toBe(true)
      redisInstances[1]?.emit('connect')
      expect(onEvent).toHaveBeenCalledWith('connect', { role: 'subscriber' })
    })
  })

  describe('event forwarding', () => {
    // Every lifecycle event must be forwarded to onEvent with role 'main' and
    // the event-specific payload (error → error message, reconnecting → delay).
    it('forwards all six lifecycle events with main-role payloads', () => {
      const onEvent = jest.fn()
      const manager = makeManager({}, { onEvent })
      manager.getClient()
      const client = redisInstances[0]

      client?.emit('connect')
      client?.emit('ready')
      client?.emit('error', new Error('x'))
      client?.emit('close')
      client?.emit('reconnecting', 42)
      client?.emit('end')

      expect(onEvent).toHaveBeenCalledWith('connect', { role: 'main' })
      expect(onEvent).toHaveBeenCalledWith('ready', { role: 'main' })
      expect(onEvent).toHaveBeenCalledWith('error', { role: 'main', error: 'x' })
      expect(onEvent).toHaveBeenCalledWith('close', { role: 'main' })
      expect(onEvent).toHaveBeenCalledWith('reconnecting', { role: 'main', delay: 42 })
      expect(onEvent).toHaveBeenCalledWith('end', { role: 'main' })
    })

    // With no events bag at all, emitting must not throw — covers the `events?.`
    // nullish short-circuit.
    it('does not throw when no events bag is supplied', () => {
      const manager = makeManager({})
      manager.getClient()
      const client = redisInstances[0]

      expect(() => client?.emit('connect')).not.toThrow()
    })

    // With an events bag whose onEvent is undefined, emitting must not throw —
    // covers the `onEvent?.` nullish short-circuit.
    it('does not throw when onEvent is undefined', () => {
      const manager = makeManager({}, {})
      manager.getClient()
      const client = redisInstances[0]

      expect(() => client?.emit('connect')).not.toThrow()
    })

    // A throwing onEvent must be swallowed — observability must never crash the
    // connection lifecycle (the try/catch in emit).
    it('swallows errors thrown by onEvent', () => {
      const onEvent = jest.fn(() => {
        throw new Error('observer blew up')
      })
      const manager = makeManager({}, { onEvent })
      manager.getClient()
      const client = redisInstances[0]

      expect(() => client?.emit('connect')).not.toThrow()
      expect(onEvent).toHaveBeenCalled()
    })
  })

  describe('onModuleDestroy', () => {
    // Destroying a manager that never created a client must resolve quietly and
    // never call quit — the early-return guard.
    it('resolves and skips quit when no client exists', async () => {
      const manager = makeManager({})

      await expect(manager.onModuleDestroy()).resolves.toBeUndefined()
      expect(redisInstances).toHaveLength(0)
    })

    // The happy path: destroy quits the client and nulls it, so a later
    // getClient() must create a brand-new instance.
    it('quits the client and clears the reference', async () => {
      const manager = makeManager({})
      manager.getClient()
      const client = redisInstances[0]

      await manager.onModuleDestroy()

      expect(client?.quit).toHaveBeenCalledTimes(1)
      const next = manager.getClient()
      expect(next).not.toBe(client)
      expect(redisInstances).toHaveLength(2)
    })

    // On a quit that exceeds the shutdown timeout, the manager must fall back to
    // a forced disconnect() AND signal the forced teardown to the events sink, so
    // a stuck shutdown is observable. Fake timers drive the race past the timeout.
    it('forces disconnect and signals forced_disconnect when quit exceeds the timeout', async () => {
      jest.useFakeTimers()
      try {
        // Capture the swallowed SHUTDOWN_TIMEOUT exception so its raw `details`
        // becomes observable — pins the ObjectLiteral on
        // `{ timeoutMs: this.options.shutdownTimeoutMs }` (mutant L123). The
        // `ObjectLiteral → {}` mutant would empty those details, failing the
        // toEqual below.
        const thrown = captureCacheExceptions()
        const onEvent = jest.fn()
        const manager = makeManager({ shutdownTimeoutMs: 100 }, { onEvent })
        manager.getClient()
        const client = redisInstances[0]
        client?.quit.mockReturnValue(new Promise<string>(() => {}))

        const destroy = manager.onModuleDestroy()
        await jest.advanceTimersByTimeAsync(100)
        await destroy

        expect(client?.disconnect).toHaveBeenCalledTimes(1)
        expect(onEvent).toHaveBeenCalledWith('error', {
          role: 'main',
          reason: 'forced_disconnect',
          shutdownTimeoutMs: 100
        })
        const timeoutException = thrown.find(
          (error) => error.code === CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT
        )
        expect(timeoutException).toBeDefined()
        expect(timeoutException?.details).toEqual({ timeoutMs: 100 })
      } finally {
        jest.useRealTimers()
      }
    })

    // The same forced-disconnect fallback must fire when quit() REJECTS (not only
    // when it times out) — both sub-paths funnel through the one catch, so a
    // rejected quit must equally force a disconnect and signal forced_disconnect.
    it('forces disconnect and signals forced_disconnect when quit rejects', async () => {
      const onEvent = jest.fn()
      const manager = makeManager({ shutdownTimeoutMs: 100 }, { onEvent })
      manager.getClient()
      const client = redisInstances[0]
      client?.quit.mockRejectedValue(new Error('quit failed'))

      await manager.onModuleDestroy()

      expect(client?.disconnect).toHaveBeenCalledTimes(1)
      expect(onEvent).toHaveBeenCalledWith('error', {
        role: 'main',
        reason: 'forced_disconnect',
        shutdownTimeoutMs: 100
      })
    })
  })

  describe('buildRedisOptions', () => {
    // A connection specifying every field must surface each value on the built
    // options — the left side of every `??` and each `!== undefined` true branch.
    it('passes through every specified connection field', () => {
      const retryStrategy = (): number => 1
      const reconnectOnError = (): boolean => true
      const manager = makeManager({
        connection: {
          host: 'h',
          port: 6380,
          password: 'pw',
          db: 2,
          username: 'u',
          tls: {},
          lazyConnect: true,
          connectTimeout: 1234,
          commandTimeout: 4321,
          maxRetriesPerRequest: 7,
          enableReadyCheck: false,
          enableOfflineQueue: true,
          retryStrategy,
          reconnectOnError,
          keepAlive: 99,
          noDelay: false,
          family: 6
        }
      })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['host']).toBe('h')
      expect(opts['port']).toBe(6380)
      expect(opts['password']).toBe('pw')
      expect(opts['db']).toBe(2)
      expect(opts['username']).toBe('u')
      expect(opts['tls']).toEqual({})
      expect(opts['lazyConnect']).toBe(true)
      expect(opts['connectTimeout']).toBe(1234)
      expect(opts['commandTimeout']).toBe(4321)
      expect(opts['maxRetriesPerRequest']).toBe(7)
      expect(opts['enableReadyCheck']).toBe(false)
      expect(opts['enableOfflineQueue']).toBe(true)
      expect(opts['retryStrategy']).toBe(retryStrategy)
      expect(opts['reconnectOnError']).toBe(reconnectOnError)
      expect(opts['keepAlive']).toBe(99)
      expect(opts['noDelay']).toBe(false)
      expect(opts['family']).toBe(6)
    })

    // A host-only connection must take every default — the right side of every
    // `??` and the false side of each conditional spread (optional keys absent).
    it('applies defaults for an unspecified connection', () => {
      const manager = makeManager({ connection: { host: 'h' } })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['lazyConnect']).toBe(false)
      expect(opts['connectTimeout']).toBe(10_000)
      expect(opts['commandTimeout']).toBe(5_000)
      expect(opts['maxRetriesPerRequest']).toBe(3)
      expect(opts['enableReadyCheck']).toBe(true)
      expect(opts['enableOfflineQueue']).toBe(false)
      expect(opts['keepAlive']).toBe(0)
      expect(opts['noDelay']).toBe(true)
      expect(opts['family']).toBe(4)
      expect('password' in opts).toBe(false)
      expect('db' in opts).toBe(false)
      expect('username' in opts).toBe(false)
      expect('tls' in opts).toBe(false)
    })

    // When a url and discrete fields conflict, the URL must win (spec §11.3) —
    // the parsed host overrides the discrete `host`.
    it('lets the URL override discrete fields', () => {
      const manager = makeManager({
        connection: { url: 'redis://u:p@urlhost:6380/2', host: 'discrete' }
      })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['host']).toBe('urlhost')
    })

    // Without a url, the `c.url ? parse : {}` ternary takes the empty-object
    // branch and discrete fields stand alone.
    it('uses discrete fields when no url is given', () => {
      const manager = makeManager({ connection: { host: 'discrete' } })

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['host']).toBe('discrete')
    })

    // With no `connection` block at all (sentinel mode supplies its own address
    // list), buildRedisOptions must fall back to `{}` — the right side of the
    // `opts.connection ?? {}` guard — so the defaults still apply and no discrete
    // host/port/etc. leak in.
    it('falls back to defaults when no connection block is present', () => {
      const resolved: ResolvedOptions = {
        ...applyDefaults({ connection: { host: 'h' } }),
        connection: undefined,
        mode: 'sentinel',
        sentinel: { name: 'mymaster', sentinels: [{ host: 's', port: 26379 }] }
      }
      const manager = new ConnectionManager(resolved)

      manager.getClient()
      const opts = redisInstances[0]?.options ?? {}
      expect(opts['lazyConnect']).toBe(false)
      expect(opts['connectTimeout']).toBe(10_000)
      expect('host' in opts).toBe(false)
    })

    // The default retryStrategy must grow 50ms per attempt and cap at 2000ms —
    // exercising both sides of the Math.min. Read off a manager built without a
    // custom strategy so the default body is what runs.
    it('uses the documented default retry backoff', () => {
      const manager = makeManager({ connection: { host: 'h' } })
      manager.getClient()
      const retryStrategy = redisInstances[0]?.options['retryStrategy']
      expect(typeof retryStrategy).toBe('function')
      if (typeof retryStrategy === 'function') {
        expect(retryStrategy(1)).toBe(50)
        expect(retryStrategy(100)).toBe(2000)
      }
    })

    // The default reconnectOnError must reconnect only on a READONLY failover
    // and ignore other errors — both branches of the predicate.
    it('uses the documented default reconnect predicate', () => {
      const manager = makeManager({ connection: { host: 'h' } })
      manager.getClient()
      const reconnectOnError = redisInstances[0]?.options['reconnectOnError']
      expect(typeof reconnectOnError).toBe('function')
      if (typeof reconnectOnError === 'function') {
        expect(reconnectOnError(new Error('READONLY You can not write'))).toBe(true)
        expect(reconnectOnError(new Error('boom'))).toBe(false)
      }
    })
  })
})
