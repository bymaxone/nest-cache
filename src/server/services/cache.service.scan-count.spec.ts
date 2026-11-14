/**
 * Unit tests for the `COUNT` hint of {@link CacheService.scan}.
 *
 * Layer: server. The caller's hint is a whole number from 1 to 10 000: a value that is not a whole
 * number falls back to the default, and one outside the range is clamped.
 */
import { Readable } from 'node:stream'

import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

describe('CacheService scan COUNT hint', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  /** The `count` the stream was opened with for a `scan` called with `requested`. */
  const countFor = async (requested?: number): Promise<unknown> => {
    const spy = jest
      .spyOn(cache.getClient(), 'scanStream')
      .mockReturnValue(Readable.from([]) as never)
    for await (const key of cache.scan('user', '*', requested)) {
      void key
    }
    return (spy.mock.calls[0]?.[0] as { count?: number } | undefined)?.count
  }

  it('uses 100 when no hint is given', async () => {
    expect(await countFor()).toBe(100)
  })

  it('passes a whole-number hint inside the range through', async () => {
    expect(await countFor(250)).toBe(250)
  })

  // Not a whole number: nothing to clamp to, so the default applies.
  it.each([NaN, Infinity, -Infinity, 2.5])('falls back to 100 for %p', async (value) => {
    expect(await countFor(value)).toBe(100)
  })

  it('clamps a hint above 10 000 to 10 000', async () => {
    expect(await countFor(1_000_000_000)).toBe(10_000)
    expect(await countFor(10_000)).toBe(10_000)
  })

  it.each([0, -5])('clamps a hint of %p to 1', async (value) => {
    expect(await countFor(value)).toBe(1)
  })
})
