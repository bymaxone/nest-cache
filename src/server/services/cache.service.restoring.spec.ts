/**
 * A host call that plants a self-restoring `constructor` and `then` on `Promise.prototype` and returns its
 * promise does not decide what a public method resolves with.
 *
 * Layer: server. The checks the library makes before a call and after an await both see a clean prototype;
 * the accessors answer the first `await` that reads them, so every promise the library awaits carries its
 * own `constructor` before that await.
 */
import { plantSelfRestoring, realThen, restoreBuiltins } from '../../test-helpers/forge-promise'
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { pinned } from '../utils/settle'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

/** What the promise ended with, a rejection included; pinned, so this test's own await reads nothing planted. */
async function settled(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await pinned(promise)
  } catch (error) {
    return error
  }
}

describe('self-restoring plant by a host call', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    restoreBuiltins()
    jest.restoreAllMocks()
    await connection.onApplicationShutdown()
  })

  it('does not report healthy when PING rejects', async () => {
    jest.spyOn(connection.getClient(), 'ping').mockImplementation((() => {
      plantSelfRestoring(true)
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('ECONNRESET')), 5))
    }) as never)

    const pending = cache.isHealthy()

    // Refused or false, never the `true` the planted `then` answers with.
    expect(await pinned(settled(pending))).not.toBe(true)
    expect(realThen).toBe(Promise.prototype.then)
  })

  // Scenario: the client command plants the accessors, then returns a promise that rejects.
  // Rule: the method never resolves with what the planted `then` answers.
  it.each([
    ['get', 'get', 'FORGED', (c: CacheService) => c.get('p', 'i')],
    ['setNx', 'set', 'OK', (c: CacheService) => c.setNx('p', 'i', 1)],
    ['del', 'del', 7, (c: CacheService) => c.del('p', 'i')],
    ['exists', 'exists', 1, (c: CacheService) => c.exists('p', 'i')],
    ['incr', 'incr', 99, (c: CacheService) => c.incr('p', 'i')],
    ['ping', 'ping', 'PONG', (c: CacheService) => c.ping()],
    ['hget', 'hget', 'FORGED', (c: CacheService) => c.hget('p', 'i', 'f')],
    ['hset', 'hset', 5, (c: CacheService) => c.hset('p', 'i', 'f', 1)],
    ['sadd', 'sadd', 5, (c: CacheService) => c.sadd('p', 'i', 'm')],
    ['sismember', 'sismember', 1, (c: CacheService) => c.sismember('p', 'i', 'm')]
  ])('does not let %s resolve with a forged answer', async (_name, command, forged, call) => {
    jest.spyOn(connection.getClient(), command as 'get').mockImplementation((() => {
      plantSelfRestoring(forged)
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('ECONNRESET')), 5))
    }) as never)

    const outcome = await pinned(settled(call(cache)))

    expect(outcome).not.toBe(forged)
    expect(outcome).toBeInstanceOf(Error)
    expect(realThen).toBe(Promise.prototype.then)
  })

  // Scenario: the client command returns a native promise that carries its own `constructor` and `then`.
  // Rule: the own `then` is never called, so the method does not resolve with what it answers.
  it.each([
    ['get', 'get', 'FORGED', (c: CacheService) => c.get('p', 'i')],
    ['setNx', 'set', 'OK', (c: CacheService) => c.setNx('p', 'i', 1)],
    ['ping', 'ping', 'PONG', (c: CacheService) => c.ping()]
  ])(
    'does not let %s call an own then on the host promise',
    async (_name, command, forged, call) => {
      jest.spyOn(connection.getClient(), command as 'get').mockImplementation((() => {
        const host = new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('ECONNRESET')), 5)
        )
        Object.defineProperty(host, 'constructor', { value: Object, configurable: true })
        Object.defineProperty(host, 'then', {
          value: (resolve: (answer: unknown) => void) => resolve(forged),
          configurable: true
        })
        return host
      }) as never)

      const outcome = await pinned(settled(call(cache)))

      expect(outcome).not.toBe(forged)
      expect(outcome).toBeInstanceOf(Error)
    }
  )
})
