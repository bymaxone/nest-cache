/**
 * Publishes the cache's operations, its Pub/Sub backlog and its drops to the metrics registry.
 *
 * Layer: observability, an optional subpath. Marked as a contributor, so `BymaxCoreModule` calls it
 * at bootstrap with the registry the scrape endpoint serves. Every label value comes from a closed
 * set (31 command names, four outcomes), so no series can be minted by a key, a tenant or an error.
 */
import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'
import { Inject, Injectable } from '@nestjs/common'
import { Counter, Gauge } from 'prom-client'

import type { CacheObservability } from './cache-observability'
import {
  CACHE_OBSERVABILITY,
  CACHE_OPERATIONS_METRIC,
  CACHE_PUBSUB_DROPPED_METRIC,
  CACHE_PUBSUB_QUEUED_METRIC,
  OPERATION_LABEL,
  OUTCOME_LABEL
} from './constants'

/**
 * Registers the operations counter, the Pub/Sub backlog gauge and the drops counter.
 *
 * Wire it with the observability that was handed to the module as `events`:
 *
 * ```ts
 * const observability = new CacheObservability()
 * BymaxCacheModule.forRoot({ connection, events: observability.events })
 * // providers: [{ provide: CACHE_OBSERVABILITY, useValue: observability }, CacheOperationMetrics]
 * ```
 */
@BymaxMetricsContributor()
@Injectable()
export class CacheOperationMetrics implements IMetricsContributor {
  /**
   * @param observability - What the module recorded, named by token.
   */
  constructor(@Inject(CACHE_OBSERVABILITY) private readonly observability: CacheObservability) {}

  /**
   * Registers the collectors against the scrape registry.
   *
   * Each is read from the observability on every scrape: it records from the moment a client
   * connects, before any registry exists, and a collector fed by the sink would discard that window.
   * The counters reset first, or each scrape would add the total to itself.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    const { observability } = this

    new Counter({
      name: CACHE_OPERATIONS_METRIC,
      help: 'Cache commands since start, by command and outcome (hit, miss, ok or error).',
      labelNames: [OPERATION_LABEL, OUTCOME_LABEL],
      registers: [registry],
      collect(): void {
        this.reset()
        for (const [operation, outcome, count] of observability.operations()) {
          this.inc({ [OPERATION_LABEL]: operation, [OUTCOME_LABEL]: outcome }, count)
        }
      }
    })

    new Gauge({
      name: CACHE_PUBSUB_QUEUED_METRIC,
      help: 'Pub/Sub messages waiting for a handler slot now; 0 when handlers are not bounded.',
      registers: [registry],
      collect(): void {
        this.set(observability.queued())
      }
    })

    new Counter({
      name: CACHE_PUBSUB_DROPPED_METRIC,
      help: 'Pub/Sub messages dropped since start because every handler slot and the queue were taken.',
      registers: [registry],
      collect(): void {
        this.reset()
        this.inc(observability.droppedTotal())
      }
    })
  }
}
