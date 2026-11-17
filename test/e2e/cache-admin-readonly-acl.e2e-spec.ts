/**
 * End-to-end proof that the `./admin` subpath only reads, against a REAL Redis (Testcontainers).
 *
 * The build gates read source and types; this runs the whole administration API as a Redis user
 * that is not allowed to write, so a write the gates missed fails here with `NOPERM` and shows up
 * in the server's own ACL log. A second check watches the commands the server received and holds
 * them to the read allowlist.
 */
import { CacheService } from '@bymax-one/nest-cache'
import { CacheAdminService, CacheStatusService, type CacheScope } from '@bymax-one/nest-cache/admin'
import { Redis } from 'ioredis'

import { bootAdminApp } from './fixtures/test-admin-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

const NAMESPACE = 'e2e-acl'
const USER = 'admin-reader'
const PASSWORD = 'reader-secret'
const SCOPES: readonly CacheScope[] = [
  {
    id: 'cache',
    label: 'Application cache',
    pattern: `${NAMESPACE}:*`,
    isReadable: true,
    origin: 'the application namespace'
  }
]

/**
 * What the reader user may do: every read, the connection commands a client sends on connect, and
 * `INFO`, which the status service needs and Redis files under `@dangerous`.
 */
const ACL_RULES = [
  'reset',
  'on',
  `>${PASSWORD}`,
  '~*',
  '-@all',
  '+@read',
  '+@connection',
  '-@write',
  '-@dangerous',
  '+info'
]

/** The commands the reader connection may be seen sending; anything else is a finding. */
const ALLOWED_COMMANDS = new Set([
  'auth',
  'client',
  'hello',
  'info',
  'ping',
  'get',
  'getrange',
  'hscan',
  'lrange',
  'memory',
  'scan',
  'sscan',
  'ttl',
  'type',
  'zrange',
  'exec',
  'multi',
  'select'
])

describe('cache admin issues no write (real Redis, a user that cannot write)', () => {
  let redis: StartedRedis
  let owner: Redis
  let monitor: Redis
  let app: TestingModule
  let admin: CacheAdminService
  let status: CacheStatusService
  /** Every command MONITOR showed, with the address of the connection that sent it. */
  const seen: { source: string; name: string }[] = []

  beforeAll(async () => {
    redis = await startRedisContainer()
    owner = new Redis(redis.url)
    await owner.set(`${NAMESPACE}:string`, 'text')
    await owner.hset(`${NAMESPACE}:hash`, { a: '1', b: '2' })
    await owner.sadd(`${NAMESPACE}:set`, 'x', 'y')
    await owner.rpush(`${NAMESPACE}:list`, 'one', 'two')
    await owner.zadd(`${NAMESPACE}:zset`, 1, 'low', 2, 'high')
    await owner.set(`${NAMESPACE}:expiring`, 'soon', 'EX', 600)
    await owner.call('ACL', 'SETUSER', USER, ...ACL_RULES)
    await owner.call('ACL', 'LOG', 'RESET')

    monitor = new Redis(redis.url)
    const feed = await monitor.monitor()
    feed.on('monitor', (_time: string, args: string[], source: string) => {
      seen.push({ source, name: (args[0] ?? '').toLowerCase() })
    })

    const url = redis.url.replace('redis://', `redis://${USER}:${PASSWORD}@`)
    app = await bootAdminApp({ connection: { url }, namespace: NAMESPACE }, { scopes: SCOPES })
    admin = app.get(CacheAdminService)
    status = app.get(CacheStatusService)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    monitor?.disconnect()
    owner?.disconnect()
    await redis?.container.stop()
  })

  // Scenario: every method of the administration API, over every value type, as a user that has
  // no write permission.
  // Rule: each answers, none is refused by the server, and the ACL log holds no denied command.
  it('answers every read and the server refuses nothing', async () => {
    const page = await admin.listKeys('cache')
    expect(page.entries.length).toBe(6)
    for (const entry of page.entries) {
      const detail = await admin.describeKey('cache', entry.key)
      expect(detail.type).not.toBe('missing')
      const revealed = await admin.revealValue('cache', entry.key)
      expect(revealed).toBeDefined()
    }
    expect((await status.health()).status).toBe('up')
    expect((await status.stats()).server.redisVersion).not.toBeNull()
    expect(await app.get(CacheService).ping()).toBe('PONG')

    const denied = await owner.call('ACL', 'LOG')
    expect(denied).toEqual([])
  })

  // Scenario: the same suite saw the commands the server received. The reader's connections are
  // found by the server's own list of clients, by user.
  // Rule: every command those connections sent is on the read allowlist, and there were some.
  it('sends only commands on the read allowlist', async () => {
    const clients = String(await owner.client('LIST'))
    const readerAddresses = new Set(
      clients
        .split('\n')
        .filter((line) => line.includes(`user=${USER} `))
        .map((line) => /(?:^| )addr=(\S+)/.exec(line)?.[1] ?? '')
    )
    expect(readerAddresses.size).toBeGreaterThan(0)
    const sent = seen.filter((event) => readerAddresses.has(event.source))
    expect(sent.length).toBeGreaterThan(0)
    const unexpected = [...new Set(sent.map((event) => event.name))].filter(
      (name) => !ALLOWED_COMMANDS.has(name)
    )
    expect(unexpected).toEqual([])
  })

  // Scenario: the control. The same user, asked to write, is refused.
  // Rule: the proof means something only if a write would have failed.
  it('would have refused a write (control)', async () => {
    const client = app.get(CacheService).getClient()
    await expect(client.set(`${NAMESPACE}:forbidden`, 'x')).rejects.toThrow(/NOPERM/)
    expect(await owner.exists(`${NAMESPACE}:forbidden`)).toBe(0)
  })
})
