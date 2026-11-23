/**
 * `createConnectionManager` refuses a polluted process before it reads an option.
 *
 * Layer: server. The public factory resolves the options of the host and then builds the manager, whose
 * constructor runs the guard on `Object.prototype`; the options are read first on that path unless the
 * factory runs the guard itself.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { createConnectionManager } from './create-connection-manager'
import { KEYS_REASON } from './guard-refusal'

/** The error `run` throws, or undefined. */
function thrownBy(run: () => unknown): { code?: string; details?: unknown } | undefined {
  try {
    run()
  } catch (error) {
    return error as { code?: string; details?: unknown }
  }
  return undefined
}

describe('createConnectionManager', () => {
  // Scenario: a plain value is planted under `get`, and the host wrote a `tls.ca` of three entries.
  // Rule: the refusal is the guard's own, with the reason of keys, before any option is copied.
  it('refuses a key planted on Object.prototype with the reason of keys', () => {
    Object.defineProperty(Object.prototype, 'get', { value: 1, configurable: true, writable: true })
    try {
      const error = thrownBy(() =>
        createConnectionManager({
          connection: { host: 'h', lazyConnect: true, tls: { ca: ['a', 'b', 'c'] } }
        } as never)
      )

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toEqual({ reason: KEYS_REASON, count: 1 })
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get')
    }
  })

  it('builds a manager on a clean process', () => {
    expect(
      createConnectionManager({ connection: { host: 'h', lazyConnect: true } } as never)
    ).toBeDefined()
  })
})
