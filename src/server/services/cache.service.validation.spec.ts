/**
 * Unit tests for opt-in read validation on {@link CacheService}.
 *
 * Layer: server. `get`, `mget`, `hget` and `hgetall` take an optional `{ validate }`. A value that
 * does not satisfy it throws `VALIDATION_FAILED` and the stored entry is left where it is; with no
 * `validate` nothing changes and no validator runs.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { StandardSchemaLike } from '../interfaces/read-options.interface'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

interface User {
  id: number
  name: string
}

/** Whether `value` is a {@link User}. */
const isUser = (value: unknown): value is User =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as User).id === 'number' &&
  typeof (value as User).name === 'string'

/** An asynchronous Standard Schema for {@link User}. */
const asyncSchema: StandardSchemaLike<User> = {
  '~standard': {
    version: 1,
    validate: (value) =>
      Promise.resolve(isUser(value) ? { value } : { issues: [{ message: 'bad shape' }] })
  }
}

describe('CacheService read validation', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    await connection.getClient().flushall()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  /** Runs `call` and returns what it rejected with, failing the test when it resolved. */
  const rejectionOf = async (call: () => Promise<unknown>): Promise<CacheException> => {
    try {
      await call()
    } catch (error) {
      return error as CacheException
    }
    throw new Error('expected the call to reject')
  }

  describe('get', () => {
    // A value that satisfies the predicate or the schema is returned, typed.
    it.each([
      ['a predicate', { validate: isUser }],
      ['an asynchronous schema', { validate: asyncSchema }]
    ])('returns a matching value through %s', async (_name, options) => {
      await cache.set('user', '1', { id: 1, name: 'Ada' })

      await expect(cache.get<User>('user', '1', options)).resolves.toEqual({ id: 1, name: 'Ada' })
    })

    // A miss is a miss: no validator runs for a key that does not exist.
    it('returns null for a missing key without running the validator', async () => {
      const spy = jest.fn(isUser)
      const validate = (value: unknown): value is User => spy(value)

      await expect(cache.get('user', 'absent', { validate })).resolves.toBeNull()
      expect(spy).not.toHaveBeenCalled()
    })

    // The ticket's case: valid JSON of the wrong shape throws, and the entry stays in place, so a
    // read never mutates the store and a host that treats the throw as a miss rewrites it.
    it('throws VALIDATION_FAILED for a wrong shape and leaves the entry in place', async () => {
      await cache.set('user', '1', { id: 'secret-token-123', name: 4 })

      const error = await rejectionOf(() => cache.get<User>('user', '1', { validate: isUser }))

      expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
      expect(JSON.stringify(error.getResponse())).not.toContain('secret')
      expect(await connection.getClient().get('test:user:1')).toContain('secret-token-123')
    })

    // The documented host pattern for a rolling deploy: catch the code and treat it as a miss.
    it('lets the host treat the throw as a miss and rewrite the entry', async () => {
      await cache.set('user', '1', { legacy: true })

      const read = await cache
        .get<User>('user', '1', { validate: isUser })
        .catch((error: unknown) =>
          (error as CacheException).code === CACHE_ERROR_CODES.VALIDATION_FAILED
            ? null
            : Promise.reject(error)
        )
      await cache.set('user', '1', { id: 1, name: 'Ada' })

      expect(read).toBeNull()
      await expect(cache.get<User>('user', '1', { validate: isUser })).resolves.toEqual({
        id: 1,
        name: 'Ada'
      })
    })

    // With no validate nothing changes: the value comes back as decoded, with no validation.
    it('returns the decoded value untouched when no validate is given', async () => {
      await cache.set('user', '1', { anything: true })

      await expect(cache.get('user', '1')).resolves.toEqual({ anything: true })
      await expect(cache.get('user', '1', {})).resolves.toEqual({ anything: true })
    })
  })

  describe('mget', () => {
    // Every present value is checked, in order; a miss stays null and is not checked.
    it('returns the values and nulls when every present value matches', async () => {
      await cache.set('user', '1', { id: 1, name: 'Ada' })
      await cache.set('user', '3', { id: 3, name: 'Bob' })

      await expect(
        cache.mget<User>('user', ['1', '2', '3'], { validate: isUser })
      ).resolves.toEqual([{ id: 1, name: 'Ada' }, null, { id: 3, name: 'Bob' }])
    })

    // The first failing element ends the call and its index is named, so a caller knows which one.
    it('throws for the first invalid element and names its index', async () => {
      await cache.set('user', '1', { id: 1, name: 'Ada' })
      await cache.set('user', '2', { id: 'bad' })
      await cache.set('user', '3', { id: 'worse' })

      const error = await rejectionOf(() =>
        cache.mget<User>('user', ['1', '2', '3'], { validate: isUser })
      )

      expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
      expect((error.details as { index: number }).index).toBe(1)
    })

    // An empty list still makes no Redis call and runs nothing.
    it('returns an empty list for no ids', async () => {
      await expect(cache.mget<User>('user', [], { validate: isUser })).resolves.toEqual([])
    })

    // Without validate the existing behaviour holds.
    it('is unchanged without validate', async () => {
      await cache.set('user', '1', { anything: true })

      await expect(cache.mget('user', ['1'])).resolves.toEqual([{ anything: true }])
    })
  })

  describe('hget', () => {
    // A field value is checked like a plain value, and a miss is null.
    it('returns a matching field, null for a missing one, and throws for a wrong shape', async () => {
      await cache.hset('profile', '1', 'good', { id: 1, name: 'Ada' })
      await cache.hset('profile', '1', 'bad', { id: 'x' })

      await expect(cache.hget<User>('profile', '1', 'good', { validate: isUser })).resolves.toEqual(
        { id: 1, name: 'Ada' }
      )
      await expect(
        cache.hget<User>('profile', '1', 'absent', { validate: isUser })
      ).resolves.toBeNull()
      const error = await rejectionOf(() =>
        cache.hget<User>('profile', '1', 'bad', { validate: isUser })
      )

      expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
      expect(await cache.hget('profile', '1', 'bad')).toEqual({ id: 'x' })
    })
  })

  describe('hgetall', () => {
    // Every field is checked; the failing field is named, and an empty hash is {}.
    it('returns every field when all match, and names the failing field otherwise', async () => {
      await cache.hset('profile', '1', 'a', { id: 1, name: 'Ada' })
      await cache.hset('profile', '1', 'b', { id: 2, name: 'Bob' })

      await expect(cache.hgetall<User>('profile', '1', { validate: isUser })).resolves.toEqual({
        a: { id: 1, name: 'Ada' },
        b: { id: 2, name: 'Bob' }
      })
      await expect(cache.hgetall<User>('profile', 'none', { validate: isUser })).resolves.toEqual(
        {}
      )

      await cache.hset('profile', '1', 'c', { id: 'bad' })
      const error = await rejectionOf(() =>
        cache.hgetall<User>('profile', '1', { validate: isUser })
      )

      expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
      expect((error.details as { field: string }).field).toBe('c')
    })

    // Without validate the existing behaviour holds.
    it('is unchanged without validate', async () => {
      await cache.hset('profile', '1', 'a', { anything: true })

      await expect(cache.hgetall('profile', '1')).resolves.toEqual({ a: { anything: true } })
    })
  })
})
