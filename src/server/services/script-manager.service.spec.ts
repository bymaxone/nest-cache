/**
 * Unit tests for {@link ScriptManagerService}.
 *
 * Layer: server. ioredis-mock does not faithfully implement SCRIPT / EVALSHA, so
 * the managed client is replaced with explicit jest mocks to drive the load,
 * idempotent-cache, EVALSHA, NOSCRIPT-recovery, and error-wrapping paths. The
 * registry is exercised through its public API only (no private access).
 */
import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from '../connection/connection.manager'
import { ScriptManagerService } from './script-manager.service'

import type { ResolvedOptions } from '../config/resolved-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import type { Redis } from 'ioredis'

describe('ScriptManagerService', () => {
  let script: jest.Mock
  let evalsha: jest.Mock
  let connection: ConnectionManager
  let registry: ScriptManagerService

  /**
   * Builds a ScriptManagerService whose managed client is the shared `script` /
   * `evalsha` jest mocks. getClient is spied so no real ioredis client is created.
   */
  const build = (overrides: Partial<BymaxCacheModuleOptions> = {}): ScriptManagerService => {
    const options: ResolvedOptions = applyDefaults({
      connection: { host: 'h' },
      scripts: [{ name: 'cas', lua: 'return 1' }],
      ...overrides
    })
    connection = new ConnectionManager(options)
    // Fake the managed client — ScriptManager only calls script()/evalsha().
    jest.spyOn(connection, 'getClient').mockReturnValue({ script, evalsha } as unknown as Redis)
    return new ScriptManagerService(options, connection)
  }

  beforeEach(() => {
    script = jest.fn().mockResolvedValue('abc123')
    evalsha = jest.fn().mockResolvedValue(['ok'])
    registry = build()
  })

  // A script supplied via options.scripts must be invocable — load resolves its
  // SHA, proving the constructor seeded the registry from options.
  it('pre-registers scripts supplied via options', async () => {
    await expect(registry.load('cas')).resolves.toBe('abc123')
    expect(script).toHaveBeenCalledWith('LOAD', 'return 1')
  })

  // load must cache the SHA — a second load reuses it without a second SCRIPT LOAD.
  it('caches the SHA so repeated loads do not reload', async () => {
    await registry.load('cas')
    await registry.load('cas')

    expect(script).toHaveBeenCalledTimes(1)
  })

  // Loading an unknown script must fail closed with SCRIPT_NOT_REGISTERED.
  it('throws SCRIPT_NOT_REGISTERED when loading an unknown script', async () => {
    await expect(registry.load('missing')).rejects.toBeInstanceOf(CacheException)
    await registry.load('missing').catch((error: unknown) => {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED)
    })
  })

  // eval must load lazily then call EVALSHA with numKeys, the keys, then the args.
  it('evaluates via EVALSHA, loading lazily first', async () => {
    const result = await registry.eval('cas', ['k1', 'k2'], ['arg1'])

    expect(script).toHaveBeenCalledWith('LOAD', 'return 1')
    expect(evalsha).toHaveBeenCalledWith('abc123', 2, 'k1', 'k2', 'arg1')
    expect(result).toEqual(['ok'])
  })

  // When the SHA is already cached, eval must skip the load (the `?? load` branch).
  it('reuses a cached SHA on eval without reloading', async () => {
    await registry.load('cas')
    script.mockClear()

    await registry.eval('cas', ['k'], [])

    expect(script).not.toHaveBeenCalled()
    expect(evalsha).toHaveBeenCalledWith('abc123', 1, 'k')
  })

  // Evaluating an unknown script must fail closed with SCRIPT_NOT_REGISTERED.
  it('throws SCRIPT_NOT_REGISTERED when evaluating an unknown script', async () => {
    await expect(registry.eval('missing', [], [])).rejects.toBeInstanceOf(CacheException)
    await registry.eval('missing', [], []).catch((error: unknown) => {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED)
    })
  })

  // A NOSCRIPT failure (server evicted the SHA) must trigger one reload + retry.
  it('reloads and retries once on NOSCRIPT', async () => {
    await registry.load('cas')
    script.mockClear()
    evalsha
      .mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
      .mockResolvedValueOnce(['recovered'])

    const result = await registry.eval('cas', ['k'], [])

    expect(script).toHaveBeenCalledWith('LOAD', 'return 1')
    expect(evalsha).toHaveBeenCalledTimes(2)
    expect(result).toEqual(['recovered'])
  })

  // If the retry after a NOSCRIPT reload also fails, it must surface as
  // SCRIPT_EXECUTION_FAILED (the inner retry catch).
  it('wraps a failed NOSCRIPT retry as SCRIPT_EXECUTION_FAILED', async () => {
    evalsha
      .mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
      .mockRejectedValueOnce(new Error('ERR retry failed'))

    await expect(registry.eval('cas', ['k'], [])).rejects.toBeInstanceOf(CacheException)
    await registry.eval('cas', ['k'], []).catch((error: unknown) => {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    })
  })

  // If the NOSCRIPT reload (SCRIPT LOAD) itself fails, the failure must still be
  // wrapped as SCRIPT_EXECUTION_FAILED — the contract holds for a reload failure,
  // not only a retry failure. (The reload is inside the retry try/catch.)
  it('wraps a failed NOSCRIPT reload as SCRIPT_EXECUTION_FAILED', async () => {
    await registry.load('cas')
    script.mockClear()
    evalsha.mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
    script.mockRejectedValueOnce(new Error('LOADING Redis is loading the dataset'))

    const error = await registry.eval('cas', ['k'], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect(script).toHaveBeenCalledTimes(1) // the reload was attempted and failed
  })

  // A non-NOSCRIPT error must be wrapped as SCRIPT_EXECUTION_FAILED with the
  // original message preserved in details (Error branch of the message extractor),
  // and must FAIL FAST — no reload (SCRIPT LOAD) and no retry. The pre-load +
  // mockClear isolates the lazy first load so the call counts pin the NOSCRIPT
  // guard: they kill the `NOSCRIPT_MARKER = ''` mutant, under which `.includes('')`
  // is always true and every error would wrongly reload and retry.
  it('wraps a non-NOSCRIPT Error as SCRIPT_EXECUTION_FAILED without reloading', async () => {
    await registry.load('cas')
    script.mockClear()
    evalsha.mockClear()
    evalsha.mockRejectedValue(new Error('ERR something broke'))

    const error = await registry.eval('cas', [], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect((error as CacheException).details?.['originalError']).toBe('ERR something broke')
    expect(script).not.toHaveBeenCalled()
    expect(evalsha).toHaveBeenCalledTimes(1)
  })

  // A non-Error rejection must still be stringified into details (the non-Error
  // branch of the message extractor) and wrapped as SCRIPT_EXECUTION_FAILED.
  it('stringifies a non-Error rejection into the wrapped error', async () => {
    evalsha.mockRejectedValue('plain-string-failure')

    await registry.eval('cas', [], []).catch((error: unknown) => {
      const cacheError = error as CacheException
      expect(cacheError.code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
      expect(cacheError.details?.['originalError']).toBe('plain-string-failure')
    })
    await expect(registry.eval('cas', [], [])).rejects.toBeInstanceOf(CacheException)
  })

  // register must add a script at runtime, making it invocable afterwards.
  it('registers a script dynamically', async () => {
    registry.register('extra', 'return 2')

    await expect(registry.load('extra')).resolves.toBe('abc123')
    expect(script).toHaveBeenCalledWith('LOAD', 'return 2')
  })

  // onApplicationBootstrap must eagerly load every registered script when not lazy
  // (it runs after onModuleInit, so the connection is already ready).
  it('eagerly loads every script on application bootstrap', async () => {
    await registry.onApplicationBootstrap()

    expect(script).toHaveBeenCalledWith('LOAD', 'return 1')
  })

  // With lazyConnect, bootstrap must defer loading entirely (no SCRIPT LOAD).
  it('skips eager loading when lazyConnect is set', async () => {
    const lazy = build({ connection: { host: 'h', lazyConnect: true } })

    await lazy.onApplicationBootstrap()

    expect(script).not.toHaveBeenCalled()
  })
})
