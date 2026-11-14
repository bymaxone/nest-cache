/**
 * Unit tests for how {@link CacheAdminService} answers an unavailable backing service and a caller's
 * mistake.
 *
 * Layer: admin. A timeout or an offline connection while it reads is a backing service problem
 * (503, a coded `CacheException`); an undeclared scope or a key outside the named scope is a
 * caller's mistake (404) and is decided without a single Redis command, so the answer cannot say
 * whether a key exists outside the scope.
 */
import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

import { resolveAdminOptions } from '../config/resolved-admin-options'
import { CacheAdminService } from './cache-admin.service'

import type { CacheScope } from '../interfaces/cache-scope.interface'
import type { IRedisReader } from '../interfaces/redis-reader.interface'

const SCOPES: readonly CacheScope[] = [
  { id: 'cache', label: 'Cache', pattern: 'app:*', isReadable: true, origin: 'the namespace' }
]

/** A reader whose every command fails with `error`, counting the commands it was asked. */
const failingReader = (error: Error): { reader: IRedisReader; commands: () => number } => {
  let commands = 0
  const fail = async (): Promise<never> => {
    commands += 1
    throw error
  }
  const reader = {
    scan: fail,
    type: fail,
    ttl: fail,
    get: fail,
    hgetall: fail,
    smembers: fail,
    lrange: fail,
    call: fail,
    pipeline: () => {
      commands += 1
      return {
        type: () => reader.pipeline(),
        ttl: () => reader.pipeline(),
        memory: () => reader.pipeline(),
        exec: fail
      }
    }
  } as unknown as IRedisReader
  return { reader, commands: () => commands }
}

const build = (reader: IRedisReader): CacheAdminService =>
  new CacheAdminService({ getClient: () => reader }, resolveAdminOptions({ scopes: SCOPES }))

/** What `call` rejected with, failing the test when it resolved. */
const rejectionOf = async (call: () => Promise<unknown>): Promise<CacheException> => {
  try {
    await call()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('expected the call to reject')
}

describe('CacheAdminService outage and caller errors', () => {
  it.each([
    ['listKeys', (s: CacheAdminService): Promise<unknown> => s.listKeys('cache')],
    ['describeKey', (s: CacheAdminService): Promise<unknown> => s.describeKey('cache', 'app:a')],
    ['revealValue', (s: CacheAdminService): Promise<unknown> => s.revealValue('cache', 'app:a')]
  ])(
    'reports a timed-out %s as COMMAND_TIMEOUT (503) with the original as cause',
    async (_name, call) => {
      const original = new Error('Command timed out')
      const { reader } = failingReader(original)

      const error = await rejectionOf(() => call(build(reader)))

      expect(error).toBeInstanceOf(CacheException)
      expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
      expect(error.getStatus()).toBe(503)
      expect(error.cause).toBe(original)
    }
  )

  it('reports a listing while the connection is down as CONNECTION_LOST (offline)', async () => {
    const { reader } = failingReader(
      new Error("Stream isn't writeable and enableOfflineQueue options is false")
    )

    const error = await rejectionOf(() => build(reader).listKeys('cache'))

    expect(error.code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect(error.getStatus()).toBe(503)
  })

  it('answers 404 for an undeclared scope', async () => {
    const { reader, commands } = failingReader(new Error('must not be called'))

    const error = await rejectionOf(() => build(reader).listKeys('nope'))

    expect(error.code).toBe(CACHE_ERROR_CODES.SCOPE_NOT_FOUND)
    expect(error.getStatus()).toBe(404)
    expect(commands()).toBe(0)
  })

  // A key outside the named scope is refused from the scope's pattern alone: no command is sent, so
  // whether the key exists in Redis cannot show in the answer, which is the same for any such key.
  it('answers 404 for a key outside the scope without asking Redis, the same for any key', async () => {
    const { reader, commands } = failingReader(new Error('must not be called'))
    const service = build(reader)

    const first = await rejectionOf(() => service.describeKey('cache', 'other:exists'))
    const second = await rejectionOf(() => service.revealValue('cache', 'other:absent'))

    expect(commands()).toBe(0)
    for (const error of [first, second]) {
      expect(error.code).toBe(CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE)
      expect(error.getStatus()).toBe(404)
    }
    expect(Object.keys(first.getResponse() as object)).toEqual(
      Object.keys(second.getResponse() as object)
    )
    expect(first.message).toBe(second.message)
  })
})
