/**
 * Unit tests for the operation outcomes {@link CacheService} reports to `events.onOperation`.
 *
 * Layer: server. Every one of the 31 commands reports its own name once with an outcome from the
 * closed set; a read that finds something says `hit`, one that finds nothing `miss`, a failure `error`.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { CacheOperationName } from '../../shared/types/cache-event.types'
import type { ScriptManagerService } from './script-manager.service'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

describe('CacheService operation outcomes', () => {
  let connection: ConnectionManager
  let cache: CacheService
  let reported: Array<[string, string]>

  beforeEach(async () => {
    reported = []
    const options = applyDefaults({
      connection: { host: 'h' },
      namespace: 'ops',
      events: { onOperation: (operation, outcome) => void reported.push([operation, outcome]) }
    })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    await connection.getClient().flushall()
    cache = new CacheService(options, connection, new KeyBuilder(options), undefined, {
      eval: jest.fn().mockResolvedValue(1)
    } as Pick<ScriptManagerService, 'eval'> as ScriptManagerService)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await connection.onApplicationShutdown()
  })

  /** Every command with a call that uses it, and what it reports against an empty store. */
  const ON_EMPTY_STORE: ReadonlyArray<
    readonly [CacheOperationName, (c: CacheService) => Promise<unknown>, 'ok' | 'miss']
  > = [
    ['get', (c) => c.get('u', '1'), 'miss'],
    ['getRaw', (c) => c.getRaw('u', '1'), 'miss'],
    ['set', (c) => c.set('u', '1', 1), 'ok'],
    ['setRaw', (c) => c.setRaw('u', '1', 'v'), 'ok'],
    ['setNx', (c) => c.setNx('u', '1', 1), 'ok'],
    ['del', (c) => c.del('u', '1'), 'ok'],
    ['delMany', (c) => c.delMany('u', ['1', '2']), 'ok'],
    ['exists', (c) => c.exists('u', '1'), 'miss'],
    ['incr', (c) => c.incr('u', '1'), 'ok'],
    ['decr', (c) => c.decr('u', '1'), 'ok'],
    ['expire', (c) => c.expire('u', '1', 60), 'ok'],
    ['ttl', (c) => c.ttl('u', '1'), 'ok'],
    ['persist', (c) => c.persist('u', '1'), 'ok'],
    ['mget', (c) => c.mget('u', ['1', '2']), 'miss'],
    ['mset', (c) => c.mset('u', [['1', 1]]), 'ok'],
    ['hget', (c) => c.hget('u', '1', 'f'), 'miss'],
    ['hset', (c) => c.hset('u', '1', 'f', 1), 'ok'],
    ['hgetall', (c) => c.hgetall('u', '1'), 'miss'],
    ['hdel', (c) => c.hdel('u', '1', 'f'), 'ok'],
    ['sadd', (c) => c.sadd('u', '1', 'm'), 'ok'],
    ['srem', (c) => c.srem('u', '1', 'm'), 'ok'],
    ['smembers', (c) => c.smembers('u', '1'), 'miss'],
    ['sismember', (c) => c.sismember('u', '1', 'm'), 'miss'],
    ['scard', (c) => c.scard('u', '1'), 'ok'],
    ['keys', (c) => c.keys('u', '*'), 'ok'],
    ['flushNamespace', (c) => c.flushNamespace(), 'ok'],
    ['eval', (c) => c.eval('s', ['k'], []), 'ok'],
    ['isHealthy', (c) => c.isHealthy(), 'ok'],
    ['ping', (c) => c.ping(), 'ok'],
    ['info', (c) => c.info(), 'ok']
  ]

  // Scenario: each command runs once against an empty store.
  // Rule: exactly one report, carrying that command's own name and the expected outcome.
  it.each(ON_EMPTY_STORE)('%s reports itself once', async (operation, call, outcome) => {
    await call(cache)

    expect(reported).toEqual([[operation, outcome]])
  })

  // Scenario: the same reads find what was written.
  // Rule: a read that finds something says `hit`.
  it('reports hit for every read that finds something', async () => {
    await cache.set('u', '1', 1)
    await cache.hset('u', 'h', 'f', 1)
    await cache.sadd('u', 's', 'm')
    reported.length = 0

    await cache.get('u', '1')
    await cache.getRaw('u', '1')
    await cache.mget('u', ['1', 'absent'])
    await cache.hget('u', 'h', 'f')
    await cache.hgetall('u', 'h')
    await cache.smembers('u', 's')
    await cache.exists('u', '1')
    await cache.sismember('u', 's', 'm')

    expect(reported).toEqual([
      ['get', 'hit'],
      ['getRaw', 'hit'],
      ['mget', 'hit'],
      ['hget', 'hit'],
      ['hgetall', 'hit'],
      ['smembers', 'hit'],
      ['exists', 'hit'],
      ['sismember', 'hit']
    ])
  })

  // Scenario: the stored payload is the JSON text `null`, which decodes to `null`.
  // Rule: Redis returned a payload, so the read is a `hit`; only an absent key or field is a `miss`.
  it('reports hit for a stored JSON null, and miss only for an absent key', async () => {
    await cache.setRaw('u', 'n', 'null')
    await cache.hset('u', 'h', 'f', null)
    reported.length = 0

    await expect(cache.get('u', 'n')).resolves.toBeNull()
    await expect(cache.hget('u', 'h', 'f')).resolves.toBeNull()
    await expect(cache.mget('u', ['n', 'absent'])).resolves.toEqual([null, null])
    await cache.get('u', 'absent')
    await cache.hget('u', 'h', 'absent')
    await cache.mget('u', ['absent'])

    expect(reported).toEqual([
      ['get', 'hit'],
      ['hget', 'hit'],
      ['mget', 'hit'],
      ['get', 'miss'],
      ['hget', 'miss'],
      ['mget', 'miss']
    ])
  })

  // Scenario: a call whose input is empty sends no command.
  // Rule: nothing is reported, so a no-op does not count as a hit, a miss or an ok.
  it.each([
    ['delMany', (c: CacheService) => c.delMany('u', [])],
    ['mget', (c: CacheService) => c.mget('u', [])],
    ['mset', (c: CacheService) => c.mset('u', [])],
    ['hdel', (c: CacheService) => c.hdel('u', '1')],
    ['sadd', (c: CacheService) => c.sadd('u', '1')],
    ['srem', (c: CacheService) => c.srem('u', '1')]
  ] as const)('%s with nothing to send reports nothing', async (_name, call) => {
    await call(cache)

    expect(reported).toEqual([])
  })

  // Scenario: a scan runs to its end, and one runs against a client that cannot scan.
  it('reports a finished scan as ok and a refused one as error', async () => {
    await cache.set('u', '1', 1)
    reported.length = 0
    for await (const key of cache.scan('u', '*')) void key
    expect(reported).toEqual([['scan', 'ok']])

    reported.length = 0
    Object.defineProperty(connection.getClient(), 'scanStream', { value: undefined })
    await expect(
      (async (): Promise<void> => {
        for await (const key of cache.scan('u', '*')) void key
      })()
    ).rejects.toBeDefined()
    expect(reported).toEqual([['scan', 'error']])
  })

  // Scenario: the probe cannot reach the server.
  // Rule: `isHealthy` swallows the failure by design, so it reports `error` through its classifier.
  it('reports isHealthy as error when the server does not answer', async () => {
    jest.spyOn(connection.getClient(), 'ping').mockRejectedValue(new Error('down'))

    await expect(cache.isHealthy()).resolves.toBe(false)

    expect(reported).toEqual([['isHealthy', 'error']])
  })

  // Scenario: every command fails.
  // Rule: each reports `error` once and the caller still gets the failure.
  it.each(ON_EMPTY_STORE.filter(([name]) => name !== 'isHealthy' && name !== 'eval'))(
    '%s reports error when the client rejects',
    async (operation, call) => {
      const failure = new Error('down')
      // A client with no `scanStream`, like a cluster, whose every command rejects: the SCAN helpers
      // refuse it on their own, and nothing is left holding a rejection nobody awaits.
      const rejecting = new Proxy(
        {},
        {
          get: (_target, name) =>
            name === 'scanStream' ? undefined : async (): Promise<never> => Promise.reject(failure)
        }
      )
      jest.spyOn(connection, 'getClient').mockReturnValue(rejecting as never)

      await expect(call(cache)).rejects.toBeDefined()

      expect(reported).toEqual([[operation, 'error']])
    }
  )

  it('reports eval as error when no script registry is wired', async () => {
    const options = applyDefaults({
      connection: { host: 'h' },
      namespace: 'ops',
      events: { onOperation: (operation, outcome) => void reported.push([operation, outcome]) }
    })
    const bare = new CacheService(options, connection, new KeyBuilder(options))

    await expect(bare.eval('s', ['k'], [])).rejects.toBeDefined()

    expect(reported).toEqual([['eval', 'error']])
  })
})
