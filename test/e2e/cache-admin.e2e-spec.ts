/**
 * End-to-end tests for the `./admin` subpath against a REAL Redis
 * (Testcontainers).
 *
 * These exist because the unit suite structurally cannot verify them:
 *
 * - **`ioredis-mock` has no `MEMORY USAGE`**, no `memory` on its pipeline, and a
 *   broken `zrange WITHSCORES` (all three measured). Sizing and sorted-set
 *   reveal are therefore verified only here.
 * - **The `INFO` field names are an assumption about a server, and a double
 *   returns whatever its fixture decided.** Every name the parser reads is
 *   asserted present against a real server, so a rename in a future Redis fails
 *   CI rather than silently reporting `null` for a field that exists.
 * - **Scope membership is a security rule.** It is checked differentially here:
 *   the library's `isKeyInScope` must select exactly the keys the server's own
 *   `KEYS <pattern>` selects. A matcher more permissive than the server's is a
 *   cross-scope leak that no happy-path test would show.
 */
import { CacheService } from '@bymax-one/nest-cache'
import {
  CacheAdminService,
  CacheStatusService,
  isKeyInScope,
  parseInfoFields,
  type CacheScope
} from '@bymax-one/nest-cache/admin'

import { bootAdminApp } from './fixtures/test-admin-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** Every `INFO` field the parser reads. Asserted present on a real server. */
const REQUIRED_INFO_FIELDS = [
  'keyspace_hits',
  'keyspace_misses',
  'expired_keys',
  'evicted_keys',
  'instantaneous_ops_per_sec',
  'total_commands_processed',
  'total_connections_received',
  'rejected_connections',
  'used_memory',
  'used_memory_peak',
  'maxmemory',
  'maxmemory_policy',
  'mem_fragmentation_ratio',
  'rdb_last_save_time',
  'rdb_changes_since_last_save',
  'rdb_last_bgsave_status',
  'aof_enabled',
  'role',
  'connected_slaves',
  'redis_version',
  'redis_mode',
  'uptime_in_seconds',
  'connected_clients',
  'blocked_clients'
] as const

const NAMESPACE = 'e2e-admin'

const SCOPES: readonly CacheScope[] = [
  {
    id: 'cache',
    label: 'Application cache',
    pattern: `${NAMESPACE}:*`,
    isReadable: true,
    origin: 'the application namespace, written through the typed API'
  },
  {
    id: 'auth',
    label: 'Authentication',
    pattern: 'e2e-auth:*',
    isReadable: false,
    origin: 'written at Redis root outside the namespace; holds session records'
  }
]

