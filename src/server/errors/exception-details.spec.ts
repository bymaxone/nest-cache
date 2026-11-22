/**
 * Tests that no error response carries text a third party wrote.
 *
 * Layer: server. `details` is serialised verbatim into the HTTP body of a `CacheException`, and
 * the message of a driver, a serializer, a schema or a script can name a host, a port, a stored
 * value or a key. Each case below makes one of them throw a poisoned message and asserts the
 * response body does not contain it while the original error stays on `cause`. Every error code
 * is either in the table or listed with the reason it cannot carry such text, so a new code has to
 * be decided here.
 */
import { EventEmitter } from 'node:events'

import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { ScriptManagerService } from '../services/script-manager.service'
import { guardSerializer } from '../utils/guard-serializer'
import { JsonSerializer } from '../utils/json-serializer'
import { validateRead } from '../utils/validate-read'
import { CACHE_ERROR_CODES } from './cache-error-codes'
import { CacheException } from './cache.exception'

import type { Redis } from 'ioredis'

import type { StandardSchemaLike } from '../interfaces/read-options.interface'
import type { ISerializer } from '../interfaces/serializer.interface'

// Hoisted registry the mock factory fills with each constructed client (`var`: the factory runs
// before a `let` or `const` here would be initialised).
var instances: EventEmitter[]

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor() {
      super()
      instances.push(this)
    }
  }
  return {
    __esModule: true,
    AbstractConnector: jest.requireActual<typeof import('ioredis')>('ioredis').AbstractConnector,
    Redis: FakeRedis,
    Cluster: FakeRedis,
    default: FakeRedis
  }
})

beforeEach(() => {
  instances = []
})

/** A message of the kind a driver or a host writes: a private address, a credential, a value. */
const POISON = 'connect ECONNREFUSED 10.0.0.5:6379 password=s3cr3t-token {"email":"a@b.c"}'

