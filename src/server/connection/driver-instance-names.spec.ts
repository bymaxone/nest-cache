/**
 * The names ioredis reads off objects it creates itself, and the refusal to build a client while one of
 * them is planted on `Object.prototype`.
 *
 * Layer: server. A client, a cluster, a connector, a pipeline, a command and a subscriber read some names
 * (`this.manuallyClosing`, `this.stream`, `this.length`) that they do not hold when they are built, so a
 * planted key is what the read finds. The library cannot give those objects an own key, so the manager
 * refuses to start while any of the names is planted. The list is derived here from the source of the
 * pinned ioredis, so a version that reads a new name fails until it is listed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Redis, Cluster } from 'ioredis'

import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import { DRIVER_INSTANCE_NAMES } from './driver-option-names'

const build = (): ConnectionManager =>
  new ConnectionManager(
    resolveOptions({
      connection: { host: 'h', lazyConnect: true }
    } as unknown as BymaxCacheModuleOptions)
  )

describe('the manager with a name of the driver planted on Object.prototype', () => {
  // Scenario: another part of the process plants a name ioredis reads off its own objects.
  // Rule: the manager refuses to be built, naming the planted name, and echoing no value.
  it.each(DRIVER_INSTANCE_NAMES)('refuses to be built when %s is planted', (name) => {
    Object.defineProperty(Object.prototype, name, {
      value: 'PLANTED-VALUE',
      configurable: true,
      writable: true
    })
    try {
      let thrown: { code?: string; details?: Record<string, unknown> } | undefined
      try {
        build()
      } catch (error) {
        thrown = error as typeof thrown
      }

      expect(thrown?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(thrown?.details).toEqual({
        reason: 'Object.prototype holds a name the driver reads from its own objects',
        name
      })
      expect(JSON.stringify(thrown)).not.toContain('PLANTED-VALUE')
    } finally {
      Reflect.deleteProperty(Object.prototype, name)
    }
  })

  // Scenario: the name is planted after the manager is built and before it builds a client.
  // Rule: the client is not built: the check runs when each client is created.
  it('refuses to build a client when a name is planted after the manager was built', () => {
    const manager = build()
    Object.defineProperty(Object.prototype, 'manuallyClosing', {
      value: true,
      configurable: true,
      writable: true
    })
    try {
      expect(() => manager.getClient()).toThrow(
        expect.objectContaining({
          code: CACHE_ERROR_CODES.INVALID_OPTIONS,
          details: expect.objectContaining({ name: 'manuallyClosing' })
        }) as Error
      )
    } finally {
      Reflect.deleteProperty(Object.prototype, 'manuallyClosing')
    }
  })

  it('is built when nothing is planted', () => {
    expect(build()).toBeInstanceOf(ConnectionManager)
  })
})

/**
 * The names read as `this.NAME` (not called) in one file of the built ioredis, and as `ALIAS.NAME` for
 * each alias the file makes of `this` (`const _this = this`, which the compiled code uses in callbacks).
 */
function thisReads(file: string): string[] {
  const root = dirname(require.resolve('ioredis/package.json'))
  const source = readFileSync(join(root, 'built', file), 'utf8')
  const aliases = [
    'this',
    ...[...source.matchAll(/\bconst\s+(\w+)\s*=\s*this\s*;/g)].map((m) => m[1] as string)
  ]
  const reads = new RegExp(`\\b(?:${aliases.join('|')})\\.([A-Za-z_]\\w*)\\b(?!\\s*\\()`, 'g')
  return [...new Set([...source.matchAll(reads)].map((m) => m[1] as string))]
}

describe('the driver instance names', () => {
  /** A deep import of a class ioredis creates itself; the pinned version is the contract. */
  const deep = (path: string): { default: new (...args: unknown[]) => object } =>
    require(join(dirname(require.resolve('ioredis/package.json')), 'built', path)) as {
      default: new (...args: unknown[]) => object
    }
  const redis = new Redis({ host: '127.0.0.1', port: 1, lazyConnect: true })
  const cluster = new Cluster([{ host: '127.0.0.1', port: 7000 }], { lazyConnect: true })
  redis.on('error', () => undefined)
  cluster.on('error', () => undefined)
  const pool = new (deep('cluster/ConnectionPool').default)({})
  const instances: Array<[string, object]> = [
    ['Redis.js', redis],
    ['cluster/index.js', cluster],
    ['Pipeline.js', redis.pipeline()],
    [
      'connectors/StandaloneConnector.js',
      new (deep('connectors/StandaloneConnector').default)({ host: 'h', port: 1 })
    ],
    [
      'connectors/SentinelConnector/index.js',
      new (deep('connectors/SentinelConnector').default)({
        sentinels: [{ host: 's', port: 1 }],
        name: 'm'
      })
    ],
    ['Command.js', new (deep('Command').default)('get', ['k'])],
    [
      'cluster/ClusterSubscriber.js',
      new (deep('cluster/ClusterSubscriber').default)(pool, {
        once: () => undefined,
        on: () => undefined,
        emit: () => undefined
      })
    ]
  ]

  afterAll(() => {
    redis.disconnect()
    cluster.disconnect()
  })

  // Scenario: the pinned ioredis reads a name off one of its own objects that the object does not hold
  // once built. Rule: the name is on the list, or this fails naming it.
  it.each(instances)('hold every name %s reads that the built object lacks', (file, instance) => {
    const missing = thisReads(file).filter(
      (name) => !(name in instance) && !DRIVER_INSTANCE_NAMES.includes(name)
    )

    expect(missing).toEqual([])
  })
})
