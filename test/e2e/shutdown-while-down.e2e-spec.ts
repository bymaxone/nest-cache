/**
 * Shutdown during a Redis outage, end-to-end against a REAL Redis (Testcontainers).
 *
 * Layer: server. A client that is already reconnecting has no live connection to say goodbye on,
 * so shutdown must release it at once and must not report a forced disconnect for it.
 */
import { execFileSync } from 'node:child_process'

import { PubSubService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'
import { getFreePort } from './helpers/free-port'
import { startRedisContainer, type StartedRedis } from './helpers/start-redis-container'

describe('Shutdown while Redis is down (real Redis)', () => {
  let redis: StartedRedis

  beforeAll(async () => {
    redis = await startRedisContainer({ hostPort: await getFreePort() })
  }, 60_000)

  afterAll(async () => {
    await redis?.container.stop().catch(() => undefined)
  })

  // Scenario: Redis stops, both clients go to 'reconnecting', then the application closes.
  // Rule: no forced_disconnect is reported (neither role had a live connection) and the close does
  // not wait out shutdownTimeoutMs.
  it('closes at once and reports no forced_disconnect when both clients are reconnecting', async () => {
    const events: [string, Record<string, unknown>][] = []
    const app = await bootCacheApp({
      connection: { url: redis.url },
      namespace: 'e2e-down',
      shutdownTimeoutMs: 3_000,
      events: { onEvent: (name, data) => void events.push([name, data]) }
    })
    const pubsub = app.get(PubSubService)
    await pubsub.subscribe('down', () => undefined)

    execFileSync('docker', ['stop', '-t', '0', redis.container.getId()])
    const roles = (): Set<unknown> =>
      new Set(events.filter(([name]) => name === 'reconnecting').map(([, data]) => data['role']))
    const deadline = Date.now() + 10_000
    while (!(roles().has('main') && roles().has('subscriber')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect([...roles()].sort()).toEqual(['main', 'subscriber'])

    const started = Date.now()
    await app.close()
    const elapsed = Date.now() - started

    expect(events.filter(([, data]) => data['reason'] === 'forced_disconnect')).toEqual([])
    expect(elapsed).toBeLessThan(500)
  }, 30_000)
})
