/**
 * A host awaiting a public method of {@link CacheService} is not answered by a replaced global.
 *
 * Layer: server. The host's `await cache.get()` reads the constructor of the promise it is handed, so a
 * live `setTimeout` or `Date.now` that swaps `Promise.prototype.constructor` and plants a `then` must not
 * run between the method's entry and its first suspension, and the promise `guardClient` returns carries
 * its own constructor.
 */
import {
  forgedThen,
  realConstructor,
  restoreBuiltins,
  underForgery
} from '../../test-helpers/forge-promise'
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { guardClient } from '../utils/guard-client'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

/** What a hooked global does when called: swaps the constructor, plants a `then`, restores at once. */
function plant(): void {
  Promise.prototype.then = forgedThen as typeof Promise.prototype.then
  Promise.prototype.constructor = function Fake() {
    return undefined
  } as unknown as PromiseConstructor
}

describe('CacheService public methods under hooked globals', () => {
  const realSetTimeout = globalThis.setTimeout
  const realNow = Date.now
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
    await cache.set('u', '1', 'real')
  })

  afterEach(async () => {
    globalThis.setTimeout = realSetTimeout
    Date.now = realNow
    restoreBuiltins()
    await connection.onApplicationShutdown()
  })

  // Scenario: setTimeout and Date.now plant the forgery whenever the library calls them.
  // Rule: get and set answer with what Redis holds, never with what the planted `then` supplies.
  it('answers get and set with the real outcome when setTimeout and Date.now plant a then', async () => {
    const hooked = (real: (...args: never[]) => unknown) =>
      ((...args: never[]) => {
        plant()
        return real(...args)
      }) as never

    const read = await underForgery(
      () => {
        globalThis.setTimeout = hooked(realSetTimeout as never) as typeof setTimeout
        Date.now = hooked(realNow as never) as typeof Date.now
      },
      () => cache.get<string>('u', '1')
    )
    restoreBuiltins()
    const wrote = await underForgery(
      () => {
        globalThis.setTimeout = hooked(realSetTimeout as never) as typeof setTimeout
        Date.now = hooked(realNow as never) as typeof Date.now
      },
      () => cache.set('u', '2', 'x')
    )

    expect(read).toEqual({ settled: 'resolved', value: 'real' })
    expect(wrote).toEqual({ settled: 'resolved', value: undefined })
    expect(await cache.get('u', '2')).toBe('x')
  })

  // The promise a guarded command returns is read by the caller's await: it holds its own constructor.
  it('hands the caller a promise with its own constructor', async () => {
    const guarded = guardClient({ ping: async () => 'PONG' })

    const returned = guarded.ping()

    expect(Object.getOwnPropertyDescriptor(returned, 'constructor')?.value).toBe(realConstructor)
    await returned
  })
})
