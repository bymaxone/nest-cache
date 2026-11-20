/**
 * Reports the cache's reachability to the readiness endpoint.
 *
 * Layer: observability, an optional subpath. One `PING` through `CacheService.isHealthy`: it writes
 * nothing, reads no key and carries no detail, so a probe cannot leak or load anything. The command
 * timeout bounds it, and the aggregator applies its own indicator timeout on top.
 */
import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'
import { Inject, Injectable } from '@nestjs/common'

import { CacheService } from '@bymax-one/nest-cache'

/** The name the indicator reports in the readiness response. */
export const CACHE_HEALTH_INDICATOR_NAME = 'cache'

/** Readiness indicator over {@link CacheService.isHealthy}. */
@BymaxHealthIndicator()
@Injectable()
export class CacheHealthIndicator implements IHealthIndicator {
  /** The name reported in the readiness response. */
  readonly name = CACHE_HEALTH_INDICATOR_NAME

  /**
   * @param cache - The cache whose `PING` is the check.
   */
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  /**
   * Pings the cache.
   *
   * @returns `up` when the server answers `PONG`, `down` otherwise; never a detail.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: (await this.cache.isHealthy()) ? 'up' : 'down' }
  }
}
