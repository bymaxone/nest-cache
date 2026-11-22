/**
 * The options the driver itself refuses when a cluster client is built.
 *
 * Layer: server. ioredis throws its own error for an option it cannot use, and for `scaleReads` the
 * message prints the value the host gave. Each such refusal ends as INVALID_OPTIONS with the library's
 * code, and no part of the host's value appears in the exception, its details, its message or what a
 * logger renders from it. Nothing here mocks the driver: its constructor is what refuses.
 */
import { inspect } from 'node:util'

import { applyDefaults, validateOptions } from '../config/default-options'
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
  ['scaleReads', { scaleReads: SECRET }],
  ['himportFieldsets given as a string', { himportFieldsets: SECRET }],
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
