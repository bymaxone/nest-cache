/**
 * End-to-end test of `@bymax-one/nest-cache/observability` inside a booted application.
 *
 * A real action (a write, a read that hits, one that misses, a failing command) reaches the
 * observability through the module's `events` option; a scrape of the registry serves the samples,
 * the readiness indicator answers through the injected `CacheService`, the log events arrive as
 * objects, and no secret that went through the cache appears in any of them. The registration step
 * stands in for nest-core's discovery, which a jest CommonJS run cannot exercise; the markers that
 * discovery reads are asserted in the unit suite.
 */
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'

import { BymaxCacheModule, CacheService } from '@bymax-one/nest-cache'
import {
  CACHE_OBSERVABILITY,
  CacheHealthIndicator,
  CacheObservability,
  CacheOperationMetrics
} from '@bymax-one/nest-cache/observability'

// Swap real ioredis for the in-memory mock so the app boots without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

const SECRET = 'sk-live-4eC39HqLyjWDarjtT1zdp7dc'

describe('cache observability E2E', () => {
  it('serves a sample, a readiness answer and a log event for a real action, and no secret', async () => {
    const entries: unknown[] = []
    const record = (entry: unknown): void => void entries.push(entry)
    const observability = new CacheObservability({
      logger: { debug: record, log: record, warn: record, error: record }
    })

    @Module({
      imports: [
        BymaxCacheModule.forRoot({
          connection: { host: 'localhost' },
          events: observability.events
        })
      ],
      providers: [
        { provide: CACHE_OBSERVABILITY, useValue: observability },
        CacheOperationMetrics,
        CacheHealthIndicator
      ]
    })
    class ObservabilityModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ObservabilityModule] }).compile()
    await moduleRef.init()
    const registry = new Registry()
    moduleRef.get(CacheOperationMetrics).registerMetrics(registry)
    const cache = moduleRef.get(CacheService)

    await cache.set('session', SECRET, { token: SECRET })
    await cache.get('session', SECRET)
    await cache.get('session', 'absent')
    await cache.setRaw('session', 'bad', 'not json')
    await cache.get('session', 'bad').catch(() => undefined)
    const text = await registry.metrics()
    const health = await moduleRef.get(CacheHealthIndicator).check()
    await moduleRef.close()

    expect(text).toContain('bymax_cache_operations_total{operation="set",outcome="ok"} 1')
    expect(text).toContain('bymax_cache_operations_total{operation="get",outcome="hit"} 1')
    expect(text).toContain('bymax_cache_operations_total{operation="get",outcome="miss"} 1')
    // A stored value that cannot be decoded fails the read, and is counted as an error.
    expect(text).toContain('bymax_cache_operations_total{operation="get",outcome="error"} 1')
    expect(health).toEqual({ status: 'up' })
    expect(entries).toContainEqual(expect.objectContaining({ event: 'CACHE_READY', role: 'main' }))
    expect(text).not.toContain(SECRET)
    expect(JSON.stringify(entries)).not.toContain(SECRET)
  })
})
