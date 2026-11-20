/**
 * Unit tests for the commands that take a host-sized array: `delMany`, `mget` and `mset`.
 *
 * Layer: server. A call that spreads an array into a command's arguments overflows the call stack at
 * about 125 000 elements, so a longer array is sent in parts. `mset` sends the parts inside one
 * `MULTI`/`EXEC`, so the write stays atomic as a single call is; `del` and `mget` are sent in parts
 * without one.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { MAX_COMMAND_ARGUMENTS } from '../utils/chunk'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { Redis } from 'ioredis'

jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

/** More elements than the call stack takes as arguments of one call. */
const LARGE = 200_000

/** The ids `0` to `count - 1`, as text. */
const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => String(index))

describe('CacheService with a list over the argument limit', () => {
  let connection: ConnectionManager
  let cache: CacheService
  let client: Redis

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'large' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    client = connection.getClient() as Redis
    await client.flushall()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  // Scenario: 200 000 entries written, read back and deleted.
  // Rule: each call does what a single call would, on a list the stack could not spread.
  it('writes, reads and deletes 200 000 entries', async () => {
    await cache.mset(
      'k',
      ids(LARGE).map((id): [string, number] => [id, Number(id)])
    )
    expect(await client.dbsize()).toBe(LARGE)

    const values = await cache.mget<number>('k', [...ids(LARGE), 'absent'])
    expect(values).toHaveLength(LARGE + 1)
    expect([values[0], values[MAX_COMMAND_ARGUMENTS - 1], values[MAX_COMMAND_ARGUMENTS]]).toEqual([
      0,
      MAX_COMMAND_ARGUMENTS - 1,
      MAX_COMMAND_ARGUMENTS
    ])
    expect([values[LARGE - 1], values[LARGE]]).toEqual([LARGE - 1, null])

    expect(await cache.delMany('k', ids(LARGE))).toBe(LARGE)
    expect(await client.dbsize()).toBe(0)
  })

  // Scenario: arrays at and over the part size, and the commands that send parts outside a transaction.
  // Rule: an array that fits one part is one plain call; a longer array of writes is one transaction,
  // and `del` and `mget` never open one.
  it.each([
    ['mset', MAX_COMMAND_ARGUMENTS / 2, 0],
    ['mset', MAX_COMMAND_ARGUMENTS / 2 + 1, 1],
    ['delMany', MAX_COMMAND_ARGUMENTS + 1, 0],
    ['mget', MAX_COMMAND_ARGUMENTS + 1, 0]
  ])('%s of %p elements opens %p transactions', async (method, count, transactions) => {
    const multi = jest.spyOn(client, 'multi')
    const list = ids(count)

    switch (method) {
      case 'mset':
        await cache.mset(
          'k',
          list.map((id): [string, number] => [id, 1])
        )
        break
      case 'delMany':
        await cache.delMany('k', list)
        break
      default:
        await cache.mget('k', list)
    }

    expect(multi).toHaveBeenCalledTimes(transactions)
  })

  // Scenario: a long write is queued, and only then executed.
  // Rule: every part is queued on the one transaction before `EXEC` runs, and the transaction runs once,
  // so a reader sees none of the parts until all of them are applied.
  it('queues every part on one transaction and executes it once', async () => {
    const queued: number[] = []
    const exec = jest.fn().mockImplementation(async () => {
      expect(queued).toEqual([MAX_COMMAND_ARGUMENTS, MAX_COMMAND_ARGUMENTS, 10])
      return queued.map(() => [null, 'OK'])
    })
    const transaction = {
      mset: jest.fn().mockImplementation((...part: string[]) => {
        queued.push(part.length)
        return transaction
      }),
      exec
    }
    jest.spyOn(client, 'multi').mockReturnValue(transaction as never)

    await cache.mset(
      'k',
      ids(MAX_COMMAND_ARGUMENTS + 5).map((id): [string, number] => [id, 1])
    )

    expect(exec).toHaveBeenCalledTimes(1)
  })

  // Scenario: one command of the transaction fails, or `EXEC` answers nothing.
  // Rule: the call rejects, with the failure mapped as any command's is, and never reports success.
  it('rejects with the failing command, mapped, and when EXEC is aborted', async () => {
    const run = (replies: unknown): Promise<void> => {
      const transaction = {
        mset: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(replies)
      }
      jest.spyOn(client, 'multi').mockReturnValue(transaction as never)
      return cache.mset(
        'k',
        ids(MAX_COMMAND_ARGUMENTS).map((id): [string, number] => [id, 1])
      )
    }

    await expect(
      run([
        [null, 'OK'],
        [new Error('OOM command not allowed'), null]
      ])
    ).rejects.toThrow('OOM command not allowed')
    const timedOut = await run([[new Error('Command timed out'), null]]).catch((e: unknown) => e)
    expect((timedOut as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    const aborted = await run(null).catch((e: unknown) => e)
    expect((aborted as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect((aborted as CacheException).details).toEqual({ reason: 'transaction_aborted' })
  })
})