/** The exception `run` throws or rejects with, failing when it neither threw nor rejected. */
const thrownBy = async (run: () => Promise<unknown> | unknown): Promise<CacheException> => {
  try {
    await run()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('expected the call to throw')
}

/** A manager whose client errors with the poisoned message before it is ready. */
const bootWithPoisonedError = async (): Promise<void> => {
  const manager = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
  const init = manager.onModuleInit()
  instances[0]?.emit('error', new Error(POISON))
  await init
}

/** A script registry whose `EVALSHA` rejects with the poisoned message. */
const poisonedScript = (): Promise<unknown> => {
  const options = applyDefaults({
    connection: { host: 'h' },
    scripts: [{ name: 'cas', lua: 'return 1' }]
  })
  const connection = new ConnectionManager(options)
  const client = {
    script: jest.fn().mockResolvedValue('abc123'),
    evalsha: jest.fn().mockRejectedValue(new Error(POISON))
  }
  jest.spyOn(connection, 'getClient').mockReturnValue(client as unknown as Redis)
  return new ScriptManagerService(options, connection).eval('cas', [], [])
}

/** A custom serializer whose encoder and decoder both throw the poisoned message. */
const throwing: ISerializer = {
  serialize: () => {
    throw new Error(POISON)
  },
  deserialize: () => {
    throw new Error(POISON)
  }
}

/** A Standard Schema validator that answers with `validate`. */
const schema = (validate: () => unknown): StandardSchemaLike =>
  ({ '~standard': { version: 1, validate } }) as unknown as StandardSchemaLike

/** Each way a third party's text can reach an error, with the code the error carries. */
const CASES: readonly {
  name: string
  code: string
  make: () => Promise<CacheException>
  /** False where the original is deliberately not kept: the default JSON decoder's own message quotes the stored value. */
  keepsCause?: boolean
}[] = [
  {
    name: 'the client errors before it is ready',
    code: CACHE_ERROR_CODES.CONNECTION_FAILED,
    make: () => thrownBy(bootWithPoisonedError)
  },
  {
    name: 'a later call after that failed boot',
    code: CACHE_ERROR_CODES.CONNECTION_FAILED,
    make: async () => {
      const manager = new ConnectionManager(applyDefaults({ connection: { host: 'h' } }))
      const init = manager.onModuleInit()
      instances[0]?.emit('error', new Error(POISON))
      await init.catch(() => undefined)
      return thrownBy(() => manager.getClient())
    }
  },
  {
    name: 'a script the server rejects',
    code: CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED,
    make: () => thrownBy(poisonedScript)
  },
  {
    name: 'a toJSON hook that throws',
    code: CACHE_ERROR_CODES.SERIALIZATION_FAILED,
    make: () =>
      thrownBy(() =>
        new JsonSerializer().serialize({
          toJSON(): never {
            throw new Error(POISON)
          }
        })
      )
  },
  {
    name: 'a custom serializer that cannot encode',
    code: CACHE_ERROR_CODES.SERIALIZATION_FAILED,
    make: () => thrownBy(() => guardSerializer(throwing).serialize('x'))
  },
  {
    name: 'a stored value that is not JSON and quotes the poison',
    code: CACHE_ERROR_CODES.DESERIALIZATION_FAILED,
    make: () => thrownBy(() => new JsonSerializer().deserialize(`{${POISON}}`)),
    keepsCause: false
  },
  {
    name: 'a custom serializer that cannot decode',
    code: CACHE_ERROR_CODES.DESERIALIZATION_FAILED,
    make: () => thrownBy(() => guardSerializer(throwing).deserialize('x'))
  },
  {
    name: 'a type predicate that throws',
    code: CACHE_ERROR_CODES.VALIDATION_FAILED,
    make: () =>
      thrownBy(() =>
        validateRead('v', (_value: unknown): _value is string => {
          throw new Error(POISON)
        })
      )
  },
  {
    name: 'a schema that reports an issue quoting the value',
    code: CACHE_ERROR_CODES.VALIDATION_FAILED,
    make: () =>
      thrownBy(() =>
        validateRead(
          'v',
          schema(() => ({ issues: [{ message: POISON }] }))
        )
      )
  },
  {
    name: 'a schema that throws',
    code: CACHE_ERROR_CODES.VALIDATION_FAILED,
    make: () =>
      thrownBy(() =>
        validateRead(
          'v',
          schema(() => {
            throw new Error(POISON)
          })
        )
      )
  }
]

/**
 * The codes no third-party text can reach, with the reason: their `details` hold fixed text, or a
 * value the caller or the host's own configuration supplied.
 */
const FIXED_OR_OWNED =
  'its details hold fixed text or a value the caller or the configuration supplied'
const EXEMPT: Record<string, string> = {
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT]: 'it has no details',
  [CACHE_ERROR_CODES.CONNECTION_LOST]:
    "its details hold only the fixed 'offline' or 'shutdown' reason",
  [CACHE_ERROR_CODES.INVALID_NAMESPACE]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.INVALID_KEY]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING]: 'it has no details',
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION]: 'it has no details',
  [CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.INVALID_SCOPE]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SCOPE_NOT_FOUND]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.SCOPE_NOT_READABLE]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.INVALID_TTL]: FIXED_OR_OWNED,
  [CACHE_ERROR_CODES.INVALID_OPTIONS]: FIXED_OR_OWNED
}

describe('what an error response carries', () => {
  it.each(CASES)(
    'keeps the text of $name out of the response body',
    async ({ code, make, keepsCause = true }) => {
      const error = await make()

      const body = JSON.stringify(error.getResponse())
      expect(error.code).toBe(code)
      for (const leaked of ['10.0.0.5', '6379', 's3cr3t-token', 'a@b.c', 'ECONNREFUSED']) {
        expect([leaked, body.includes(leaked)]).toEqual([leaked, false])
      }
      expect(error.cause !== undefined).toBe(keepsCause)
    }
  )

  it('decides every error code: in the table above, or exempt with a reason', () => {
    const tabled = new Set(CASES.map((entry) => entry.code))
    const decided = [...tabled, ...Object.keys(EXEMPT)]

    expect(decided.sort()).toEqual(Object.values(CACHE_ERROR_CODES).sort())
    expect(Object.keys(EXEMPT).filter((code) => tabled.has(code))).toEqual([])
  })
})
