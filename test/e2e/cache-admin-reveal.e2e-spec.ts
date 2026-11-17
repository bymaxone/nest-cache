/**
 * End-to-end tests of `revealValue` on VERY LARGE values against a REAL Redis (Testcontainers).
 *
 * A reveal is a debugging read, so it must stay bounded whatever the value holds: a ten-megabyte
 * string and a set and a hash of two hundred thousand entries are revealed, and the server's own
 * counters show which commands ran and how many bytes it sent back.
 */
import { CacheService } from '@bymax-one/nest-cache'
import { CacheAdminService, parseInfoFields, type CacheScope } from '@bymax-one/nest-cache/admin'

import { bootAdminApp } from './fixtures/test-admin-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

const NAMESPACE = 'e2e-reveal'
const SCOPES: readonly CacheScope[] = [
  {
    id: 'cache',
    label: 'Application cache',
    pattern: `${NAMESPACE}:*`,
    isReadable: true,
    origin: 'the application namespace'
  }
]
const ENTRIES = 200_000
const STRING_BYTES = 10_000_000

describe('cache admin reveal of large values (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let admin: CacheAdminService
  let cache: CacheService

  /** The server's counter of bytes sent to clients, and the number of calls of each command. */
  async function counters(): Promise<{ bytes: number; calls: Map<string, number> }> {
    const fields = parseInfoFields(await cache.info())
    const stats = await cache.getClient().info('commandstats')
    const calls = new Map<string, number>()
    for (const match of stats.matchAll(/cmdstat_(\w+):calls=(\d+)/g)) {
      calls.set(match[1] ?? '', Number(match[2]))
    }
    return { bytes: Number(fields.get('total_net_output_bytes')), calls }
  }

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootAdminApp(
      { connection: { url: redis.url }, namespace: NAMESPACE },
      { scopes: SCOPES }
    )
    admin = app.get(CacheAdminService)
    cache = app.get(CacheService)
    const client = cache.getClient()
    await client.set(`${NAMESPACE}:big:string`, 'x'.repeat(STRING_BYTES))
    for (let from = 0; from < ENTRIES; from += 10_000) {
      const members = Array.from({ length: 10_000 }, (_, i) => `member-${from + i}`)
      const fields = members.flatMap((member) => [member, 'v'])
      await client.sadd(`${NAMESPACE}:big:set`, ...members)
      await client.hset(`${NAMESPACE}:big:hash`, ...fields)
    }
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // Scenario: a ten-megabyte string, a set and a hash of two hundred thousand entries are revealed.
  // Rule: each reveal returns the first `limit` and says it is incomplete; the server ran only the
  // bounded commands and sent back a tiny fraction of what the values hold.
  it('reveals large values with bounded commands and a small reply', async () => {
    const before = await counters()

    const string = await admin.revealValue('cache', `${NAMESPACE}:big:string`)
    const set = await admin.revealValue('cache', `${NAMESPACE}:big:set`)
    const hash = await admin.revealValue('cache', `${NAMESPACE}:big:hash`)

    const after = await counters()
    const ran = (name: string): number =>
      (after.calls.get(name) ?? 0) - (before.calls.get(name) ?? 0)
    expect(string).toMatchObject({
      value: { kind: 'string', isComplete: false, value: 'x'.repeat(4096) }
    })
    expect(set).toMatchObject({ value: { kind: 'members', isComplete: false } })
    expect(
      set.status === 'revealed' && set.value.kind === 'members' && set.value.members
    ).toHaveLength(200)
    expect(hash).toMatchObject({ value: { kind: 'hash', isComplete: false } })
    expect(
      hash.status === 'revealed' && hash.value.kind === 'hash' && hash.value.fields
    ).toHaveLength(200)
    expect([ran('get'), ran('hgetall'), ran('smembers')]).toEqual([0, 0, 0])
    expect(ran('getrange')).toBe(1)
    expect(ran('hscan')).toBeGreaterThan(0)
    expect(ran('sscan')).toBeGreaterThan(0)
    expect(after.bytes - before.bytes).toBeLessThan(200_000)
  }, 60_000)

  // Scenario: a string whose four-byte character straddles the default limit of 4096 units.
  // Rule: the shown text ends on a whole character, so it holds 4095 units, and the value is incomplete.
  it('does not cut a surrogate pair in half at the string limit', async () => {
    const client = cache.getClient()
    await client.set(`${NAMESPACE}:pair:string`, `${'a'.repeat(4095)}\u{1F600}tail`)

    const result = await admin.revealValue('cache', `${NAMESPACE}:pair:string`)

    expect(result).toMatchObject({ value: { kind: 'string', isComplete: false } })
    const text =
      result.status === 'revealed' && result.value.kind === 'string' ? result.value.value : ''
    expect(text).toBe('a'.repeat(4095))
  })

  // Scenario: a hash, a set, a list and a sorted set deleted right after the TYPE reply, the way a
  // key that expires or is removed between the two reads would be.
  // Rule: each reveal answers `missing`, not an empty collection.
  it.each([
    [
      'hash',
      (client: ReturnType<CacheService['getClient']>, key: string) => client.hset(key, 'f', 'v')
    ],
    ['set', (client: ReturnType<CacheService['getClient']>, key: string) => client.sadd(key, 'm')],
    [
      'list',
      (client: ReturnType<CacheService['getClient']>, key: string) => client.rpush(key, 'i')
    ],
    [
      'zset',
      (client: ReturnType<CacheService['getClient']>, key: string) => client.zadd(key, 1, 'z')
    ]
  ])('reports a %s deleted between TYPE and the read as missing', async (type, seed) => {
    const client = cache.getClient()
    const key = `${NAMESPACE}:vanish:${type}`
    await seed(client, key)
    const original = client.type.bind(client)
    const spy = jest.spyOn(client, 'type').mockImplementation(async (name: string) => {
      const reply = await original(name)
      await client.del(name)
      return reply
    })
    try {
      expect(await admin.revealValue('cache', key)).toEqual({ status: 'missing', key })
    } finally {
      spy.mockRestore()
    }
  })
})
