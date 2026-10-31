/**
 * Unit tests for the `ttlSeconds` contract of {@link CacheService}.
 *
 * Layer: server. Covers what `set`, `setRaw`, `setNx` and `expire` accept and refuse
 * before a command is sent; the boundary table of the validator itself is in
 * `utils/ttl.spec.ts`. Kept apart from `cache.service.spec.ts` so that suite stays
 * within the repository's file-size limit.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so the ConnectionManager builds a
// working client without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

describe('CacheService ttlSeconds', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    // The mock store can persist across instances; start every test from empty.
    await connection.getClient().flushall()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    await connection.onModuleDestroy()
  })

  // The write methods refuse a TTL Redis would reject, before anything is sent: no
  // raw reply error, and nothing written. Each case is one write family member.
  describe.each([
    ['set', (ttl: number) => cache.set('x', 'w', 'v', ttl)],
    ['setRaw', (ttl: number) => cache.setRaw('x', 'w', 'v', ttl)],
    ['setNx', (ttl: number) => cache.setNx('x', 'w', 'v', ttl)]
  ])('%s with an invalid TTL', (_name, write) => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses %s with INVALID_TTL and writes nothing',
      async (ttl) => {
        const caught = await write(ttl).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(CacheException)
        expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
        expect(await cache.exists('x', 'w')).toBe(false)
      }
    )

    it('still accepts 1, the smallest valid TTL', async () => {
      await write(1)

      expect(await cache.ttl('x', 'w')).toBeGreaterThan(0)
    })
  })

  // expire keeps Redis's meaning for zero and negative integers (the key is deleted),
  // so a call that works today keeps working; only a non-integer is refused.
  it('expire still deletes the key for a zero TTL', async () => {
    await cache.set('x', 'z', 'v')

    expect(await cache.expire('x', 'z', 0)).toBe(true)
    expect(await cache.exists('x', 'z')).toBe(false)
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'expire refuses %s with INVALID_TTL and leaves the key untouched',
    async (ttl) => {
      await cache.set('x', 'e', 'v')

      const caught = await cache.expire('x', 'e', ttl).catch((error: unknown) => error)

      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_TTL)
      expect(await cache.ttl('x', 'e')).toBe(-1)
    }
  )
})
