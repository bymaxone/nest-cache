/**
 * Unit tests for {@link CacheHealthIndicator}.
 *
 * Layer: observability. The indicator is one `PING` through `isHealthy`: up on an answer, down on
 * none, and never a detail a probe could leak.
 */
import { BYMAX_HEALTH_INDICATOR_METADATA } from '@bymax-one/nest-core/health'
import { Test } from '@nestjs/testing'

import { CacheService } from '@bymax-one/nest-cache'

import { CACHE_HEALTH_INDICATOR_NAME, CacheHealthIndicator } from './cache-health-indicator'

const indicatorOver = (isHealthy: () => Promise<boolean>): CacheHealthIndicator =>
  new CacheHealthIndicator({ isHealthy } as Pick<CacheService, 'isHealthy'> as CacheService)

describe('CacheHealthIndicator', () => {
  it('is marked as a health indicator and named cache', () => {
    expect(Reflect.getMetadata(BYMAX_HEALTH_INDICATOR_METADATA, CacheHealthIndicator)).toBe(true)
    expect(CACHE_HEALTH_INDICATOR_NAME).toBe('cache')
    expect(indicatorOver(async () => true).name).toBe('cache')
  })

  // Scenario: the server answers, then it does not.
  it.each([
    [true, 'up'],
    [false, 'down']
  ] as const)('reports %s as %s, with no details', async (healthy, status) => {
    await expect(indicatorOver(async () => healthy).check()).resolves.toEqual({ status })
  })

  it('resolves the cache through its class token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CacheService, useValue: { isHealthy: async () => true } },
        CacheHealthIndicator
      ]
    }).compile()

    await expect(moduleRef.get(CacheHealthIndicator).check()).resolves.toEqual({ status: 'up' })
  })
})
