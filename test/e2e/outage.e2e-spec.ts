/**
 * Outage end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Three outages that look alike from a caller and need different handling: the server PAUSED
 * (it accepts the socket and never answers), STOPPED (the connection is refused), and a FRESH
 * client that never reaches it. Each must surface as a coded `CacheException`, the original ioredis
 * error on `cause`, and nothing must be left reconnecting after a failed boot.
 */
import { execFileSync } from 'node:child_process'

import { CACHE_ERROR_CODES, CacheException, CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { getFreePort } from './helpers/free-port'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

import type { TestingModule } from '@nestjs/testing'

/** What `call` rejected with, failing the test when it resolved. */
async function rejectionOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to reject')
}

/** Polls `call` until it rejects with a `CacheException` of `code`, or throws on timeout. */
async function waitForCode(
  call: () => Promise<unknown>,
  code: string,
  timeoutMs: number
): Promise<CacheException> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await call()
    } catch (error) {
      if (error instanceof CacheException && error.code === code) {
        return error
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`no ${code} within ${timeoutMs}ms`)
}

describe('Outage E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    const hostPort = await getFreePort()
    redis = await startRedisContainer({ hostPort })
    app = await bootCacheApp({
      connection: { url: redis.url, commandTimeout: 500 },
      namespace: 'e2e-outage'
    })
    cache = app.get(CacheService)
    await cache.setRaw('out', 'k', 'v')
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await redis?.container.stop().catch(() => undefined)
  })

  // PAUSED: the server holds the socket and never answers, so ioredis gives up at commandTimeout.
  it('reports a paused server as COMMAND_TIMEOUT and recovers when it resumes', async () => {
    const id = redis.container.getId()
    execFileSync('docker', ['pause', id])
    try {
      const error = await rejectionOf(() => cache.getRaw('out', 'k'))

      expect(error).toBeInstanceOf(CacheException)
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
      expect(((error as CacheException).cause as Error).message).toBe('Command timed out')
    } finally {
      execFileSync('docker', ['unpause', id])
    }

    expect(await cache.getRaw('out', 'k')).toBe('v')
  }, 30_000)

  // FRESH: a client that never reaches a server fails its boot within connectTimeout with the
  // structured error, and leaves no client reconnecting.
  it('fails a fresh boot against an unreachable server within connectTimeout', async () => {
    const closedPort = await getFreePort()
    const started = Date.now()

    const error = await rejectionOf(() =>
      bootCacheApp({
        connection: { host: '127.0.0.1', port: closedPort, connectTimeout: 1_000 },
        namespace: 'e2e-fresh'
      })
    )

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 20_000)

  // STOPPED: the connection is refused and the offline queue is off, so every call rejects at once
  // with ioredis's offline error, reported as CONNECTION_LOST.
  it('reports a stopped server as CONNECTION_LOST (offline)', async () => {
    await redis.container.stop()

    const error = await waitForCode(
      () => cache.getRaw('out', 'k'),
      CACHE_ERROR_CODES.CONNECTION_LOST,
      15_000
    )

    expect(error.details).toEqual({ reason: 'offline' })
    expect((error.cause as Error).message).toBe(
      "Stream isn't writeable and enableOfflineQueue options is false"
    )
  }, 30_000)
})
