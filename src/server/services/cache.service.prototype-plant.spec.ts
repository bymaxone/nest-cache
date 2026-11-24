/**
 * The refusal of a command while `Object.prototype` holds a key planted after the client connected.
 *
 * Layer: server. ioredis keeps its command flag tables in plain objects, so a key planted on
 * `Object.prototype` and named like a command (`get`) reads as a flag of every call of that name, and the
 * reply handler then throws from the socket event, which is an uncaught exception. A command the library
 * sends while such a key is present must therefore be refused before it reaches the driver, with the count
 * of the keys and never a key or a value.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { guardClient } from '../utils/guard-client'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

/** The reason the guard gives, and the one thing it reports about what is planted. */
const REFUSAL = {
  reason: 'Object.prototype holds keys the driver would read as its own',
  count: 1
}

/** Plants `name` on `Object.prototype` for the length of `run`. */
async function planted<T>(name: string, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(Object.prototype, name, {
    value: 'PLANTED-VALUE',
    configurable: true,
    writable: true,
    enumerable: false
  })
  try {
    return await run()
  } finally {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

/** What `call` rejected or threw with, failing the test when it returned a value. */
async function refusalOf(call: () => unknown): Promise<CacheException> {
  try {
    await call()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('expected the call to be refused')
}

describe('a command with a key planted on Object.prototype after the client connected', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
    await cache.set('p', '1', { a: 1 })
  })

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  // Scenario: the QA reproduction. A key named like a command is planted after connect, then the
  // command is issued. The call must not reach ioredis, whose reply handler would throw.
  // Rule: the call is refused with the count of the keys, and nothing of the key or its value.
  it.each(['get', 'set', 'ttl'])('refuses a cache call after %s is planted', async (name) => {
    const calls: Record<string, () => Promise<unknown>> = {
      get: () => cache.get('p', '1'),
      set: () => cache.set('p', '2', { b: 1 }, 30),
      ttl: () => cache.ttl('p', '1')
    }

    const error = await planted(name, () => refusalOf(calls[name] as () => Promise<unknown>))

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual(REFUSAL)
    expect(JSON.stringify(error)).not.toContain('PLANTED-VALUE')
  })

  // Scenario: the refused command must not reach the client at all.
  // Rule: the guard runs before the client's method, so nothing was sent.
  it('does not call the client when it refuses', async () => {
    const spy = jest.spyOn(connection.getClient(), 'get')

    await planted('aNameNoListHolds', () => refusalOf(() => cache.get('p', '1')))

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  // Scenario: the plant is removed again.
  // Rule: the refusal is per call, not a latch: the next call succeeds.
  it('serves the next call once the key is gone', async () => {
    await planted('aNameNoListHolds', () => refusalOf(() => cache.get('p', '1')))

    await expect(cache.get('p', '1')).resolves.toEqual({ a: 1 })
  })
})

describe('guardClient with a key planted on Object.prototype', () => {
  /** A client that records what reached it and answers like a connected one. */
  const fakeClient = (): Record<string, jest.Mock> => ({
    get: jest.fn(async () => 'v'),
    quit: jest.fn(async () => 'OK'),
    disconnect: jest.fn(() => undefined),
    on: jest.fn(() => undefined),
    multi: jest.fn(() => ({}))
  })

  // Scenario: teardown while the prototype is polluted.
  // Rule: closing the connection and registering a listener are not commands, so they still run;
  // refusing them would leave a connection open or a subscriber without its handler.
  it.each(['quit', 'disconnect', 'on'])('still runs %s', async (method) => {
    const client = fakeClient()
    const guarded = guardClient(client) as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >

    await planted('aNameNoListHolds', async () => guarded[method]?.('x'))

    expect(client[method]).toHaveBeenCalledTimes(1)
  })

  // Scenario: a transaction or a pipeline is opened and executed while the prototype is polluted.
  // Rule: opening one is a command entry too: it is refused before the client builds it.
  it('refuses to open a transaction', async () => {
    const client = fakeClient()
    const guarded = guardClient(client) as unknown as { multi: () => unknown }

    const error = await planted('aNameNoListHolds', () => refusalOf(() => guarded.multi()))

    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(client.multi).not.toHaveBeenCalled()
  })
})
