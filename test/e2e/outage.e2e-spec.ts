/**
 * Outage end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Three outages that look alike from a caller and need different handling: the server PAUSED
 * (it accepts the socket and never answers), STOPPED (the connection is refused), and a FRESH
 * client that never reaches it. Each must surface as a coded `CacheException`, the original ioredis
 * error on `cause`, and nothing must be left reconnecting after a failed boot.
 */
import { execFileSync } from 'node:child_process'

import { CacheAdminService } from '@bymax-one/nest-cache/admin'
import {
  CACHE_ERROR_CODES,
  CacheException,
  CacheService,
  PubSubService
} from '@bymax-one/nest-cache'

import { bootAdminApp } from './fixtures/test-admin-app.module'
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

/** The connect timeout the fresh boot is configured with, which is the deadline it must meet. */
const CONNECT_TIMEOUT_MS = 1_000

/**
 * Slack added to a configured deadline before a wall-clock assertion fails. The check is of a real
 * deadline, so it stays on the real clock, but its bound is the configured deadline plus this margin
 * and never a fixed number: a loaded machine delays the rejection, not the deadline it is measured
 * against.
 */
const DEADLINE_MARGIN_MS = 10_000

describe('Outage E2E (real Redis)', () => {
  let redis: StartedRedis
  let app: TestingModule
  let cache: CacheService
  let pubsub: PubSubService
  let admin: CacheAdminService

  /** Every way the library reaches the server, so each is shown to answer the same way. */
  const everyPath: Record<string, () => Promise<unknown>> = {
    'cache get': () => cache.getRaw('out', 'k'),
    'script eval': () => cache.eval('echo', ['out:k'], []),
    'pubsub publish': () => pubsub.publish('out', 'x'),
    'admin listKeys': () => admin.listKeys('out')
  }

  beforeAll(async () => {
    const hostPort = await getFreePort()
    redis = await startRedisContainer({ hostPort })
    app = await bootAdminApp(
      {
        connection: { url: redis.url, commandTimeout: 500 },
        namespace: 'e2e-outage',
        scripts: [{ name: 'echo', lua: 'return 1' }]
      },
      {
        scopes: [
          {
            id: 'out',
            label: 'Outage',
            pattern: 'e2e-outage:*',
            isReadable: true,
            origin: 'the test'
          }
        ]
      }
    )
    cache = app.get(CacheService)
    pubsub = app.get(PubSubService)
    admin = app.get(CacheAdminService)
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
      for (const [path, call] of Object.entries(everyPath)) {
        const error = await rejectionOf(call)

        expect([path, error instanceof CacheException]).toEqual([path, true])
        expect([path, (error as CacheException).code]).toEqual([
          path,
          CACHE_ERROR_CODES.COMMAND_TIMEOUT
        ])
        expect((error as CacheException).getStatus()).toBe(503)
        expect(((error as CacheException).cause as Error).message).toBe('Command timed out')
      }
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
        connection: { host: '127.0.0.1', port: closedPort, connectTimeout: CONNECT_TIMEOUT_MS },
        namespace: 'e2e-fresh'
      })
    )

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
    expect((error as CacheException).getStatus()).toBe(503)
    expect(Date.now() - started).toBeLessThan(CONNECT_TIMEOUT_MS + DEADLINE_MARGIN_MS)
  }, 20_000)

  // STOPPED: the connection is refused and the offline queue is off, so every call rejects at once
  // with ioredis's offline error, reported as CONNECTION_LOST.
  it('reports a stopped server as CONNECTION_LOST (offline)', async () => {
    await redis.container.stop()

    // The client notices the stop on its own; wait for the first path to say so, then every path
    // must answer the same way at once.
    await waitForCode(everyPath['cache get']!, CACHE_ERROR_CODES.CONNECTION_LOST, 15_000)
    for (const [path, call] of Object.entries(everyPath)) {
      const error = await rejectionOf(call)

      expect([path, (error as CacheException).code]).toEqual([
        path,
        CACHE_ERROR_CODES.CONNECTION_LOST
      ])
      expect((error as CacheException).getStatus()).toBe(503)
      expect((error as CacheException).details).toEqual({ reason: 'offline' })
      expect(((error as CacheException).cause as Error).message).toBe(
        "Stream isn't writeable and enableOfflineQueue options is false"
      )
    }
  }, 30_000)
})
