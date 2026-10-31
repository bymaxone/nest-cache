/**
 * End-to-end tests for cluster mode against a REAL Redis Cluster of three masters
 * (Testcontainers).
 *
 * Proves the topology the library advertises actually works: `forRoot({ mode:
 * 'cluster' })` connects to a multi-node cluster, single-key reads/writes route
 * across slots, registered Lua scripts run, Pub/Sub delivers across nodes, and the
 * operations that cannot be honored on a cluster fail closed with
 * `UNSUPPORTED_IN_CLUSTER` (`scan`, `keys`, `flushNamespace`, `getClient` and every
 * administration call that reads keys). A rejected TTL writes nothing. Boots its own
 * cluster container and tears it down in `afterAll`.
 */
import {
  CacheService,
  CacheException,
  CACHE_ERROR_CODES,
  PubSubService
} from '@bymax-one/nest-cache'
import { CacheAdminService, CacheStatusService, type CacheScope } from '@bymax-one/nest-cache/admin'

import { bootAdminApp } from './fixtures/test-admin-app.module'
import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisCluster, type StartedRedisCluster } from './helpers/start-redis-cluster'

import type { TestingModule } from '@nestjs/testing'

/** Compare-and-set on a single key (cluster-safe: one key → one slot). */
const COMPARE_AND_SET_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  end
  return 0
