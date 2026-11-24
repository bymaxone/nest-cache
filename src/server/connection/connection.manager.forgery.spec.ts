/**
 * The readiness wait of {@link ConnectionManager} refuses when the promise constructor is swapped.
 *
 * Layer: server. A host that swaps `Promise.prototype.constructor` for the moment of the readiness
 * `await` and puts it back at once (H1) could make a client that never became ready read as ready.
 */
import { EventEmitter } from 'node:events'

import {
  forgedThen,
  RealPromise,
  realThen,
  restoreBuiltins,
  underForgery
} from '../../test-helpers/forge-promise'
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from './connection.manager'

// Hoisted registry the mock factory fills; `var` keeps it out of the temporal dead zone under hoisting.
var redisInstances: Array<EventEmitter & { disconnect: jest.Mock }>

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    connector = { connect: jest.fn() }
    connect = jest.fn().mockResolvedValue(undefined)
    constructor() {
      super()
      redisInstances.push(this)
    }
  }
  class FakeCluster extends EventEmitter {}
  return require('../../test-helpers/ioredis-module').ioredisModule(FakeRedis, FakeCluster)
})

beforeEach(() => {
  redisInstances = []
})

describe('ConnectionManager readiness under a swapped promise constructor', () => {
  // Scenario: the constructor is swapped and a forged `then` installed while onModuleInit starts.
  // Rule: the wait refuses, the init rejects and the client that never became ready is disconnected.
  it('rejects the init when the constructor is swapped for the moment of the readiness await (H1)', async () => {
    const manager = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
    let init: Promise<void> = Promise.resolve()
    try {
      Promise.prototype.then = forgedThen as typeof Promise.prototype.then
      Promise.prototype.constructor = function Fake() {
        return undefined
      } as unknown as PromiseConstructor
      init = manager.onModuleInit()
    } finally {
      restoreBuiltins()
    }
    realThen.call(init, undefined, () => undefined)

    const outcome = await underForgery(
      () => undefined,
      () => init
    )

    expect(outcome.settled).toBe('rejected')
    expect(redisInstances[0]?.disconnect).toHaveBeenCalled()
  })

  // The readiness promise had no handler when the check refused: the `end` the release causes rejected it.
  it('leaves no rejection unhandled when the constructor throws during the readiness wait', (finish) => {
    const manager = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
    const realConstructor = Promise.prototype.constructor
    let count = 0
    const listener = (): void => {
      count += 1
    }
    process.on('unhandledRejection', listener)
    Object.defineProperty(Promise.prototype, 'constructor', {
      get() {
        throw new Error('hostile')
      },
      configurable: true
    })
    try {
      const init = manager.onModuleInit()
      Object.defineProperty(init, 'constructor', { value: RealPromise })
      realThen.call(init, undefined, () => undefined)
    } catch {
      // the init refusing is part of the outcome
    }
    setTimeout(() => {
      Object.defineProperty(Promise.prototype, 'constructor', {
        value: realConstructor,
        writable: true,
        configurable: true
      })
      restoreBuiltins()
      redisInstances[0]?.emit('end')
      setImmediate(() => {
        process.off('unhandledRejection', listener)
        try {
          expect(count).toBe(0)
          finish()
        } catch (error) {
          finish(error)
        }
      })
    }, 30)
  })
})