describe('cache admin subpath E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let admin: CacheAdminService
  let status: CacheStatusService
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootAdminApp(
      { connection: { url: redis.url }, namespace: NAMESPACE },
      { scopes: SCOPES }
    )
    admin = app.get(CacheAdminService)
    status = app.get(CacheStatusService)
    cache = app.get(CacheService)

    // Seed both keyspaces, including the root-level one the namespace cannot reach.
    const client = cache.getClient()
    await client.set(`${NAMESPACE}:str:1`, 'hello')
    await client.hset(`${NAMESPACE}:hash:1`, 'field', 'value')
    await client.sadd(`${NAMESPACE}:set:1`, 'm1', 'm2')
    await client.rpush(`${NAMESPACE}:list:1`, 'i1', 'i2')
    await client.zadd(`${NAMESPACE}:zset:1`, 1, 'z1', 2, 'z2')
    await client.set(`${NAMESPACE}:ttl:1`, 'x', 'EX', 600)
    await client.set('e2e-auth:sess:1', 'secret-session-token')
    await client.set('e2e-other:untouched:1', 'not in any scope')
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // The field names are the assumption a double cannot falsify. If a future
  // Redis renames one, this fails rather than the parser quietly reporting null.
  it('publishes every INFO field the parser reads', async () => {
    const fields = parseInfoFields(await cache.info())
    const missing = REQUIRED_INFO_FIELDS.filter((name) => !fields.has(name))
    expect(missing).toEqual([])
  })

  // A container started without `--maxmemory` reports `maxmemory:0`, which means
  // UNBOUNDED. Read as a literal ceiling it draws a full saturation bar on the
  // least constrained server there is.
  it('reads the default maxmemory as unbounded rather than a zero ceiling', async () => {
    expect((await status.stats()).memory.max).toEqual({ kind: 'unbounded' })
  })

  // The parser's readings must be plausible against a live server, not merely
  // well-typed — a field parsed into the wrong slot still typechecks.
  it('reads real server statistics', async () => {
    const stats = await status.stats()
    expect(stats.server.redisVersion).toMatch(/^\d+\.\d+/)
    expect(stats.memory.usedBytes).toBeGreaterThan(0)
    expect(stats.replication.role).toBe('master')
    // Present on a real server, so it must not be the absent reading.
    expect(stats.persistence.aofEnabled).not.toBeNull()
  })

  // A reachable server reports up WITH a latency, which is the union's happy path
  // and the only branch that carries a measurement.
  it('reports the cache up with a measured latency', async () => {
    const health = await status.health()
    expect(health.status).toBe('up')
    expect(health).toHaveProperty('latencyMs')
    expect(health.isScanSupported).toBe(true)
  })

  // The config payload leaves the process; the credential must not be in it.
  it('never serializes the connection URL', async () => {
    const payload = JSON.stringify(status.config())
    expect(payload).not.toContain(redis.url)
    expect(status.config().connection.host).toBe(new URL(redis.url).hostname)
  })

  // THE security rule, checked against the server's own matcher rather than
  // against my reading of it.
  it.each(SCOPES.map((scope) => [scope.id, scope.pattern] as const))(
    'agrees with the server about which keys belong to scope %s',
    async (_id, pattern) => {
      const client = cache.getClient()
      const fromServer = (await client.keys(pattern)).sort()
      const allKeys = (await client.keys('*')).sort()
      const fromLibrary = allKeys.filter((key) => isKeyInScope(pattern, key))
      expect(fromLibrary).toEqual(fromServer)
      expect(fromServer.length).toBeGreaterThan(0)
    }
  )

  // A key outside every scope must be selected by none of them.
  it('places an out-of-scope key in no scope', () => {
    const orphan = 'e2e-other:untouched:1'
    expect(SCOPES.filter((scope) => isKeyInScope(scope.pattern, orphan))).toEqual([])
  })

  // Every Redis type this surface names must be recognised against a real server;
  // a double would report whatever its fixture decided.
  it('lists the application scope with real types and ttls', async () => {
    const page = await admin.listKeys('cache')
    const byKey = new Map(page.entries.map((entry) => [entry.key, entry]))
    expect(byKey.get(`${NAMESPACE}:str:1`)?.type).toBe('string')
    expect(byKey.get(`${NAMESPACE}:hash:1`)?.type).toBe('hash')
    expect(byKey.get(`${NAMESPACE}:set:1`)?.type).toBe('set')
    expect(byKey.get(`${NAMESPACE}:list:1`)?.type).toBe('list')
    expect(byKey.get(`${NAMESPACE}:zset:1`)?.type).toBe('zset')
    expect(page.isComplete).toBe(true)
  })

  // Real TTL semantics: a key with an expiry, and one without, must not collapse
  // into the same reading.
  it('distinguishes an expiring key from a persistent one', async () => {
    const page = await admin.listKeys('cache')
    const byKey = new Map(page.entries.map((entry) => [entry.key, entry]))
    expect(byKey.get(`${NAMESPACE}:ttl:1`)?.ttl).toMatchObject({ kind: 'expiring' })
    expect(byKey.get(`${NAMESPACE}:str:1`)?.ttl).toEqual({ kind: 'persistent' })
  })

  // `TTL` on a key that does not exist answers -2, which must read as missing
  // rather than persistent — the case a mock cannot be trusted to reproduce.
  it('reads a vanished key as missing rather than persistent', async () => {
    const detail = await admin.describeKey('cache', `${NAMESPACE}:never-existed`)
    expect(detail.ttl).toEqual({ kind: 'missing' })
  })

  // `MEMORY USAGE` is unsupported by `ioredis-mock`, so this is the ONLY place
  // sizing is verified against a server that actually implements it.
  it('measures real key sizes and sums only what it measured', async () => {
    const page = await admin.listKeys('cache', { includeSize: true })
    const sizes = page.entries.map((entry) => entry.sizeBytes)
    expect(sizes.every((size) => typeof size === 'number' && size > 0)).toBe(true)
    const expected = sizes.reduce<number>((total, size) => total + (size ?? 0), 0)
    expect(page.sampledBytes).toBe(expected)
  })

  // Each value shape is revealed correctly against real replies, which is where a
  // wire-format assumption fails if it is going to.
  it('reveals each real value type', async () => {
    await expect(admin.revealValue('cache', `${NAMESPACE}:str:1`)).resolves.toMatchObject({
      status: 'revealed',
      value: { kind: 'string', value: 'hello' }
    })
    await expect(admin.revealValue('cache', `${NAMESPACE}:hash:1`)).resolves.toMatchObject({
      value: { kind: 'hash', fields: [{ name: 'field', value: 'value' }] }
    })
    await expect(admin.revealValue('cache', `${NAMESPACE}:list:1`)).resolves.toMatchObject({
      value: { kind: 'members', members: ['i1', 'i2'] }
    })
  })

  // Sorted sets go through the `call` escape hatch because ioredis's `zrange`
  // overloads cannot be narrowed — and `ioredis-mock` cannot run it at all.
  it('reveals a sorted set with its scores', async () => {
    await expect(admin.revealValue('cache', `${NAMESPACE}:zset:1`)).resolves.toMatchObject({
      value: {
        kind: 'scored',
        members: [
          { member: 'z1', score: '1' },
          { member: 'z2', score: '2' }
        ]
      }
    })
  })

  // The load-bearing split, end to end: the unreadable scope LISTS in full and
  // refuses only the value. A surface rendering it as empty would tell an
  // operator the region holds nothing while it holds every session record.
  it('lists the unreadable scope in full but withholds the value', async () => {
    const page = await admin.listKeys('auth', { includeSize: true })
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]).toMatchObject({
      key: 'e2e-auth:sess:1',
      type: 'string',
      ttl: { kind: 'persistent' }
    })
    expect(page.entries[0]?.sizeBytes).toBeGreaterThan(0)

    const revealed = await admin.revealValue('auth', 'e2e-auth:sess:1')
    expect(revealed.status).toBe('withheld')
    expect(JSON.stringify(revealed)).not.toContain('secret-session-token')
  })

  // Naming the readable scope must not reach the credential-bearing keyspace.
  it('refuses a key from another keyspace under the readable scope', async () => {
    await expect(admin.revealValue('cache', 'e2e-auth:sess:1')).rejects.toMatchObject({
      code: 'cache.key_not_in_scope'
    })
  })

  // The scope list is what a surface reads to know what it may offer, so it must
  // answer without consulting the server.
  it('lists scopes without touching the connection', () => {
    expect(admin.listScopes().map((scope) => scope.id)).toEqual(['cache', 'auth'])
  })
})
