/**
 * The options the driver itself refuses when a cluster client is built.
 *
 * Layer: server. ioredis throws its own error for an option it cannot use, and for `scaleReads` the
 * message prints the value the host gave. Each such refusal ends as INVALID_OPTIONS with the library's
 * code, and no part of the host's value appears in the exception, its details, its message or what a
 * logger renders from it. Nothing here mocks the driver: its constructor is what refuses.
 */
import { inspect } from 'node:util'

import { applyDefaults, resolveOptions, validateOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from './connection.manager'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

const SECRET = 'HOSTSECRET-value'

/** The exception building the client for a cluster whose `cluster.options` are `options` throws. */
function refusal(options: Record<string, unknown>): CacheException {
  const raw = {
    mode: 'cluster',
    cluster: { nodes: [{ host: '127.0.0.1', port: 1 }], options: { lazyConnect: true, ...options } }
  } as unknown as BymaxCacheModuleOptions
  try {
    validateOptions(raw)
    new ConnectionManager(applyDefaults(raw)).getClient()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('the cluster client was built')
}

describe.each([
  ['himportFieldsets holding a string', { himportFieldsets: [SECRET] }],
  ['scripts given as a string', { scripts: SECRET }]
])('a cluster option the driver refuses: %s', (_label, options) => {
  // Scenario: the host gives the driver an option it cannot use.
  // Rule: INVALID_OPTIONS, with no part of the value in the error, whatever the driver printed.
  it('ends as INVALID_OPTIONS and echoes none of the value', () => {
    const error = refusal(options)

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({ reason: 'the driver refused an option of the cluster' })
    expect(error.cause).toBeUndefined()
    for (const rendered of [
      JSON.stringify(error),
      String(error.message),
      inspect(error, { depth: 9 })
    ]) {
      expect(rendered).not.toContain('HOSTSECRET')
    }
  })
})

describe('an option that cannot be read while the cluster client is built', () => {
  // Scenario: the host's `cluster.nodes` getter throws when the client is built, after validation read it.
  // Rule: the library's own refusal (reason 'option could not be read', the host's error on the cause) passes
  // through the wrap as it is, and is not replaced by the fixed driver reason.
  it('keeps its own refusal and its cause', () => {
    const raw = {
      mode: 'cluster',
      cluster: { nodes: [{ host: '127.0.0.1', port: 1 }], options: { lazyConnect: true } }
    } as unknown as BymaxCacheModuleOptions
    validateOptions(raw)
    const resolved = applyDefaults(raw)
    const failure = new Error('HOSTSECRET-getter')
    Object.defineProperty(resolved.cluster, 'nodes', {
      get: () => {
        throw failure
      }
    })

    let error: CacheException | undefined
    try {
      new ConnectionManager(resolved).getClient()
    } catch (thrown) {
      error = thrown as CacheException
    }

    expect(error).toBeInstanceOf(CacheException)
    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error?.details).toEqual({ reason: 'option could not be read' })
    expect(error?.cause).toBe(failure)
  })
})

describe('a value the driver reads while the client is built', () => {
  /** The exception building the client for a cluster whose `himportFieldsets` entry throws `thrown`. */
  const throwing = (thrown: unknown): CacheException =>
    refusal({
      himportFieldsets: [
        {
          get name(): string {
            throw thrown
          },
          fields: []
        }
      ]
    })

  // Scenario: a getter of the host, read inside the driver's constructor, throws a CacheException the host
  // made, or a proxy whose getPrototypeOf trap runs host code.
  // Rule: the driver's construction is never trusted: whatever it throws is dropped, the thrown value is
  // not inspected, and the exception is the library's fixed refusal.
  it('does not pass on an exception the host made', () => {
    const forged = new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'HOSTSECRET-forged'
    })
    const error = throwing(forged)

    expect(error).not.toBe(forged)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({ reason: 'the driver refused an option of the cluster' })
  })

  it('does not run the trap of a proxy it catches', () => {
    let trapRan = false
    const trap = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          trapRan = true
          return null
        }
      }
    )
    const error = throwing(trap)

    expect(trapRan).toBe(false)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({ reason: 'the driver refused an option of the cluster' })
  })
})

describe('what the host wrote, while the driver builds the client', () => {
  // Scenario: the options carry values behind getters of the host (a fieldset name, a script definition),
  // counted as they are read.
  // Rule: every one is read while the options are resolved and none is read again when the client is
  // built, so nothing of the host's runs inside the driver's constructor.
  it('reaches no getter of the host inside the constructor', () => {
    const reads: string[] = []
    const counted = <T>(label: string, value: T): { readonly value: T } => ({
      get value(): T {
        reads.push(label)
        return value
      }
    })
    const name = counted('fieldset.name', 'n1')
    const lua = counted('script.lua', 'return 1')
    const raw = {
      mode: 'cluster',
      cluster: {
        nodes: [{ host: '127.0.0.1', port: 1 }],
        options: {
          lazyConnect: true,
          himportFieldsets: [
            {
              get name(): string {
                return name.value
              },
              fields: ['f1']
            }
          ],
          scripts: {
            demo: {
              get lua(): string {
                return lua.value
              },
              numberOfKeys: 1
            }
          }
        }
      }
    } as unknown as BymaxCacheModuleOptions
    const resolved = resolveOptions(raw)
    const readsBefore = reads.length

    new ConnectionManager(resolved).getClient()

    expect(readsBefore).toBeGreaterThan(0)
    expect(reads).toHaveLength(readsBefore)
  })
})
