/**
 * Unit tests for {@link copyClusterOptions}.
 *
 * Layer: server. The copy reads every documented key by property access, drops the unset ones and
 * returns a plain object, so a class instance whose values sit behind getters loses nothing.
 */
import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS, copyClusterOptions } from './copy-cluster-options'

import type { ClusterOptions } from 'ioredis'

describe('copyClusterOptions', () => {
  // Scenario: no options at all.
  // Rule: the copy has an empty redisOptions and nothing else.
  it('returns an empty copy for undefined options', () => {
    expect(copyClusterOptions(undefined)).toEqual({ redisOptions: {} })
  })

  // Scenario: every documented key of both groups is set.
  // Rule: every one of them is carried over, none is lost.
  it('carries every documented key of both groups', () => {
    const redisOptions: Record<string, unknown> = {}
    for (const key of Object.keys(REDIS_OPTION_KEYS)) {
      redisOptions[key] = `redis-${key}`
    }
    const options: Record<string, unknown> = {}
    for (const key of Object.keys(CLUSTER_OPTION_KEYS)) {
      options[key] = `cluster-${key}`
    }
    options['redisOptions'] = redisOptions

    const copy = copyClusterOptions(options as ClusterOptions) as Record<string, unknown>

    for (const key of Object.keys(CLUSTER_OPTION_KEYS).filter((k) => k !== 'redisOptions')) {
      expect(copy[key]).toBe(`cluster-${key}`)
    }
    expect(copy['redisOptions']).toEqual(redisOptions)
  })

  // Scenario: keys that are undefined or null, and a key the lists do not name.
  // Rule: unset keys and unknown keys are left out of the copy.
  it('drops unset keys and keys that are not documented', () => {
    const copy = copyClusterOptions({
      scaleReads: undefined,
      slotsRefreshTimeout: null,
      maxRedirections: 0,
      notAnOption: 'x',
      redisOptions: { commandTimeout: undefined, connectTimeout: null, db: 0, nope: 1 }
    } as unknown as ClusterOptions)

    expect(copy).toEqual({ maxRedirections: 0, redisOptions: { db: 0 } })
  })

  // Scenario: the groups are class instances whose values sit behind prototype getters.
  // Rule: each value is read through its getter, and the source is not mutated.
  it('reads class-instance groups through their getters', () => {
    class Redis {
      get password(): string {
        return 'secret'
      }
    }
    class Cluster {
      get scaleReads(): string {
        return 'slave'
      }
      get redisOptions(): Redis {
        return new Redis()
      }
    }
    const source = new Cluster()

    const copy = copyClusterOptions(source as unknown as ClusterOptions)

    expect(copy).toEqual({ scaleReads: 'slave', redisOptions: { password: 'secret' } })
    expect(Object.keys(source)).toEqual([])
  })
})
