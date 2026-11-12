/**
 * Unit tests for {@link CacheConnectionMetrics}.
 *
 * Layer: metrics. Runs the contributor against a real `prom-client` registry and reads what a scrape
 * would serve, so the metric names, the label sets and the scrape behaviour are the tested contract.
 */
import { Test } from '@nestjs/testing'
import { BYMAX_METRICS_CONTRIBUTOR_METADATA } from '@bymax-one/nest-core/metrics'
import { Registry } from 'prom-client'

import { CacheConnectionMetrics } from './cache-connection-metrics'
import { CACHE_CONNECTION_TALLY, CACHE_EVENTS_METRIC, CACHE_READY_METRIC } from './constants'
import { CacheConnectionTally } from './connection-tally'

/** Registers the contributor against a fresh registry and returns both. */
const setup = (
  tally = new CacheConnectionTally()
): { tally: CacheConnectionTally; registry: Registry } => {
  const registry = new Registry()
  new CacheConnectionMetrics(tally).registerMetrics(registry)
  return { tally, registry }
}

describe('CacheConnectionMetrics', () => {
  // The names are a public contract: dashboards and alerts are written against them.
  it('publishes the documented metric names', () => {
    expect(CACHE_EVENTS_METRIC).toBe('bymax_cache_connection_events_total')
    expect(CACHE_READY_METRIC).toBe('bymax_cache_connection_ready')
  })

  // The contract nest-core discovers contributors by: a marked, injectable class.
  it('is marked as a metrics contributor', () => {
    expect(Reflect.getMetadata(BYMAX_METRICS_CONTRIBUTOR_METADATA, CacheConnectionMetrics)).toBe(
      true
    )
  })

  // The contributor resolves its tally through the token, with no reliance on emitted metadata.
  it('resolves its tally through the injection token', async () => {
    const tally = new CacheConnectionTally()
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: CACHE_CONNECTION_TALLY, useValue: tally }, CacheConnectionMetrics]
    }).compile()

    expect(moduleRef.get(CacheConnectionMetrics)).toBeInstanceOf(CacheConnectionMetrics)
  })

  // A scrape serves the counter per role and event and the gauge per role.
  it('serves the counter and the gauge on a scrape', async () => {
    const { tally, registry } = setup()
    tally.record('ready', { role: 'main' })
    tally.record('close', { role: 'subscriber' })

    const text = await registry.metrics()

    expect(text).toContain(`${CACHE_EVENTS_METRIC}{role="main",event="ready"} 1`)
    expect(text).toContain(`${CACHE_EVENTS_METRIC}{role="subscriber",event="close"} 1`)
    expect(text).toContain(`${CACHE_READY_METRIC}{role="main"} 1`)
    expect(text).toContain(`${CACHE_READY_METRIC}{role="subscriber"} 0`)
  })

  // Events recorded before the registry existed are published: the startup window is where a
  // reconnect loop first shows.
  it('publishes events recorded before registration', async () => {
    const tally = new CacheConnectionTally()
    tally.record('connect', { role: 'main' })
    tally.record('ready', { role: 'main' })
    const { registry } = setup(tally)

    expect(await registry.metrics()).toContain(
      `${CACHE_EVENTS_METRIC}{role="main",event="ready"} 1`
    )
  })

  // A scrape reads the tally; it must not add the tally to itself, or the counter would grow
  // because Prometheus looked at it.
  it('does not grow when scraped twice', async () => {
    const { tally, registry } = setup()
    tally.record('ready', { role: 'main' })

    await registry.metrics()
    const text = await registry.metrics()

    expect(text).toContain(`${CACHE_EVENTS_METRIC}{role="main",event="ready"} 1`)
  })

  // The tally keeps counting after registration and a later scrape sees it.
  it('reflects events recorded after registration', async () => {
    const { tally, registry } = setup()
    tally.record('ready', { role: 'main' })
    await registry.metrics()

    tally.record('ready', { role: 'main' })
    tally.record('close', { role: 'main' })
    const text = await registry.metrics()

    expect(text).toContain(`${CACHE_EVENTS_METRIC}{role="main",event="ready"} 2`)
    expect(text).toContain(`${CACHE_READY_METRIC}{role="main"} 0`)
  })

  // Security: a label comes from a closed set. A driver error message can carry a host or a
  // credential, and a role can be anything a payload says; neither may appear in the scrape.
  it('never serves a payload error message or an arbitrary role', async () => {
    const { tally, registry } = setup()
    tally.record('error', {
      role: 'main',
      error: 'connect ECONNREFUSED redis://:s3cret@10.0.0.9:6379'
    })
    tally.record('error', { role: 'redis://:s3cret@10.0.0.9', error: 'x' })

    const text = await registry.metrics()

    expect(text).not.toContain('s3cret')
    expect(text).not.toContain('ECONNREFUSED')
    expect(text).not.toContain('10.0.0.9')
    expect(text).toContain(`${CACHE_EVENTS_METRIC}{role="unknown",event="error"} 1`)
  })
})
