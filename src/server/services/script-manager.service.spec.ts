/**
 * Unit tests for {@link ScriptManagerService}.
 *
 * Layer: server. ioredis-mock does not faithfully implement SCRIPT / EVALSHA, so
 * the managed client is replaced with explicit jest mocks to drive the load,
 * idempotent-cache, EVALSHA, NOSCRIPT-recovery, and error-wrapping paths. The
 * registry is exercised through its public API only (no private access).
 */
import { handledRejection, underForgery } from '../../test-helpers/forge-promise'
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
  let evalCmd: jest.Mock
  let connection: ConnectionManager
  let registry: ScriptManagerService

  /**
   * Builds a ScriptManagerService whose managed client is the shared `script` /
   * `evalsha` / `eval` jest mocks. getClient is spied so no real ioredis client is
   * created. Pass `{ mode: 'cluster' }` to exercise the cluster EVAL path.
   */
  const build = (overrides: Partial<BymaxCacheModuleOptions> = {}): ScriptManagerService => {
    const options: ResolvedOptions = applyDefaults({
      connection: { host: 'h' },
      scripts: [{ name: 'cas', lua: 'return 1' }],
      ...overrides
    })
    connection = new ConnectionManager(options)
    // Fake the managed client — ScriptManager calls script()/evalsha() (standalone)
    // or eval() (cluster).
    jest
      .spyOn(connection, 'getClient')
      .mockReturnValue({ script, evalsha, eval: evalCmd } as unknown as Redis)
    return new ScriptManagerService(options, connection)
  }

  beforeEach(() => {
    script = jest.fn().mockResolvedValue('abc123')
    evalsha = jest.fn().mockResolvedValue(['ok'])
    evalCmd = jest.fn().mockResolvedValue(['cluster-ok'])
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

  // Loading an unknown script must fail closed with SCRIPT_NOT_REGISTERED, carrying
  // the offending name in details. The details assertion kills the ObjectLiteral
  // mutant that empties `{ name }` to `{}` in load's fail-closed throw.
  it('throws SCRIPT_NOT_REGISTERED when loading an unknown script', async () => {
    await expect(registry.load('missing')).rejects.toBeInstanceOf(CacheException)
    await registry.load('missing').catch((error: unknown) => {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED)
      expect((error as CacheException).details).toEqual({ name: 'missing' })
    })
  })

  // eval must load lazily then call EVALSHA with numKeys, the keys, then the args.
  it('evaluates via EVALSHA, loading lazily first', async () => {
    const result = await registry.eval('cas', ['k1', 'k2'], ['arg1'])

    expect(script).toHaveBeenCalledWith('LOAD', 'return 1')
    expect(evalsha).toHaveBeenCalledWith('abc123', 2, 'k1', 'k2', 'arg1')
    expect(result).toEqual(['ok'])
  })

  // Scenario: a call whose keys and arguments together pass the documented maximum, and one at it.
  // Rule: the call is refused with the script name and the maximum, before any command is sent, since
  // a spread of a longer list overflows the call stack; a list at the maximum goes through.
  it('refuses more keys and arguments than the maximum, and accepts the maximum', async () => {
    const keys = Array.from({ length: 15_000 }, (_, index) => `k${index}`)
    const args = Array.from({ length: 10_000 }, (_, index) => index)

    await expect(registry.eval('cas', keys, [...args, 1])).rejects.toMatchObject({
      code: CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED,
      details: { name: 'cas', reason: 'too many keys and arguments', max: 25_000 }
    })
    expect(script).not.toHaveBeenCalled()
    expect(evalsha).not.toHaveBeenCalled()

    await expect(registry.eval('cas', keys, args)).resolves.toEqual(['ok'])
    expect(evalsha.mock.calls[0]).toHaveLength(3 + keys.length + args.length - 1)
  })

  // When the SHA is already cached, eval must skip the load (the `?? load` branch).
  it('reuses a cached SHA on eval without reloading', async () => {
    await registry.load('cas')
    script.mockClear()

    await registry.eval('cas', ['k'], [])

    expect(script).not.toHaveBeenCalled()
    expect(evalsha).toHaveBeenCalledWith('abc123', 1, 'k')
  })

  // Evaluating an unknown script must fail closed with SCRIPT_NOT_REGISTERED, carrying
  // the offending name in details. The details assertion kills the ObjectLiteral
  // mutant that empties `{ name }` to `{}` in eval's fail-closed throw.
  it('throws SCRIPT_NOT_REGISTERED when evaluating an unknown script', async () => {
    await expect(registry.eval('missing', [], [])).rejects.toBeInstanceOf(CacheException)
    await registry.eval('missing', [], []).catch((error: unknown) => {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED)
      expect((error as CacheException).details).toEqual({ name: 'missing' })
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
  // SCRIPT_EXECUTION_FAILED (the inner retry catch) carrying the script name and fixed
  // text in details, with the original retry error on cause. The details assertion kills the
  // ObjectLiteral mutant that empties the reload+retry catch's details to `{}`.
  it('wraps a failed NOSCRIPT retry as SCRIPT_EXECUTION_FAILED', async () => {
    evalsha
      .mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
      .mockRejectedValueOnce(new Error('ERR retry failed'))

    // A single eval consumes both `mockRejectedValueOnce`s (NOSCRIPT then the
    // failed retry); capturing the thrown error lets the details assertion run
    // (a second eval would hit the default resolved mock and skip the catch).
    const error = await registry.eval('cas', ['k'], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect((error as CacheException).details).toEqual({
      name: 'cas',
      error: 'the script did not run to completion'
    })
    expect(((error as CacheException).cause as Error).message).toBe('ERR retry failed')
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
  // original message kept on cause, not in details,
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
    expect((error as CacheException).details?.['error']).toBe(
      'the script did not run to completion'
    )
    expect(((error as CacheException).cause as Error).message).toBe('ERR something broke')
    expect(script).not.toHaveBeenCalled()
    expect(evalsha).toHaveBeenCalledTimes(1)
  })

  // A non-Error rejection must still be wrapped as SCRIPT_EXECUTION_FAILED, with fixed text in
  // details and the rejected value kept on `cause`.
  it('wraps a non-Error rejection, keeping it on the cause', async () => {
    expect.assertions(4)
    evalsha.mockRejectedValue('plain-string-failure')

    const caught = await registry.eval('cas', [], []).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(CacheException)
    if (!(caught instanceof CacheException)) throw caught
    expect(caught.code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect(caught.details?.['error']).toBe('the script did not run to completion')
    expect(caught.cause).toBe('plain-string-failure')
  })

  // A rejection that cannot be printed (no prototype, so `String()` throws) must still be
  // wrapped as SCRIPT_EXECUTION_FAILED, not escape as a TypeError from the error path.
  it('wraps a prototype-less rejection as SCRIPT_EXECUTION_FAILED', async () => {
    expect.assertions(3)
    evalsha.mockRejectedValue(Object.create(null))

    const caught = await registry.eval('cas', [], []).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(CacheException)
    if (!(caught instanceof CacheException)) throw caught
    expect(caught.code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect(caught.details?.['error']).toBe('the script did not run to completion')
  })

  // In cluster mode eval must use EVAL with the full Lua body (routed by key),
  // never EVALSHA/SCRIPT LOAD — which can hit different nodes and NOSCRIPT. Pins
  // the `mode === 'cluster'` branch and the exact EVAL arguments.
  it('uses EVAL with the script body in cluster mode', async () => {
    const cluster = build({ mode: 'cluster' })

    const result = await cluster.eval('cas', ['{t}:k'], ['x'])

    expect(evalCmd).toHaveBeenCalledWith('return 1', 1, '{t}:k', 'x')
    expect(result).toEqual(['cluster-ok'])
    expect(evalsha).not.toHaveBeenCalled()
    expect(script).not.toHaveBeenCalled()
  })

  // A cluster EVAL failure must surface as SCRIPT_EXECUTION_FAILED with the
  // original error on cause (the cluster branch's catch) — and never echo the
  // Lua source.
  it('wraps a cluster EVAL failure as SCRIPT_EXECUTION_FAILED', async () => {
    const cluster = build({ mode: 'cluster' })
    evalCmd.mockRejectedValue(new Error('CLUSTERDOWN Hash slot not served'))

    const error = await cluster.eval('cas', ['{t}:k'], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect((error as CacheException).details).toEqual({
      name: 'cas',
      error: 'the script did not run to completion'
    })
    expect(((error as CacheException).cause as Error).message).toBe(
      'CLUSTERDOWN Hash slot not served'
    )
  })

  // A cluster EVAL with zero keys would execute on an arbitrary node instead of
  // the slot owner — which violates the routing contract and produces non-deterministic
  // results. The method must fail closed before any network call, carrying the
  // script name and the reason so callers can diagnose the misuse.
  it('throws SCRIPT_EXECUTION_FAILED in cluster mode when called with zero keys', async () => {
    const cluster = build({ mode: 'cluster' })

    const error = await cluster.eval('cas', [], ['x']).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED)
    expect((error as CacheException).details).toEqual({
      name: 'cas',
      reason: 'cluster EVAL requires at least one key for slot routing'
    })
    expect(evalCmd).not.toHaveBeenCalled()
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

  // Scenario: the scripts array, or a definition in it, is a getter or a proxy of the host's that throws.
  // Rule: building the registry ends as the coded option error carrying the host's error as cause.
  it.each([
    [
      'the array',
      (hostError: Error): unknown =>
        new Proxy([{ name: 'cas', lua: 'return 1' }], {
          get(): never {
            throw hostError
          }
        })
    ],
    [
      'a definition',
      (hostError: Error): unknown => [
        Object.defineProperty({ lua: 'return 1' }, 'name', {
          get: (): never => {
            throw hostError
          },
          enumerable: true
        })
      ]
    ]
  ])('rejects with a coded error when %s of scripts cannot be read', (_what, make) => {
    const hostError = new Error('scripts down')
    const options = applyDefaults({ connection: { host: 'h' } })
    const hostile = { ...options, scripts: make(hostError) } as unknown as ResolvedOptions
    const failure = ((): unknown => {
      try {
        return new ScriptManagerService(hostile, new ConnectionManager(options))
      } catch (error) {
        return error
      }
    })()

    expect(failure).toMatchObject({ code: CACHE_ERROR_CODES.INVALID_OPTIONS })
    expect((failure as CacheException).cause).toBe(hostError)
  })

  // Scenario: a getter of the host's connection block throws while bootstrap reads the lazy flag.
  // Rule: bootstrap rejects with the coded option error that carries the host's error as cause.
  it('rejects with a coded error when the lazy flag cannot be read', async () => {
    const hostError = new Error('getter down')
    let reads = 0
    // The connection manager reads the flag once while it is built; the next read is bootstrap's.
    const throwing = build({
      connection: Object.defineProperty({ host: 'h' }, 'lazyConnect', {
        get: (): boolean => {
          reads += 1
          if (reads > 1) {
            throw hostError
          }
          return false
        }
      })
    })

    const failure = await throwing.onApplicationBootstrap().catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: CACHE_ERROR_CODES.INVALID_OPTIONS })
    expect((failure as CacheException).cause).toBe(hostError)
  })

  // A replaced Promise.all answered for the loads, so a script that failed to load read as loaded.
  it('rejects at bootstrap when Promise.all is replaced and a script load fails', async () => {
    script.mockReturnValue(handledRejection(new Error('NOSCRIPT')))

    // A load the replaced static never observes is dropped; the listener keeps that from ending the worker.
    const dropped = jest.fn()
    process.on('unhandledRejection', dropped)
    let outcome: Awaited<ReturnType<typeof underForgery>>
    try {
      outcome = await underForgery(
        () => {
          Promise.all = (() => Promise.resolve([])) as unknown as typeof Promise.all
        },
        () => registry.onApplicationBootstrap()
      )
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', dropped)
    }

    expect(outcome.settled).toBe('rejected')
  })

  // With lazyConnect, bootstrap must defer loading entirely (no SCRIPT LOAD).
  it('skips eager loading when lazyConnect is set', async () => {
    const lazy = build({ connection: { host: 'h', lazyConnect: true } })

    await lazy.onApplicationBootstrap()

    expect(script).not.toHaveBeenCalled()
  })
})
