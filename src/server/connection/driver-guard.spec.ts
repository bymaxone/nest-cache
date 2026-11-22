/**
 * The refusal to build a manager or a client while `Object.prototype` holds a key it does not hold by default.
 *
 * Layer: server. ioredis reads names off objects it creates itself (a client, a cluster, a connector, a
 * pipeline, a command, a subscriber) that those objects do not hold when they are built: through `this`,
 * through an alias of `this` (`const _this = this`) and through other objects. The library cannot give those
 * objects an own key, and a list of the names can never be shown complete, so a polluted `Object.prototype`
 * is refused as a whole, whichever name is planted.
 */
import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'

const build = (): ConnectionManager =>
  new ConnectionManager(
    resolveOptions({
      connection: { host: 'h', lazyConnect: true }
    } as unknown as BymaxCacheModuleOptions)
  )

/** Plants `name` on `Object.prototype` for the length of `run`. */
function planted<T>(name: string | symbol, run: () => T, enumerable = false): T {
  Object.defineProperty(Object.prototype, name, {
    value: 'PLANTED-VALUE',
    configurable: true,
    writable: true,
    enumerable
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

/** The exception `run` throws, or undefined. */
function thrownBy(
  run: () => unknown
): { code?: string; details?: Record<string, unknown> } | undefined {
  try {
    run()
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> }
  }
  return undefined
}

describe('the manager with a key planted on Object.prototype', () => {
  // Scenario: another part of the process plants a key, whatever its name: one the driver reads off its own
  // objects (manuallyClosing, preferKey, length), one it reads through an alias, one nobody has listed.
  // Rule: the manager refuses to be built, reporting how many keys are planted and none of them.
  it.each(['manuallyClosing', 'preferKey', 'length', 'keys', 'stream', 'aNameNoListHolds'])(
    'refuses to be built when %s is planted',
    (name) => {
      const error = planted(name, () => thrownBy(build))

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toEqual({
        reason: 'Object.prototype holds keys the driver would read as its own',
        count: 1
      })
      expect(JSON.stringify(error)).not.toContain('PLANTED-VALUE')
      expect(error?.details).not.toHaveProperty('name')
    }
  )

  it('refuses a key that is enumerable as well, and counts every planted key', () => {
    const error = planted('plantedOne', () => planted('plantedTwo', () => thrownBy(build), true))

    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 2
    })
  })

  // Scenario: the key is planted after the manager is built and before it builds a client.
  // Rule: the client is not built: the check runs when each client is created.
  it('refuses to build a client when a key is planted after the manager was built', () => {
    const manager = build()
    const error = planted('manuallyClosing', () => thrownBy(() => manager.getClient()))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 1
    })
  })

  // Scenario: a symbol key, which is no name the driver reads (the test runner plants one).
  // Rule: it is not refused.
  it('is built when a symbol is planted and when nothing is planted', () => {
    expect(planted(Symbol('planted'), build)).toBeInstanceOf(ConnectionManager)
    expect(build()).toBeInstanceOf(ConnectionManager)
  })
})
