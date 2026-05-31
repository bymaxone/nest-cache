/**
 * End-to-end tests for the Lua script path against a REAL Redis (Testcontainers).
 *
 * `ioredis-mock` does not faithfully implement `EVALSHA` / `SCRIPT`, so these
 * scenarios — atomic compare-and-set and transparent `NOSCRIPT` recovery after
 * the server's script cache is flushed — must run on an actual server. The spec
 * boots its own container and tears it down in `afterAll`.
 */
import { CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** Atomic compare-and-set: overwrite only when the current value matches ARGV[1]. */
const COMPARE_AND_SET_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  end
  return 0
`

describe('ScriptManagerService E2E (real Redis)', () => {
  let redis: StartedRedis | undefined
  let app: TestingModule | undefined
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({
      connection: { url: redis.url },
      namespace: 'e2e-script',
      scripts: [{ name: 'cas', lua: COMPARE_AND_SET_LUA }]
    })
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // EVALSHA must run the registered script atomically: a matching compare swaps
  // the value and returns 1, proving the register→LOAD→EVALSHA path end to end.
  it('executes a Lua script atomically (compare and set)', async () => {
    await cache.setRaw('counter', 'cas', '1')

    const result = await cache.eval('cas', ['counter:cas'], ['1', '2'])

    expect(result).toBe(1)
    expect(await cache.getRaw('counter', 'cas')).toBe('2')
  })

  // A non-matching compare must leave the value untouched and return 0 (the
  // script's else branch), confirming real Lua control flow on the server.
  it('returns 0 and leaves the value unchanged on a mismatch', async () => {
    await cache.setRaw('counter', 'miss', '10')

    const result = await cache.eval('cas', ['counter:miss'], ['999', '20'])

    expect(result).toBe(0)
    expect(await cache.getRaw('counter', 'miss')).toBe('10')
  })

  // After the server's script cache is flushed (SCRIPT FLUSH), the next EVALSHA
  // raises NOSCRIPT; the manager must reload the script and retry transparently.
  it('recovers transparently from NOSCRIPT after a server SCRIPT FLUSH', async () => {
    await cache.setRaw('counter', 'recover', '5')
    // Evict every cached SHA on the server so the next EVALSHA raises NOSCRIPT.
    await cache.getClient().script('FLUSH')

    const result = await cache.eval('cas', ['counter:recover'], ['5', '6'])

    expect(result).toBe(1)
    expect(await cache.getRaw('counter', 'recover')).toBe('6')
  })
})
