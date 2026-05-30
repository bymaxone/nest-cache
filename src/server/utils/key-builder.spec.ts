import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from './key-builder'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/**
 * Builds a KeyBuilder from resolved defaults, letting each test override only the
 * namespace/separator it cares about while keeping a valid standalone connection.
 */
const makeBuilder = (overrides: Partial<BymaxCacheModuleOptions> = {}): KeyBuilder =>
  new KeyBuilder(applyDefaults({ connection: { host: 'h' }, ...overrides }))

describe('KeyBuilder', () => {
  // With the defaults, a key is composed as {namespace}{sep}{prefix}{sep}{id} —
  // the structural isolation guarantee every key in the library relies on.
  it('builds a default namespaced key', () => {
    const builder = makeBuilder()

    expect(builder.build('users', 'u_1')).toBe('app:users:u_1')
  })

  // A custom namespace and separator must both feed into the composed key, so a
  // per-tenant namespace and an alternate delimiter are honored.
  it('honors a custom namespace and separator', () => {
    const builder = makeBuilder({ namespace: 'tenant-42', keySeparator: '|' })

    expect(builder.build('users', 'u_1')).toBe('tenant-42|users|u_1')
  })

  // An empty prefix must throw INVALID_KEY — an empty segment would collapse the
  // key structure and break namespacing.
  it('throws INVALID_KEY when the prefix is empty', () => {
    const builder = makeBuilder()

    expect(() => builder.build('', 'id')).toThrow(CacheException)
    try {
      builder.build('', 'id')
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
    }
  })

  // An empty id must also throw INVALID_KEY (the second guard branch).
  it('throws INVALID_KEY when the id is empty', () => {
    const builder = makeBuilder()

    expect(() => builder.build('p', '')).toThrow(CacheException)
    try {
      builder.build('p', '')
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
    }
  })

  // applyNamespace prepends only the namespace to an already-composed key, used
  // by Pub/Sub and script channel namespacing.
  it('applies the namespace to a bare key', () => {
    const builder = makeBuilder()

    expect(builder.applyNamespace('rl:u_1')).toBe('app:rl:u_1')
  })

  // An empty key passed to applyNamespace must throw INVALID_KEY — namespacing a
  // blank key would yield a bare namespace prefix with no target.
  it('throws INVALID_KEY when applyNamespace receives an empty key', () => {
    const builder = makeBuilder()

    expect(() => builder.applyNamespace('')).toThrow(CacheException)
    try {
      builder.applyNamespace('')
    } catch (error) {
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
    }
  })

  // getNamespacePrefix returns {namespace}{sep} for building SCAN match patterns
  // scoped to this namespace.
  it('returns the namespace prefix', () => {
    const builder = makeBuilder()

    expect(builder.getNamespacePrefix()).toBe('app:')
  })
})
