/**
 * The readiness wait of {@link ConnectionManager} refuses when the promise constructor is swapped.
 *
 * Layer: server. A host that swaps `Promise.prototype.constructor` for the moment of the readiness
 * `await` and puts it back at once (H1) could make a client that never became ready read as ready.
 */
import { EventEmitter } from 'node:events'

import {
  forgedThen,
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
})