`

const SCOPES: readonly CacheScope[] = [
  {
    id: 'cache',
    label: 'Application cache',
    pattern: 'e2e-cluster:*',
    isReadable: true,
    origin: 'the application namespace, written through the typed API'
  }
]

/** Resolves with what `run` rejects with, failing when it does not reject. */
const rejection = async (run: () => unknown): Promise<CacheException> => {
  const caught = await Promise.resolve()
    .then(run)
    .then(
      () => undefined,
      (error: unknown) => error
    )
  if (!(caught instanceof CacheException)) {
    throw new Error(`expected a CacheException, got ${String(caught)}`)
  }
  return caught
}

/** Polls until `check` holds, so a test waits for delivery instead of sleeping a fixed time. */
const waitFor = async (check: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('Redis Cluster topology E2E (real cluster)', () => {
  let cluster: StartedRedisCluster
  let app: TestingModule
  let adminApp: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    cluster = await startRedisCluster()
    const cacheOptions = {
      mode: 'cluster' as const,
      cluster: { nodes: cluster.nodes, options: { redisOptions: { maxRetriesPerRequest: 5 } } },
      namespace: 'e2e-cluster',
      scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
    }
    app = await bootCacheApp(cacheOptions)
    cache = app.get(CacheService)
    adminApp = await bootAdminApp(cacheOptions, { scopes: SCOPES })
  }, 120_000)

  afterAll(async () => {
    await adminApp?.close()
    await app?.close()
    await cluster?.container.stop()
  })

  // Single-key reads/writes must route to the owning slot's node and round-trip —
  // proving the cluster client + MOVED handling are wired through the facade.
  it('routes single-key reads and writes across slots', async () => {
    await cache.set('node', 'alpha', { v: 1 })
    await cache.set('node', 'beta', { v: 2 })
    await cache.set('node', 'gamma', { v: 3 })

    expect(await cache.get('node', 'alpha')).toEqual({ v: 1 })
    expect(await cache.get('node', 'beta')).toEqual({ v: 2 })
    expect(await cache.get('node', 'gamma')).toEqual({ v: 3 })
  })

  // A registered Lua script must run on the slot owning its key. In cluster mode
  // the lib uses EVAL (full body, routed by key) instead of EVALSHA — proving the
  // cluster-safe script path against a real cluster (single key → one slot).
  it('runs a registered Lua script via EVAL on the owning node', async () => {
    await cache.setRaw('counter', 'k', '1')

    const result = await cache.eval('cas', ['counter:k'], ['1', '2'])

    expect(result).toBe(1)
    expect(await cache.getRaw('counter', 'k')).toBe('2')
  })

  // scan must fail closed in cluster mode — the Cluster client has no top-level
  // `scanStream`, so a cluster-wide cursor is not offered (use per-node scans).
  it('rejects scan with UNSUPPORTED_IN_CLUSTER', async () => {
    const drain = async (): Promise<void> => {
      for await (const _key of cache.scan('node', '*')) {
        // exhaust — the guard throws on the first pull
      }
    }

    const error = await drain().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CacheException)
    if (!(error instanceof CacheException))
      throw new Error(`expected CacheException, got ${String(error)}`)
    expect(error.code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect(error.details).toEqual({ operation: 'scan' })
  })

  // flushNamespace must fail closed in cluster mode for the same reason — it
  // relies on SCAN + UNLINK over a cluster-wide cursor that is not available.
  it('rejects flushNamespace with UNSUPPORTED_IN_CLUSTER', async () => {
    const error = await cache.flushNamespace().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CacheException)
    if (!(error instanceof CacheException))
      throw new Error(`expected CacheException, got ${String(error)}`)
    expect(error.code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect(error.details).toEqual({ operation: 'flushNamespace' })
  })

  // The connection must report healthy against the cluster (PING on a node).
  it('reports a healthy cluster connection', async () => {
    expect(await cache.isHealthy()).toBe(true)
  })

  // KEYS carries no key, so the cluster client sends it to one node and the reply would
  // cover a third of the keyspace. Seed keys across slots first: the guard must hold even
  // when a partial list would look plausible.
  it('rejects keys with UNSUPPORTED_IN_CLUSTER rather than listing one node', async () => {
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(async (id) => cache.set('spread', id, id)))

    const error = await rejection(async () => cache.keys('spread', '*'))

    expect(error.code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect(error.details).toEqual({ operation: 'keys' })
  })

  // The raw client of a Cluster is not the Redis API the facade promises.
  it('rejects getClient with UNSUPPORTED_IN_CLUSTER', async () => {
    const error = await rejection(() => cache.getClient())

    expect(error.code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect(error.details).toEqual({ operation: 'getClient' })
  })

  // A TTL the library refuses must not reach a node: no key appears, on whichever slot
  // owns it, and a refused expire leaves an existing key untouched.
  describe('a rejected ttlSeconds', () => {
    it.each([0, -1, 1.5])('set with %s throws INVALID_TTL and writes nothing', async (ttl) => {
      const error = await rejection(async () => cache.set('ttl', `set-${String(ttl)}`, 'v', ttl))

      expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
      expect(await cache.exists('ttl', `set-${String(ttl)}`)).toBe(false)
    })

    it('setNx with 0 throws INVALID_TTL and writes nothing', async () => {
      const error = await rejection(async () => cache.setNx('ttl', 'nx', 'v', 0))

      expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
      expect(await cache.exists('ttl', 'nx')).toBe(false)
    })

    it('expire with a fraction throws INVALID_TTL and leaves the key persistent', async () => {
      await cache.set('ttl', 'keep', 'v')

      const error = await rejection(async () => cache.expire('ttl', 'keep', 1.5))

      expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
      expect(await cache.ttl('ttl', 'keep')).toBe(-1)
    })

    it('still accepts a valid ttl on the cluster', async () => {
      await cache.set('ttl', 'valid', 'v', 60)

      expect(await cache.ttl('ttl', 'valid')).toBeGreaterThan(0)
    })
  })

  // PUBLISH reaches every node of a cluster, so a subscriber attached to any node sees it.
  // The library calls this path an experimental passthrough: this measures what it does.
  describe('Pub/Sub on the cluster', () => {
    it('delivers a published message to a channel subscriber', async () => {
      const pubsub = app.get(PubSubService)
      const received: unknown[] = []
      const unsubscribe = await pubsub.subscribe<{ n: number }>('cluster-events', (message) => {
        received.push(message)
      })

      await pubsub.publish('cluster-events', { n: 1 })
      await waitFor(() => received.length > 0)
      await unsubscribe()

      expect(received).toEqual([{ n: 1 }])
    })

    it('delivers to a pattern subscriber with the namespaced channel', async () => {
      const pubsub = app.get(PubSubService)
      const received: Array<{ message: unknown; channel: string }> = []
      const unsubscribe = await pubsub.psubscribe<string>('cluster-*', (message, channel) => {
        received.push({ message, channel })
      })

      await pubsub.publish('cluster-pattern', 'hello')
      await waitFor(() => received.length > 0)
      await unsubscribe()

      expect(received).toEqual([{ message: 'hello', channel: 'e2e-cluster:cluster-pattern' }])
    })
  })

  // Every administration call that reads keys goes through getClient, so on a cluster it
  // fails closed with the same code; the calls that need no key scan still work.
  describe('the administration surface', () => {
    it.each([
      ['listKeys', (admin: CacheAdminService) => admin.listKeys('cache')],
      ['describeKey', (admin: CacheAdminService) => admin.describeKey('cache', 'e2e-cluster:x')],
      ['revealValue', (admin: CacheAdminService) => admin.revealValue('cache', 'e2e-cluster:x')]
    ])('%s throws UNSUPPORTED_IN_CLUSTER', async (_name, call) => {
      const error = await rejection(async () => call(adminApp.get(CacheAdminService)))

      expect(error.code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
      expect(error.details).toEqual({ operation: 'getClient' })
    })

    it('lists scopes without touching the connection', () => {
      expect(adminApp.get(CacheAdminService).listScopes()).toEqual(SCOPES)
    })

    it('reports health as up, in cluster mode, with scanning unsupported', async () => {
      const health = await adminApp.get(CacheStatusService).health()

      expect(health).toMatchObject({ status: 'up', mode: 'cluster', isScanSupported: false })
    })

    it('reads server statistics from a node of the cluster', async () => {
      const stats = await adminApp.get(CacheStatusService).stats()

      expect(stats.server.mode).toBe('cluster')
    })
  })
})
