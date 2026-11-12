/**
 * End-to-end test of `@bymax-one/nest-cache/metrics` inside a booted application.
 *
 * The cache module's own connection events reach the tally through the `events` option, the
 * contributor resolves it through its token, and a scrape of the registry serves the series. The
 * registration step stands in for nest-core's discovery, which a jest CommonJS run cannot exercise
 * (it loads `prom-client` with a dynamic import); the marker that discovery reads is asserted in the
 * unit suite, and the packed tarball is probed against the real thing before a release.
 */
import { Test } from '@nestjs/testing'
import { BymaxCacheModule } from '@bymax-one/nest-cache'
import {
  CACHE_CONNECTION_TALLY,
  CACHE_EVENTS_METRIC,
  CACHE_READY_METRIC,
  CacheConnectionMetrics,
  CacheConnectionTally
} from '@bymax-one/nest-cache/metrics'
import { Module } from '@nestjs/common'

import { Registry } from 'prom-client'

// Swap real ioredis for the in-memory mock so the app boots without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

describe('cache connection metrics E2E', () => {
  // A scrape serves the series the cache's connection produced while booting.
  it('publishes the connection lifecycle of a booted cache module', async () => {
    const tally = new CacheConnectionTally()

    @Module({
      imports: [
        BymaxCacheModule.forRoot({ connection: { host: 'localhost' }, events: tally.events })
      ],
      providers: [{ provide: CACHE_CONNECTION_TALLY, useValue: tally }, CacheConnectionMetrics]
    })
    class ObservabilityModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ObservabilityModule] }).compile()
    await moduleRef.init()
    const registry = new Registry()
    moduleRef.get(CacheConnectionMetrics).registerMetrics(registry)

    const text = await registry.metrics()

    expect(text).toContain(`# TYPE ${CACHE_EVENTS_METRIC} counter`)
    expect(text).toMatch(new RegExp(`${CACHE_READY_METRIC}\\{role="main"\\} 1`))
    await moduleRef.close()
  })
})
