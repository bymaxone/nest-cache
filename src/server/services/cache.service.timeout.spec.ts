/**
 * Unit tests for command-timeout mapping on {@link CacheService}.
 *
 * Layer: server. ioredis rejects a command that exceeds `commandTimeout` with a plain `Error`
 * whose message is `Command timed out`; the service reports it as a coded `COMMAND_TIMEOUT`
 * exception with the original as `cause`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

describe('CacheService command timeout', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await connection.onApplicationShutdown()
  })

  /** Makes the next `command` on the underlying client reject with `error`. */
  const failWith = (command: 'get' | 'set' | 'incr', error: Error): void => {
    jest.spyOn(connection.getClient(), command as 'get').mockRejectedValue(error)
  }

  /** Runs `call` and returns what it rejected with, failing the test when it resolved. */
  const rejectionOf = async (call: () => Promise<unknown>): Promise<unknown> => {
    try {
      await call()
    } catch (error) {
      return error
    }
    throw new Error('expected the call to reject')
  }

  // The message ioredis uses is part of this mapping's contract: an upgrade that rewords it must
  // fail here, not silently turn timeouts back into plain errors.
  it('matches the message ioredis rejects a timed-out command with', () => {
    const source = readFileSync(
      join(__dirname, '../../../node_modules/ioredis/built/Command.js'),
      'utf8'
    )

    expect(source).toContain('new Error("Command timed out")')
  })

  // A read that times out is a coded 504 with the original error on `cause`.
  it('reports a timed-out read as COMMAND_TIMEOUT with the original as cause', async () => {
    const original = new Error('Command timed out')
    failWith('get', original)

    const error = await rejectionOf(() => cache.get('user', '1'))

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    expect((error as CacheException).cause).toBe(original)
  })

  // A write that times out may still have been applied by the server, which is why the caller
  // needs the distinct code: it must not assume the write failed.
  it.each([
    ['set', (): Promise<unknown> => cache.set('user', '1', { a: 1 })],
    ['incr', (): Promise<unknown> => cache.incr('user', '1')]
  ] as const)('reports a timed-out %s as COMMAND_TIMEOUT', async (command, call) => {
    failWith(command, new Error('Command timed out'))

    const error = await rejectionOf(call)

    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  // With the offline queue off, a stopped Redis rejects every call at once with ioredis's own offline
  // error; it is reported as CONNECTION_LOST with `reason: 'offline'` and the original as `cause`.
  it("reports ioredis's offline rejection as CONNECTION_LOST with reason offline", async () => {
    const original = new Error("Stream isn't writeable and enableOfflineQueue options is false")
    failWith('get', original)

    const error = await rejectionOf(() => cache.get('user', '1'))

    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect((error as CacheException).details).toEqual({ reason: 'offline' })
    expect((error as CacheException).cause).toBe(original)
  })

  // Only the exact message is a timeout; any other failure reaches the caller unchanged.
  it.each([
    'boom',
    'Command timed out after 5000ms',
    'command timed out',
    "Stream isn't writeable"
  ])('passes the error %p through unchanged', async (message) => {
    const original = new Error(message)
    failWith('get', original)

    expect(await rejectionOf(() => cache.get('user', '1'))).toBe(original)
  })

  // Every command goes through the one accessor that maps the error, so a method added later
  // cannot bypass it by reaching for the connection directly. The only other reader is the public
  // `getClient()`, which hands out the raw client on purpose. Each reader is attributed to the
  // method that encloses it. A mutation run executes this spec inside a sandbox whose sources are
  // instrumented, so the pristine file is read from the repository instead.
  it('reaches the client only through the mapping accessor and the public getClient', () => {
    const pristine = __dirname.replace(/[\\/]\.stryker-tmp[\\/]sandbox-[^\\/]+/, '')
    const lines = readFileSync(join(pristine, 'cache.service.ts'), 'utf8').split('\n')
    const readers = new Set<string>()
    let method = ''
    for (const line of lines) {
      const declaration = /^ {2}(?:private |async )*(\w+)(?:<[^>]*>)?\(/.exec(line)
      if (declaration?.[1] !== undefined) {
        method = declaration[1]
      }
      if (line.includes('connection.getClient()')) {
        readers.add(method)
      }
    }

    expect([...readers].sort()).toEqual(['client', 'getClient'])
  })
})
