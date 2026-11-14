/**
 * Pub/Sub liveness end-to-end tests against a REAL Redis (Testcontainers).
 *
 * Layer: server. Two things a subscriber connection must still do when the network or the server
 * misbehaves: a subscription the application released must not stay on the server, and the
 * subscriber's shutdown must end within the configured shutdown timeout.
 */
import { execFileSync } from 'node:child_process'

import { Redis } from 'ioredis'

import { PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { getFreePort } from './helpers/free-port'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'
import { TcpProxy } from './helpers/tcp-proxy'

import type { TestingModule } from '@nestjs/testing'

/** How many clients `PUBSUB NUMSUB` counts on `channel`, read over a connection of its own. */
async function numSub(redis: Redis, channel: string): Promise<number> {
  const reply = (await redis.call('PUBSUB', 'NUMSUB', channel)) as [string, number]
  return Number(reply[1])
}

describe('Pub/Sub liveness (real Redis)', () => {
  let redis: StartedRedis
  let raw: Redis

  beforeAll(async () => {
    redis = await startRedisContainer({ hostPort: await getFreePort() })
    raw = new Redis(redis.url)
  }, 60_000)

  afterAll(async () => {
    raw?.disconnect()
    await redis?.container.stop().catch(() => undefined)
  })

  // The subscriber loses its connection, the application unsubscribes while it is down, and the
  // connection comes back. The server must not hold the subscription the application released.
  it('leaves no server-side subscription after an unsubscribe issued while the connection was down', async () => {
    const proxy = new TcpProxy(await getFreePort(), {
      host: '127.0.0.1',
      port: redis.container.getMappedPort(6379)
    })
    await proxy.open()
    const app: TestingModule = await bootCacheApp({
      connection: { host: '127.0.0.1', port: proxy.port, commandTimeout: 500 },
      namespace: 'e2e-liveness'
    })
    try {
      const pubsub = app.get(PubSubService)
      const unsubscribe = await pubsub.subscribe('c8', () => undefined)
      expect(await numSub(raw, 'e2e-liveness:c8')).toBe(1)

      await proxy.cut()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const outcome = await unsubscribe().then(
        () => 'resolved',
        (error: unknown) => (error as { code?: string }).code ?? 'rejected'
      )
      await proxy.open()
      // The subscriber reconnects and restores what it believes it is subscribed to.
      await new Promise((resolve) => setTimeout(resolve, 3_000))

      expect([outcome, await numSub(raw, 'e2e-liveness:c8')]).toEqual([outcome, 0])
    } finally {
      await proxy.cut()
      await app.close()
    }
  }, 30_000)

  // The server stops answering and the application shuts down. The subscriber's QUIT is bounded only
  // by the command timeout, so a long command timeout must not stretch a short shutdown timeout.
  it('ends the shutdown of an unresponsive server within shutdownTimeoutMs', async () => {
    const app = await bootCacheApp({
      connection: { url: redis.url, commandTimeout: 8_000 },
      namespace: 'e2e-liveness',
      shutdownTimeoutMs: 500
    })
    await app.get(PubSubService).subscribe('c4', () => undefined)
    const id = redis.container.getId()
    execFileSync('docker', ['pause', id])
    let elapsed = 0
    try {
      const started = Date.now()
      await app.close()
      elapsed = Date.now() - started
    } finally {
      execFileSync('docker', ['unpause', id])
    }

    expect(elapsed).toBeLessThan(3_000)
  }, 40_000)
})
