/**
 * Behaviour the README states about large argument lists and about a pipeline under a timeout,
 * end-to-end against a REAL Redis (Testcontainers).
 *
 * Layer: server. `pipeline()` is the driver's own pipeline, so its failure shape differs from a
 * library command; and the argument lists the library splits are only too long for a direct call.
 */
import { execFileSync } from 'node:child_process'

import { CACHE_ERROR_CODES, CacheException, CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** More arguments than one call can spread: the README puts the limit at about 125 000. */
const TOO_MANY_TO_SPREAD = 200_000

describe('Documented limits E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()
    app = await bootCacheApp({
      connection: { url: redis.url, commandTimeout: 1_000 },
      namespace: 'e2e-limits'
    })
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // Scenario: one call spreads more arguments than the stack holds, then the same count goes through
  // the library.
  // Rule: the direct spread overflows, and mset, mget and delMany of that many entries all work.
  it('splits an argument list that is too long to spread', async () => {
    const ids = Array.from({ length: TOO_MANY_TO_SPREAD }, (_, index) => String(index))
    const count = (...values: string[]): number => values.length

    expect(() => count(...ids)).toThrow(RangeError)

    await cache.mset(
      'many',
      ids.map((id): [string, string] => [id, id])
    )
    const stored = await cache.mget<string>('many', ids)
    expect([stored.length, stored[0], stored[ids.length - 1]]).toEqual([
      ids.length,
      ids[0],
      ids[ids.length - 1]
    ])
    expect(await cache.delMany('many', ids)).toBe(ids.length)
  }, 120_000)

  // Scenario: the server is paused, so a pipeline and a raw command both wait past commandTimeout.
  // Rule: exec() resolves with one [error] entry per command and no value, while the raw command rejects with
  // the driver's own error and a library command with COMMAND_TIMEOUT.
  it('resolves exec() with an error entry per command when the server stops answering', async () => {
    const id = redis.container.getId()
    execFileSync('docker', ['pause', id])
    try {
      const pairs = await cache.pipeline().set('e2e-limits:p:a', '1').get('e2e-limits:p:a').exec()
      expect(pairs?.map(([error, value]) => [error?.message, value])).toEqual([
        ['Command timed out', undefined],
        ['Command timed out', undefined]
      ])

      const raw: unknown = await cache
        .getClient()
        .get('e2e-limits:p:a')
        .catch((error: unknown) => error)
      expect(raw).not.toBeInstanceOf(CacheException)
      expect((raw as Error).message).toBe('Command timed out')

      await expect(cache.getRaw('p', 'a')).rejects.toMatchObject({
        code: CACHE_ERROR_CODES.COMMAND_TIMEOUT
      })
    } finally {
      execFileSync('docker', ['unpause', id])
    }
  })
})
