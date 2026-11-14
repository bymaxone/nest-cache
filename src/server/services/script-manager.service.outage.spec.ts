/**
 * Unit tests for how {@link ScriptManagerService} reports an unavailable backing service.
 *
 * Layer: server. A timeout or an offline connection while a script loads or runs is a backing
 * service problem, so it surfaces as `COMMAND_TIMEOUT` or `CONNECTION_LOST` (both 503) with the
 * original on `cause`. `SCRIPT_EXECUTION_FAILED` (500) is for what the script itself did.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ScriptManagerService } from './script-manager.service'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import type { Redis } from 'ioredis'

const TIMEOUT = 'Command timed out'
const OFFLINE = "Stream isn't writeable and enableOfflineQueue options is false"

describe('ScriptManagerService outage mapping', () => {
  let script: jest.Mock
  let evalsha: jest.Mock
  let evalCmd: jest.Mock

  /** A service over fake `script` / `evalsha` / `eval` commands; `cluster` selects the EVAL path. */
  const build = (overrides: Partial<BymaxCacheModuleOptions> = {}): ScriptManagerService => {
    const options = applyDefaults({
      connection: { host: 'h' },
      scripts: [{ name: 'cas', lua: 'return 1' }],
      ...overrides
    })
    const connection = new ConnectionManager(options)
    jest
      .spyOn(connection, 'getClient')
      .mockReturnValue({ script, evalsha, eval: evalCmd } as unknown as Redis)
    return new ScriptManagerService(options, connection)
  }

  /** What `call` rejected with, failing the test when it resolved. */
  const rejectionOf = async (call: () => Promise<unknown>): Promise<CacheException> => {
    try {
      await call()
    } catch (error) {
      return error as CacheException
    }
    throw new Error('expected the call to reject')
  }

  beforeEach(() => {
    script = jest.fn().mockResolvedValue('abc123')
    evalsha = jest.fn().mockResolvedValue(['ok'])
    evalCmd = jest.fn().mockResolvedValue(['cluster-ok'])
  })

  it('reports a timed-out EVALSHA as COMMAND_TIMEOUT with the original as cause', async () => {
    const original = new Error(TIMEOUT)
    evalsha.mockRejectedValue(original)

    const error = await rejectionOf(() => build().eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    expect(error.getStatus()).toBe(503)
    expect(error.cause).toBe(original)
  })

  it('reports an offline EVALSHA as CONNECTION_LOST (offline)', async () => {
    evalsha.mockRejectedValue(new Error(OFFLINE))

    const error = await rejectionOf(() => build().eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect(error.details).toEqual({ reason: 'offline' })
  })

  it('reports a timed-out SCRIPT LOAD as COMMAND_TIMEOUT', async () => {
    script.mockRejectedValue(new Error(TIMEOUT))

    const error = await rejectionOf(() => build().load('cas'))

    expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  // The reload after a NOSCRIPT is also a command against the backing service.
  it('reports a timed-out reload after NOSCRIPT as COMMAND_TIMEOUT', async () => {
    evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'))
    script.mockResolvedValueOnce('abc123').mockRejectedValueOnce(new Error(TIMEOUT))

    const error = await rejectionOf(() => build().eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  it('reports a timed-out cluster EVAL as COMMAND_TIMEOUT', async () => {
    evalCmd.mockRejectedValue(new Error(TIMEOUT))
    const registry = build({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'c', port: 6379 }] }
    })

    const error = await rejectionOf(() => registry.eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  // What the script did stays SCRIPT_EXECUTION_FAILED, a genuine 500.
  it('keeps a Lua runtime error as SCRIPT_EXECUTION_FAILED (500)', async () => {
    evalsha.mockRejectedValue(new Error('ERR user_script:1: boom'))

    const error = await rejectionOf(() => build().eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect(error.getStatus()).toBe(500)
  })

  it('keeps a failed retry after NOSCRIPT as SCRIPT_EXECUTION_FAILED', async () => {
    evalsha
      .mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
      .mockRejectedValueOnce(new Error('ERR user_script:1: boom'))

    const error = await rejectionOf(() => build().eval('cas', ['k'], []))

    expect(error.code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
  })
})
