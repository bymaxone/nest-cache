/**
 * Publishes the cache connections' lifecycle to the application's metrics registry.
 *
 * Layer: metrics, an optional subpath. The readiness probe reports whether the cache answers now; it
 * cannot see a connection that drops and recovers between two probes, which is the failure worth
 * seeing. The reconnect count makes flapping visible, and means something only as a rate over time,
 * hence a counter.
 *
 * Marked as a contributor, so `BymaxCoreModule` calls it at bootstrap with the registry the scrape
 * endpoint serves. Alert on `role="main"`: the subscriber is control-plane traffic whose loss costs
 * Pub/Sub delivery, not cache reads.
 */
import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'
import { Inject, Injectable } from '@nestjs/common'
import { Counter, Gauge } from 'prom-client'

import type { CacheConnectionTally } from './connection-tally'
import {
  CACHE_CONNECTION_TALLY,
  CACHE_EVENTS_METRIC,
  CACHE_READY_METRIC,
  EVENT_LABEL,
  ROLE_LABEL
} from './constants'

/** Gauge value for a connection currently ready. */
const READY = 1

/** Gauge value for a connection not currently ready. */
const NOT_READY = 0

/**
 * Registers the connection event counter and the per-role readiness gauge.
 *
 * Wire it with the tally that was handed to the module as `events`:
 *
 * ```ts
 * const tally = new CacheConnectionTally()
 * BymaxCacheModule.forRoot({ connection, events: tally.events })
 * // providers: [{ provide: CACHE_CONNECTION_TALLY, useValue: tally }, CacheConnectionMetrics]
 * ```
 */
@BymaxMetricsContributor()
@Injectable()
export class CacheConnectionMetrics implements IMetricsContributor {
  /**
   * @param tally - The lifecycle tally to publish, named by token so nothing leans on emitted
   *   metadata.
   */
  constructor(@Inject(CACHE_CONNECTION_TALLY) private readonly tally: CacheConnectionTally) {}

  /**
   * Registers the collectors against the scrape registry.
   *
   * Both are read from the tally on every scrape instead of written as events arrive: the tally
   * starts recording before this runs, and a collector fed by the sink would discard the startup
   * window. The counter resets first, or each scrape would add the tally to itself.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    const { tally } = this

    new Counter({
      name: CACHE_EVENTS_METRIC,
      help: 'Redis connection lifecycle events since start, by connection role and event name.',
      labelNames: [ROLE_LABEL, EVENT_LABEL],
      registers: [registry],
      collect(): void {
        this.reset()
        for (const [role, event, count] of tally.entries()) {
          this.inc({ [ROLE_LABEL]: role, [EVENT_LABEL]: event }, count)
        }
      }
    })

    new Gauge({
      name: CACHE_READY_METRIC,
      help: 'Whether each Redis connection is currently ready: 1 when it is, 0 otherwise.',
      labelNames: [ROLE_LABEL],
      registers: [registry],
      collect(): void {
        for (const [role, isReady] of tally.readiness()) {
          this.set({ [ROLE_LABEL]: role }, isReady ? READY : NOT_READY)
        }
      }
    })
  }
}
