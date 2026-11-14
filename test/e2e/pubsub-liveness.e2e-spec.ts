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
      await pubsub.subscribe('c8-kept', () => undefined)
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

      // The channel the application kept is back on the server, so the subscriber did reconnect
      // and restore its subscriptions inside the wait above; the released one is not.
      expect(await numSub(raw, 'e2e-liveness:c8-kept')).toBe(1)
      expect([outcome, await numSub(raw, 'e2e-liveness:c8')]).toEqual([outcome, 0])
    } finally {
      await proxy.cut()
      await app.close()
    }
  }, 30_000)

  // The server executes the UNSUBSCRIBE but its reply never reaches the client, so the call rejects
  // at the command timeout. ioredis only forgets a channel when the reply arrives, so the reconnect
  // that follows would subscribe it again: the application released it and the server holds it.
  it('leaves no server-side subscription after an unsubscribe whose reply was lost', async () => {
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
      const unsubscribe = await pubsub.subscribe('c8b', () => undefined)
      await pubsub.subscribe('c8b-kept', () => undefined)
      expect(await numSub(raw, 'e2e-liveness:c8b')).toBe(1)

      proxy.dropReplies(true)
      const outcome = await unsubscribe().then(
        () => 'resolved',
        (error: unknown) => (error as { code?: string }).code ?? 'rejected'
      )
      const heldBeforeReconnect = await numSub(raw, 'e2e-liveness:c8b')
      await proxy.cut()
      proxy.dropReplies(false)
      await proxy.open()
      await new Promise((resolve) => setTimeout(resolve, 3_000))

      expect(await numSub(raw, 'e2e-liveness:c8b-kept')).toBe(1)
      expect([outcome, heldBeforeReconnect, await numSub(raw, 'e2e-liveness:c8b')]).toEqual([
        outcome,
        0,
        0
      ])
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

  // Nest runs the shutdown hooks of the providers of one module together, so the main client and the
  // subscriber are each bounded by shutdownTimeoutMs at the same time: the whole close takes about
  // one shutdownTimeoutMs, not two, however long the command timeout is.
  it('ends the whole close of an unresponsive server within about one shutdownTimeoutMs', async () => {
    const events: [string, Record<string, unknown>][] = []
    const app = await bootCacheApp({
      connection: { url: redis.url, commandTimeout: 30_000 },
      namespace: 'e2e-liveness',
      events: { onEvent: (name, data) => void events.push([name, data]) }
    })
    await app.get(PubSubService).subscribe('whole', () => undefined)
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

    const forced = events.filter(([, data]) => data['reason'] === 'forced_disconnect')
    expect(forced.map(([, data]) => data['role']).sort()).toEqual(['main', 'subscriber'])
    expect(elapsed).toBeGreaterThanOrEqual(4_500)
    expect(elapsed).toBeLessThan(7_500)
    process.stdout.write(
      `whole close with Redis frozen, default shutdownTimeoutMs 5000: ${elapsed} ms\n`
    )
  }, 60_000)
})
