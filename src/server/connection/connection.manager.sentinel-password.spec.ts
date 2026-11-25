/**
 * Unit tests for the password {@link ConnectionManager} hands to ioredis in sentinel mode, against a fake
 * ioredis.
 *
 * Layer: server. The data nodes take their password from `connection.password` unless the sentinel block
 * names its own, which then wins: a block without a password must not erase the one of the connection.
 */
import { EventEmitter } from 'node:events'

import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from './connection.manager'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

interface Captured extends EventEmitter {
  options: Record<string, unknown>
}

// `var`: initialised before the hoisted import runs the mock factory (see connection.manager.spec).
var redisInstances: Captured[]

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    connector = { connect: jest.fn() }
    connect = jest.fn().mockResolvedValue(undefined)
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      redisInstances.push(this as unknown as Captured)
    }
  }
  class FakeCluster extends EventEmitter {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
  }
  return require('../../test-helpers/ioredis-module').ioredisModule(FakeRedis, FakeCluster)
})

beforeEach(() => {
  redisInstances = []
})

/** The options the driver received for a sentinel client built from `options`. */
function driverOptions(options: Partial<BymaxCacheModuleOptions>): Record<string, unknown> {
  const manager = new ConnectionManager(applyDefaults({ mode: 'sentinel', ...options }))
  manager.getClient()
  return redisInstances[0]?.options ?? {}
}

describe('the password of the data nodes in sentinel mode', () => {
  // Scenario: the sentinel block names no password, and the connection has one.
  // Rule: the driver receives the password of the connection.
  it('keeps connection.password when the sentinel block has no password', () => {
    const opts = driverOptions({
      connection: { host: 'h', password: 'node-secret' },
      sentinel: { name: 'mymaster', sentinels: [{ host: 's', port: 26379 }] }
    })

    expect(opts['password']).toBe('node-secret')
    expect(opts['sentinelPassword']).toBeUndefined()
  })

  // Scenario: both name a password. Rule: the driver receives the one of the sentinel block.
  it('prefers the sentinel block password over connection.password', () => {
    const opts = driverOptions({
      connection: { host: 'h', password: 'node-secret' },
      sentinel: {
        name: 'mymaster',
        sentinels: [{ host: 's', port: 26379 }],
        password: 'block-secret'
      }
    })

    expect(opts['password']).toBe('block-secret')
  })
})
