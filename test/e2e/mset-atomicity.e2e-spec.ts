/**
 * End-to-end test, against a REAL Redis (Testcontainers), that a write sent in several parts is still
 * one atomic change.
 *
 * `mset` of more entries than one command takes is queued on a single `MULTI`/`EXEC`. A reader that
 * asks for the first and the last key of the write in one command must see both or neither, never one
 * without the other, however many parts the write was sent in.
 */
import { CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** Entries written: many parts of one command each. */
const ENTRIES = 100_000

describe('mset atomicity E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({ connection: { url: redis.url }, namespace: 'e2e-atomic' })
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // Scenario: 100 000 entries written while a reader asks for the first and the last key in one
  // command, over and over, until the write ends.
  // Rule: every answer is both values or neither, and once the write is done, every entry is stored.
  it('shows a long mset to a concurrent reader all at once or not at all', async () => {
    const entries = Array.from({ length: ENTRIES }, (_, index): [string, number] => [
      String(index),
      index
    ])
    let finished = false
    const seen = new Set<string>()
    const reader = (async (): Promise<void> => {
      while (!finished) {
        const [first, last] = await cache.mget<number>('big', ['0', String(ENTRIES - 1)])
        seen.add(`${first === null ? 'none' : 'some'}:${last === null ? 'none' : 'some'}`)
        await new Promise((resolve) => setImmediate(resolve))
      }
    })()

    await cache.mset('big', entries)
    finished = true
    await reader

    expect([...seen].filter((pair) => pair !== 'none:none' && pair !== 'some:some')).toEqual([])
    const stored = await cache.mget<number>('big', ['0', '49999', String(ENTRIES - 1)])
    expect(stored).toEqual([0, 49_999, ENTRIES - 1])
    expect(
      await cache.delMany(
        'big',
        entries.map(([id]) => id)
      )
    ).toBe(ENTRIES)
  }, 60_000)
})
