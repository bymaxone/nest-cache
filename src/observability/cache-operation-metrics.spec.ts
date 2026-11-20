/**
 * Unit tests for {@link CacheOperationMetrics}.
 *
 * Layer: observability. Runs the contributor against a real `prom-client` registry and reads what a
 * scrape would serve: the names, the labels and the scrape behaviour are the tested contract, and a
 * cardinality test fails on any label value outside the closed sets.
 */
import { BYMAX_METRICS_CONTRIBUTOR_METADATA } from '@bymax-one/nest-core/metrics'
import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'

import { CacheObservability } from './cache-observability'
import { CacheOperationMetrics } from './cache-operation-metrics'
import {
  CACHE_OBSERVABILITY,
  CACHE_OPERATION_NAMES,
  CACHE_OPERATION_OUTCOMES,
  CACHE_OPERATIONS_METRIC,
  CACHE_PUBSUB_DROPPED_METRIC,
  CACHE_PUBSUB_QUEUED_METRIC
} from './constants'

const silent = { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() }

/** Registers the contributor against a fresh registry and returns both. */
const setup = (): { observability: CacheObservability; registry: Registry } => {
  const observability = new CacheObservability({ logger: silent })
  const registry = new Registry()
  new CacheOperationMetrics(observability).registerMetrics(registry)
  return { observability, registry }
}

describe('CacheOperationMetrics', () => {
  // The names are a public contract: dashboards and alerts are written against them.
  it('publishes the documented metric names', () => {
    expect(CACHE_OPERATIONS_METRIC).toBe('bymax_cache_operations_total')
    expect(CACHE_PUBSUB_QUEUED_METRIC).toBe('bymax_cache_pubsub_queued')
    expect(CACHE_PUBSUB_DROPPED_METRIC).toBe('bymax_cache_pubsub_dropped_total')
  })

  it('is marked as a metrics contributor', () => {
    expect(Reflect.getMetadata(BYMAX_METRICS_CONTRIBUTOR_METADATA, CacheOperationMetrics)).toBe(
      true
    )
  })

  it('resolves its observability through the injection token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CACHE_OBSERVABILITY, useValue: new CacheObservability({ logger: silent }) },
        CacheOperationMetrics
      ]
    }).compile()

    expect(moduleRef.get(CacheOperationMetrics)).toBeInstanceOf(CacheOperationMetrics)
  })

  // Scenario: operations, a backlog and a drop happen, then a scrape.
  // Rule: the scrape serves each sample; a second scrape does not add the totals to themselves.
  it('serves the operations, the backlog and the drops on every scrape', async () => {
    const { observability, registry } = setup()
    observability.events.onOperation?.('get', 'hit')
    observability.events.onOperation?.('get', 'hit')
    observability.events.onOperation?.('set', 'error')
    observability.events.onQueue?.(3)
    observability.events.onEvent?.('error', {
      role: 'subscriber',
      reason: 'handler_queue_full',
      dropped: 4
    })

    const first = await registry.metrics()
    const second = await registry.metrics()

    for (const text of [first, second]) {
      expect(text).toContain(`${CACHE_OPERATIONS_METRIC}{operation="get",outcome="hit"} 2`)
      expect(text).toContain(`${CACHE_OPERATIONS_METRIC}{operation="set",outcome="error"} 1`)
      expect(text).toContain(`${CACHE_PUBSUB_QUEUED_METRIC} 3`)
      expect(text).toContain(`${CACHE_PUBSUB_DROPPED_METRIC} 4`)
    }
  })

  // Scenario: a fresh start with nothing recorded.
  it('serves the gauge and the drop counter as zero before anything happens', async () => {
    const { registry } = setup()

    const text = await registry.metrics()

    expect(text).toContain(`${CACHE_PUBSUB_QUEUED_METRIC} 0`)
    expect(text).toContain(`${CACHE_PUBSUB_DROPPED_METRIC} 0`)
  })

  it('gives every metric a help text', async () => {
    const { registry } = setup()

    const text = await registry.metrics()

    for (const name of [
      CACHE_OPERATIONS_METRIC,
      CACHE_PUBSUB_QUEUED_METRIC,
      CACHE_PUBSUB_DROPPED_METRIC
    ]) {
      expect(text).toMatch(new RegExp(`# HELP ${name} \\S`))
    }
  })

  // Scenario: every name and outcome the library can report, plus values a host hook could invent.
  // Rule: the operations counter carries only members of the two closed sets, whatever is fed to it.
  it('never serves a label value outside the closed sets', async () => {
    const { observability, registry } = setup()
    const names = Object.keys(CACHE_OPERATION_NAMES)
    const outcomes = Object.keys(CACHE_OPERATION_OUTCOMES)
    for (const name of names) {
      for (const outcome of outcomes) {
        observability.events.onOperation?.(name as never, outcome as never)
      }
    }
    observability.events.onOperation?.('users:42' as never, 'ok')
    observability.events.onOperation?.('get', 'a@b.example' as never)
    observability.events.onOperation?.('__proto__' as never, 'ok')

    const text = await registry.metrics()
    const samples = text.split('\n').filter((line) => line.startsWith(CACHE_OPERATIONS_METRIC))

    expect(names).toHaveLength(31)
    expect(samples).toHaveLength(names.length * outcomes.length)
    for (const line of samples) {
      const match = /\{operation="([^"]*)",outcome="([^"]*)"\}/.exec(line)
      expect(names).toContain(match?.[1])
      expect(outcomes).toContain(match?.[2])
    }
  })
})
