/**
 * A host call that plants a self-restoring `constructor` and `then` on `Promise.prototype` does not decide
 * which keys `scan` yields or `flushNamespace` unlinks.
 *
 * Layer: server. A `for await` over the scan stream awaits every `next()` result without a `pinned` hop, so
 * the first read of the accessors answers for the iterator and forges a chunk of keys outside the namespace.
 * The library reads the stream through events into a promise it builds, and pins that promise.
 */
import { Readable } from 'node:stream'

import { plantSelfRestoring, restoreBuiltins } from '../../test-helpers/forge-promise'
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { pinned } from '../utils/settle'
import { CacheService } from './cache.service'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return require('../../test-helpers/ioredis-module').ioredisModule(Mock, class FakeCluster {})
})

/** What a forged iterator step would carry: a chunk of keys that live outside the namespace. */
const FORGED_STEP = { done: false, value: ['other:victim'] }

/** The next step, or an end when the call refused; pinned, so this test's own await reads nothing planted. */
async function settledStep(iterator: AsyncIterator<string>): Promise<IteratorResult<string>> {
  try {
    return await pinned(iterator.next())
  } catch {
    return { done: true, value: '' }
  }
}

/** What the promise ended with, a rejection included; pinned, so this test's own await reads nothing planted. */
async function settled(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await pinned(promise)
  } catch (error) {
    return error
  }
}

describe('self-restoring plant while a scan stream is read', () => {
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

  /**
   * A host stream whose iterator hands out native promises, as a Node stream's iterator does. `onSecond`
   * runs inside the second `next()`, after the caller's checks and before it awaits the promise returned.
   */
  const stream = (onSecond?: () => void): unknown => {
    const chunks = [['test:a'], ['test:b'], ['test:c']]
    return {
      destroy: (): void => undefined,
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<unknown> => {
          if (chunks.length === 2) onSecond?.()
          const value = chunks.shift()
          return Promise.resolve(value === undefined ? { done: true } : { done: false, value })
        }
      })
    }
  }

  // Scenario: the host iterator plants the accessors while it hands out the second chunk.
  // Rule: nothing outside the namespace is unlinked, and nothing read the accessors.
  it('flushNamespace never unlinks a key a forged chunk names', async () => {
    let planted: { reads: () => number } | undefined
    const source = stream(() => {
      planted = plantSelfRestoring(FORGED_STEP)
    })
    jest.spyOn(cache.getClient(), 'scanStream').mockReturnValue(source as never)
    const unlink = jest
      .spyOn(connection.getClient(), 'unlink')
      .mockImplementation(((...keys: string[]) => Promise.resolve(keys.length)) as never)

    const outcome = await pinned(settled(cache.flushNamespace()))

    const unlinked = unlink.mock.calls.flat(2) as string[]
    expect(unlinked.filter((key) => !key.startsWith('test:'))).toEqual([])
    expect(planted?.reads()).toBe(0)
    // The plant is live at the next check, so the call refuses instead of reading on.
    expect(outcome).toBeInstanceOf(Error)
  })

  // Scenario: nothing is planted, and `flushNamespace` runs to the end of the scan, then fails on an unlink.
  // Rule: the scan stream is released on completion and on failure, so a host stream never stays open.
  it.each([
    ['completes', false],
    ['fails on an unlink', true]
  ])('flushNamespace destroys the scan stream when it %s', async (_name, failing) => {
    const destroy = jest.fn()
    const source = { ...(stream() as object), destroy }
    jest.spyOn(cache.getClient(), 'scanStream').mockReturnValue(source as never)
    jest
      .spyOn(connection.getClient(), 'unlink')
      .mockImplementation((() =>
        failing ? Promise.reject(new Error('unlink failed')) : Promise.resolve(1)) as never)

    const outcome = await settled(cache.flushNamespace())

    expect(destroy).toHaveBeenCalledTimes(1)
    if (failing) expect(outcome).toBeInstanceOf(Error)
    else expect(outcome).toBe(3)
  })

  // Scenario: the consumer plants the accessors after the first key, then asks for the next one.
  // Rule: scan yields only the keys the stream carried.
  it('scan never yields a key a forged chunk names', async () => {
    jest.spyOn(cache.getClient(), 'scanStream').mockReturnValue(stream() as never)
    const iterator = cache.scan('p', '*')[Symbol.asyncIterator]()
    const keys: string[] = []
    let planted: { reads: () => number } | undefined

    for (;;) {
      const step = await pinned(settledStep(iterator))
      if (step.done === true) break
      keys.push(step.value)
      planted ??= plantSelfRestoring(FORGED_STEP)
    }

    expect(keys).toEqual(['test:a'])
    expect(planted?.reads()).toBe(0)
  })
})
