/**
 * `CacheStatusService.health` cannot be made to report a failed or late probe as up by replacing
 * `Promise.race`, which its deadline used to read the verdict from.
 *
 * Layer: admin.
 */
import { applyDefaults } from '../../server/config/default-options'
import { resolveAdminOptions } from '../config/resolved-admin-options'
import { CacheStatusService } from './cache-status.service'

import type { ISerializer } from '../../server/interfaces/serializer.interface'

const realRace = Promise.race

afterEach(() => {
  Promise.race = realRace
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
