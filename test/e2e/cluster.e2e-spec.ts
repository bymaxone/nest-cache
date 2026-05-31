/**
 * End-to-end tests for cluster mode against a REAL Redis Cluster (Testcontainers).
 *
 * Proves the topology the library advertises actually works: `forRoot({ mode:
 * 'cluster' })` connects to a multi-node cluster, single-key reads/writes route
 * across slots, registered Lua scripts run, and the cluster-incompatible
 * operations fail closed with `UNSUPPORTED_IN_CLUSTER` (`scan` / `flushNamespace`,
 * which need a top-level `scanStream` the Cluster client does not expose). Boots
 * its own cluster container and tears it down in `afterAll`.
 */
import { CacheService, CacheException, CACHE_ERROR_CODES } from '@bymax-one/nest-cache'

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

describe('Redis Cluster topology E2E (real cluster)', () => {
  let cluster: StartedRedisCluster | undefined
  let app: TestingModule | undefined
  let cache: CacheService

  beforeAll(async () => {
    cluster = await startRedisCluster()
    app = await bootCacheApp({
      mode: 'cluster',
      cluster: {
        nodes: cluster.nodes,
        options: { natMap: cluster.natMap, redisOptions: { maxRetriesPerRequest: 5 } }
      },
      namespace: 'e2e-cluster',
      scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
    })
    cache = app.get(CacheService)
  }, 120_000)

  afterAll(async () => {
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
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect((error as CacheException).details).toEqual({ operation: 'scan' })
  })

  // flushNamespace must fail closed in cluster mode for the same reason — it
  // relies on SCAN + UNLINK over a cluster-wide cursor that is not available.
  it('rejects flushNamespace with UNSUPPORTED_IN_CLUSTER', async () => {
    const error = await cache.flushNamespace().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
    expect((error as CacheException).details).toEqual({ operation: 'flushNamespace' })
  })

  // The connection must report healthy against the cluster (PING on a node).
  it('reports a healthy cluster connection', async () => {
    expect(await cache.isHealthy()).toBe(true)
  })
})
