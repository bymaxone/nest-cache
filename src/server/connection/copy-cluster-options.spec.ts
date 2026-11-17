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

  // Scenario: keys that are undefined or null among the documented ones.
  // Rule: the unset documented keys are left out of the copy.
  it('drops the unset documented keys', () => {
    const copy = copyClusterOptions({
      scaleReads: undefined,
      slotsRefreshTimeout: null,
      maxRedirections: 0,
      redisOptions: { commandTimeout: undefined, connectTimeout: null, db: 0 }
    } as unknown as ClusterOptions)

    expect(copy).toEqual({ maxRedirections: 0, redisOptions: { db: 0 } })
  })

  // Scenario: an own key the typed lists do not name: an option a newer ioredis added, or one the
  // declarations lag behind.
  // Rule: it is copied as given, so the driver still receives it; only the documented keys are read
  // through the lists.
  it('forwards an own key that the lists do not name, as given', () => {
    const copy = copyClusterOptions({
      maxRedirections: 3,
      futureClusterOption: 'a',
      redisOptions: { db: 1, futureNodeOption: { nested: true }, anotherOne: undefined }
    } as unknown as ClusterOptions) as Record<string, unknown>

    expect(copy['futureClusterOption']).toBe('a')
    expect(copy['maxRedirections']).toBe(3)
    expect(copy['redisOptions']).toEqual({
      db: 1,
      futureNodeOption: { nested: true },
      anotherOne: undefined
    })
  })

  // Scenario: a host config parsed from JSON carries an own `__proto__` key.
  // Rule: it lands as a plain own key and the copy keeps its prototype: an assignment would have run
  // the inherited setter and made every later read see the values of that object.
  it('copies an own __proto__ key as a plain key, in both groups', () => {
    const parsed = JSON.parse(
      '{"scaleReads":"slave","__proto__":{"inheritedOption":1},"redisOptions":{"db":2,"__proto__":{"inheritedNode":1}}}'
    ) as ClusterOptions

    const copy = copyClusterOptions(parsed) as Record<string, unknown>
    const redisOptions = copy['redisOptions'] as Record<string, unknown>

    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(redisOptions)).toBe(Object.prototype)
    expect(Object.keys(copy)).toContain('__proto__')
    expect(Object.keys(redisOptions)).toContain('__proto__')
    expect(copy['inheritedOption']).toBeUndefined()
    expect(redisOptions['inheritedNode']).toBeUndefined()
    expect(copy['scaleReads']).toBe('slave')
    expect(redisOptions['db']).toBe(2)
  })

  // Scenario: a whole group is null.
  // Rule: it counts as absent, like undefined: the copy has an empty redisOptions and nothing else.
  it.each([
    ['cluster.options', null],
    ['redisOptions', { redisOptions: null }]
  ])('treats a null %s as absent', (_name, options) => {
    expect(copyClusterOptions(options as unknown as ClusterOptions)).toEqual({ redisOptions: {} })
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
