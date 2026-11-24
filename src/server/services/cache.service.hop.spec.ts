/**
 * The promise a public method hands back, and the value it hands back, are not written by a host.
 *
 * Layer: server. An async function that returns a promise reads that promise's `then`, so a `then` the host
 * replaced before the call and restores after it would decide the result; the observer of an operation runs
 * host code before the result is returned, so a `then` it plants on `Object.prototype` would be read when
 * an object is returned; a throwing `Symbol.species` is read by any `then` call on a library promise.
 */
import { CacheException } from '../errors/cache.exception'
import { realThen, restoreBuiltins } from '../../test-helpers/forge-promise'
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { IntrinsicPromise } from '../utils/settle'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { ICacheEvents } from '../interfaces/cache-events.interface'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

/** A promise that rejects after a tick, as a command that fails on the wire. */
const failsLater = (message = 'ECONNRESET'): Promise<never> =>
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), 5))

/** A `then` that answers `value` to whatever it is asked to adopt. */
function answering(value: unknown): typeof Promise.prototype.then {
  return function then(this: Promise<unknown>, onFulfilled?: unknown) {
    const answer = (): unknown =>
      typeof onFulfilled === 'function'
        ? (onFulfilled as (v: unknown) => unknown)(value)
        : undefined
    return realThen.call(this, answer, answer)
  } as typeof Promise.prototype.then
}

describe('public methods and the hops they return through', () => {
  let connection: ConnectionManager
  let cache: CacheService

  async function build(events?: ICacheEvents): Promise<void> {
    const options = applyDefaults({
      connection: { host: 'h' },
      namespace: 'test',
      ...(events === undefined ? {} : { events })
    })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  }

  afterEach(async () => {
    restoreBuiltins()
    jest.restoreAllMocks()
    await connection.onApplicationShutdown()
  })

  // A `then` in place across the call, restored right after it returns, answered `true` for a failed PING.
  it.each([false, true])(
    'reports isHealthy false when PING rejects and a then answers true (observed %s)',
    async (observed) => {
      await build(observed ? { onOperation: () => undefined } : undefined)
      jest.spyOn(connection.getClient(), 'ping').mockImplementation(() => failsLater())
      Promise.prototype.then = answering(true)

      const pending = cache.isHealthy()
      Promise.prototype.then = realThen

      expect(await pending).toBe(false)
    }
  )

  // The same `then` answered `true` for `setNx` when Redis refused the NX, which forges a held lock.
  it.each([false, true])(
    'reports setNx false when the NX is refused and a then answers true (observed %s)',
    async (observed) => {
      await build(observed ? { onOperation: () => undefined } : undefined)
      jest
        .spyOn(connection.getClient(), 'set')
        .mockImplementation(
          (() => new Promise((resolve) => setTimeout(() => resolve(null), 5))) as never
        )
      Promise.prototype.then = answering(true)

      const pending = cache.setNx('lock', 'job', 1)
      Promise.prototype.then = realThen

      expect(await pending).toBe(false)
    }
  )

  // `ping` returns through two async hops; a failed PING must reject, never read as the planted answer.
  it('rejects ping when PING fails and a then answers PONG', async () => {
    await build()
    jest.spyOn(connection.getClient(), 'ping').mockImplementation(() => failsLater())
    Promise.prototype.then = answering('PONG')

    const pending = cache.ping()
    Promise.prototype.then = realThen

    await expect(pending).rejects.toThrow('ECONNRESET')
  })

  // The observer plants a self-erasing `then` on Object.prototype; get must not return what it supplies.
  it('does not return what a then planted by onOperation supplies for a stored object', async () => {
    await build({
      onOperation: (operation) => {
        if (operation !== 'get') return
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          get() {
            Reflect.deleteProperty(Object.prototype, 'then')
            return (resolve: (value: unknown) => void) => resolve({ role: 'admin' })
          }
        })
      }
    })
    await cache.set('users', 'u1', { role: 'user' })

    // Strings, so the planted `then` is not read off the outcome itself.
    const outcome = await cache.get<{ role: string }>('users', 'u1').then(
      (value) => {
        restoreBuiltins()
        return `resolved:${JSON.stringify(value)}`
      },
      () => {
        restoreBuiltins()
        return 'rejected'
      }
    )

    expect(outcome).not.toContain('admin')
    expect(outcome).toBe('rejected')
  })

  // A `Symbol.species` that throws, planted while the command is issued, must not leave its rejection unhandled.
  it('leaves no rejection unhandled and fails with a coded error when species throws', (finish) => {
    build()
      .then(() => {
        let unhandled = 0
        const listener = (): void => {
          unhandled += 1
        }
        process.on('unhandledRejection', listener)
        const species = Object.getOwnPropertyDescriptor(IntrinsicPromise, Symbol.species)
        jest.spyOn(connection.getClient(), 'get').mockImplementation((() => {
          const failing = failsLater('Command timed out')
          Object.defineProperty(IntrinsicPromise, Symbol.species, {
            configurable: true,
            get() {
              Object.defineProperty(IntrinsicPromise, Symbol.species, species as PropertyDescriptor)
              throw new Error('species trap')
            }
          })
          return failing
        }) as never)
        const returned = cache.get('u', '1')
        // A native await of the pinned promise reads no species, so the row itself does not trip the trap.
        void (async () => {
          let failure: unknown
          try {
            await returned
          } catch (error) {
            failure = error
          }
          setTimeout(() => {
            Object.defineProperty(IntrinsicPromise, Symbol.species, species as PropertyDescriptor)
            process.off('unhandledRejection', listener)
            try {
              expect(unhandled).toBe(0)
              expect(failure).toBeInstanceOf(CacheException)
              finish()
            } catch (assertion) {
              finish(assertion)
            }
          }, 20)
        })()
      })
      .catch(finish)
  })
})
