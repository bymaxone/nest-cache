/**
 * Contract tests of {@link closeClient} against the REAL ioredis classes.
 *
 * Layer: server. No mock and no Redis server: a client pointed at a port nothing listens on sits in
 * its retry delay with whatever was queued while it was down. These tests are the only guard of what
 * `closeClient` borrows from ioredis, so an ioredis release that changes it fails here.
 */
import { Cluster, Redis } from 'ioredis'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { closeClient } from './close-client'

/** Resolves when `client` reports the given status event, or after `ms`. */
function whenEmitted(client: Redis | Cluster, event: string, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms)
    client.once(event, () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** How a promise ends within `ms`: its rejection, its value, or `pending` when it has not settled. */
async function outcome(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = new Promise((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        () => 'resolved',
        (error: unknown) => error
      ),
      pending
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('closeClient against the real ioredis classes', () => {
  // Scenario: ioredis is upgraded.
  // Rule: the flush that closeClient relies on is still there on both client classes.
  it('finds flushQueue on a Redis client and on a Cluster', () => {
    expect([
      typeof Reflect.get(Redis.prototype, 'flushQueue'),
      typeof Reflect.get(Cluster.prototype, 'flushQueue')
    ]).toEqual(['function', 'function'])
  })

  // Scenario: the server is down, the client is in its retry delay, and a command was queued while it
  // was down; the application closes.
  // Rule: the queued command is rejected at once with the library's own refusal, not left to its
  // command timeout, so nothing the library queued keeps the process alive.
  it('rejects a command queued on a reconnecting Redis client when it is closed', async () => {
    const client = new Redis({
      host: '127.0.0.1',
      port: 1,
      retryStrategy: () => 600_000,
      commandTimeout: 30_000,
      enableOfflineQueue: true
    })
    client.on('error', () => undefined)
    await whenEmitted(client, 'reconnecting', 5_000)
    const timersBefore = process.getActiveResourcesInfo().filter((name) => name === 'Timeout')
    const queued = client.get('k')

    await closeClient(client, 1_000, () => undefined)
    const result = await outcome(queued, 500)
    const timersAfter = process.getActiveResourcesInfo().filter((name) => name === 'Timeout')
    expect(timersAfter.length).toBeLessThanOrEqual(timersBefore.length)

    expect(result).toBeInstanceOf(CacheException)
    expect((result as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect((result as CacheException).details).toEqual({ reason: 'shutdown' })
  })

  // Scenario: the same for a cluster whose nodes are all down.
  // Rule: the same refusal reaches the command queued on it.
  it('rejects a command queued on a reconnecting Cluster when it is closed', async () => {
    const cluster = new Cluster([{ host: '127.0.0.1', port: 1 }], {
      clusterRetryStrategy: () => 600_000,
      redisOptions: { commandTimeout: 30_000 },
      enableOfflineQueue: true
    })
    cluster.on('error', () => undefined)
    await whenEmitted(cluster, 'close', 5_000).catch(() => undefined)
    const queued = cluster.get('k')

    await closeClient(cluster, 1_000, () => undefined)
    const result = await outcome(queued, 500)

    expect(result).toBeInstanceOf(CacheException)
    expect((result as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
  })
})
