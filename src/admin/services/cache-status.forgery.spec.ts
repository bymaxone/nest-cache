/**
 * `CacheStatusService.health` cannot be made to report a failed or late probe as up by replacing
 * `Promise.race`: the deadline's verdict never comes from a replaceable static.
 *
 * Layer: admin.
 */
import { plantSelfRestoring, restoreBuiltins } from '../../test-helpers/forge-promise'
import { applyDefaults } from '../../server/config/default-options'
import { ConnectionManager } from '../../server/connection/connection.manager'
import { CacheService } from '../../server/services/cache.service'
import { KeyBuilder } from '../../server/utils/key-builder'
import { pinned } from '../../server/utils/settle'
import { resolveAdminOptions } from '../config/resolved-admin-options'
import { CacheStatusService } from './cache-status.service'

import type { ISerializer } from '../../server/interfaces/serializer.interface'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

const realRace = Promise.race
const realThen = Promise.prototype.then

afterEach(() => {
  Promise.race = realRace
  Promise.prototype.then = realThen
})

class JsonLike implements ISerializer {
  serialize(): string {
    return ''
  }
  deserialize<T>(): T {
    return undefined as T
  }
}

describe('CacheStatusService.health under a replaced Promise.race', () => {
  // A replaced race that resolves with PONG turned a rejected ping into an up verdict.
  it('reports down when the ping rejects and Promise.race always answers PONG', async () => {
    // Handled through the real `then` first, so the forged verdict is not also an unhandled rejection.
    const rejected = Promise.reject(new Error('ECONNRESET'))
    Promise.prototype.then.call(rejected, undefined, () => undefined)
    const probe = { ping: jest.fn().mockReturnValue(rejected), info: jest.fn() }
    const service = new CacheStatusService(
      probe,
      applyDefaults({ connection: { host: 'h' } }),
      resolveAdminOptions({
        scopes: [
          {
            id: 'cache',
            label: 'Cache',
            pattern: 'app:*',
            isReadable: true,
            origin: 'the namespace'
          }
        ]
      }),
      new JsonLike()
    )
    Promise.race = (() => Promise.resolve('PONG')) as unknown as typeof Promise.race

    const health = await service.health()

    expect(health.status).toBe('down')
  })
})

describe('CacheStatusService.health with the real cache under a then replaced across the call', () => {
  // A `then` in place while health() is called and restored right after answered PONG for a failed ping.
  it('reports down when PING fails and a then answering PONG is restored after the call', async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    const connection = new ConnectionManager(options)
    await connection.onModuleInit()
    const cache = new CacheService(options, connection, new KeyBuilder(options))
    jest
      .spyOn(connection.getClient(), 'ping')
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('ECONNRESET')), 5))
      )
    const service = new CacheStatusService(
      cache,
      options,
      resolveAdminOptions({
        scopes: [
          {
            id: 'cache',
            label: 'Cache',
            pattern: 'app:*',
            isReadable: true,
            origin: 'the namespace'
          }
        ]
      }),
      new JsonLike()
    )
    Promise.prototype.then = function then(this: Promise<unknown>, onFulfilled?: unknown) {
      const answer = (): unknown =>
        typeof onFulfilled === 'function'
          ? (onFulfilled as (v: unknown) => unknown)('PONG')
          : undefined
      return realThen.call(this, answer, answer)
    } as typeof Promise.prototype.then

    const pending = service.health()
    Promise.prototype.then = realThen
    const health = await pending
    await connection.onApplicationShutdown()

    expect(health.status).toBe('down')
  })
})

describe('CacheStatusService.health when the probe plants a self-restoring then', () => {
  // The ping plants accessors that answer PONG to the first await that reads them, then returns a rejection.
  it('reports down, never the PONG the planted then answers with', async () => {
    const probe = {
      ping: jest.fn().mockImplementation(() => {
        plantSelfRestoring('PONG')
        return new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('ECONNRESET')), 5)
        )
      }),
      info: jest.fn()
    }
    const service = new CacheStatusService(
      probe,
      applyDefaults({ connection: { host: 'h' } }),
      resolveAdminOptions({
        scopes: [
          {
            id: 'cache',
            label: 'Cache',
            pattern: 'app:*',
            isReadable: true,
            origin: 'the namespace'
          }
        ]
      }),
      new JsonLike()
    )

    let status: unknown
    try {
      status = (await pinned(service.health())).status
    } catch (error) {
      status = error
    } finally {
      restoreBuiltins()
    }

    expect(status).not.toBe('up')
  })
})
