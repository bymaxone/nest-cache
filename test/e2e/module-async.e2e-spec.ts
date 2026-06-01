/**
 * End-to-end test for `BymaxCacheModule.forRootAsync` against a REAL Redis
 * (Testcontainers).
 *
 * Unit tests cover the async wiring in isolation; this proves the path most
 * NestJS apps actually use — resolving the connection from a `ConfigService`-like
 * module via `useFactory` + `inject` — works end to end: the app boots, the
 * factory runs with its injected dependency, scripts pre-load on bootstrap, and
 * the cache talks to a live server.
 */
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCacheModule, CacheService } from '@bymax-one/nest-cache'

import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { INestApplicationContext } from '@nestjs/common'

/** A token a config module exports, mimicking a `ConfigService` value. */
const REDIS_URL = Symbol('REDIS_URL')

const INCREMENT_LUA = `return redis.call('INCRBY', KEYS[1], ARGV[1])`

describe('BymaxCacheModule.forRootAsync E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: INestApplicationContext
  let cache: CacheService

  beforeAll(async () => {
    redis = await startRedisContainer()

    // A standalone config module that exposes the (container) URL behind a token.
    @Module({
      providers: [{ provide: REDIS_URL, useValue: redis.url }],
      exports: [REDIS_URL]
    })
    class RedisConfigModule {}

    @Module({
      imports: [
        BymaxCacheModule.forRootAsync({
          imports: [RedisConfigModule],
          inject: [REDIS_URL],
          useFactory: (url: unknown) => {
            if (typeof url !== 'string')
              throw new TypeError(`REDIS_URL must be a string, got ${typeof url}`)
            return {
              connection: { url },
              namespace: 'e2e-async',
              scripts: [{ name: 'incr-by', lua: INCREMENT_LUA }]
            }
          }
        })
      ]
    })
    class AsyncAppModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AsyncAppModule] }).compile()
    app = await moduleRef.init()
    cache = app.get(CacheService)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop()
  })

  // The factory-resolved connection must produce a working cache: a roundtrip
  // against the live server proves the injected URL was used and the app booted.
  it('resolves the connection via useFactory and serves cache operations', async () => {
    await cache.set('async', 'k', { ok: true })

    expect(await cache.get('async', 'k')).toEqual({ ok: true })
    expect(await cache.isHealthy()).toBe(true)
  })

  // A script supplied through the async factory must be pre-loaded on bootstrap
  // and invocable via eval — proving onApplicationBootstrap runs in the async path.
  it('pre-loads and runs a script supplied through the async factory', async () => {
    const result = await cache.eval('incr-by', ['async:counter'], [5])

    expect(result).toBe(5)
    expect(await cache.getRaw('async', 'counter')).toBe('5')
  })
})
