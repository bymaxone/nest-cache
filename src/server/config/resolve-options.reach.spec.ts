/**
 * What the option snapshot keeps and refuses: every documented tls option whatever shape the tls
 * object has, the `scripts` list read once, and a named cap on the lists the driver walks.
 *
 * Layer: server. Each row builds the client through `createConnectionManager` or resolves the options
 * directly and asserts what the driver, or the registry, would receive.
 */
import type { Cluster, Redis } from 'ioredis'

import { createConnectionManager } from '../connection/create-connection-manager'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'

/** Builds the client the options describe, without connecting. */
function clientOf(options: Record<string, unknown>): Redis | Cluster {
  return createConnectionManager(options as BymaxCacheModuleOptions).getClient()
}

/** The options a standalone client holds. */
function held(client: Redis | Cluster): Record<string, unknown> {
  return client.options as unknown as Record<string, unknown>
}

const NODES = [{ host: 'a', port: 7000 }]
const SENTINELS = [{ host: 's', port: 26379 }]

/** tls options outside the first security group, each with a value of its own. */
const FIELDS: Array<[string, unknown]> = [
  ['ALPNProtocols', ['h2']],
  ['honorCipherOrder', true],
  ['secureProtocol', 'TLSv1_2_method'],
  ['ecdhCurve', 'prime256v1'],
  ['profile', 'RedisCloudFixed'],
  ['secureOptions', 4],
  ['sigalgs', 'rsa_pss_rsae_sha256'],
  ['dhparam', 'dh'],
  ['sessionTimeout', 300],
  ['requestCert', true]
]

/** The tls object the driver would receive for a `tls` given by the host. */
function tlsOf(tls: unknown): unknown {
  return resolveOptions({ connection: { host: 'h', tls } } as BymaxCacheModuleOptions).connection
    ?.tls
}

describe('tls options whatever the shape of the tls object', () => {
  // Scenario: the tls object is a class whose options sit behind prototype getters.
  // Rule: every documented option is read by name, so none is dropped.
  it.each(FIELDS)('keeps %s of a class with prototype getters', (key, value) => {
    class Tls {
      get ca(): string {
        return 'the-ca'
      }
    }
    Object.defineProperty(Tls.prototype, key, { get: (): unknown => value })

    expect(tlsOf(new Tls())).toEqual({ ca: 'the-ca', [key]: value })
  })

  // Scenario: the tls object is a get-only proxy over an empty target.
  // Rule: the same, so a proxy that serves the options is not read as an empty object.
  it.each(FIELDS)('keeps %s of a get-only proxy over an empty target', (key, value) => {
    const tls = new Proxy({}, { get: (_t, name) => ({ ca: 'the-ca', [key]: value })[String(name)] })

    expect(tlsOf(tls)).toEqual({ ca: 'the-ca', [key]: value })
  })

  // Scenario: the option is defined non-enumerable, or inherited from a prototype object.
  it.each([
    [
      'a non-enumerable property',
      (): object => Object.defineProperty({}, 'honorCipherOrder', { value: true })
    ],
    ['an inherited property', (): object => Object.create({ honorCipherOrder: true }) as object]
  ])('keeps honorCipherOrder given as %s', (_label, make) => {
    expect(tlsOf(make())).toEqual({ honorCipherOrder: true })
  })

  // Scenario: the same tls reaches a client.
  it('hands the client the options of a class with prototype getters', () => {
    class Tls {
      get ALPNProtocols(): string[] {
        return ['h2']
      }
    }
    const client = clientOf({ connection: { host: 'h', lazyConnect: true, tls: new Tls() } })

    expect(held(client)['tls']).toEqual({ ALPNProtocols: ['h2'] })
    client.disconnect()
  })
})

describe('lists the driver walks are capped before they are copied', () => {
  const sparse = (length: number): unknown[] => new Array<unknown>(length)

  // Scenario: a list claims 100 million entries, which a copy would allocate.
  // Rule: it is refused as INVALID_OPTIONS before anything is allocated.
  it.each([
    [
      'sentinel.sentinels',
      { mode: 'sentinel', sentinel: { sentinels: sparse(100_000_000), name: 'master' } }
    ],
    ['cluster.nodes', { mode: 'cluster', cluster: { nodes: sparse(100_000_000) } }],
    ['scripts', { connection: { host: 'h' }, scripts: sparse(100_000_000) }]
  ])('refuses %s of 100 million entries', (option, options) => {
    expect(() => resolveOptions(options as unknown as BymaxCacheModuleOptions)).toThrow(
      expect.objectContaining({
        code: 'cache.invalid_options',
        details: expect.objectContaining({
          reason: `${option} has too many entries`,
          max: 1000
        })
      })
    )
  })

  // Scenario: the list is exactly at the cap and one above it.
  it('accepts 1000 nodes and refuses 1001', () => {
    const nodes = (count: number): unknown[] =>
      Array.from({ length: count }, (_, i) => ({ host: `n${i}`, port: 7000 }))
    const resolved = (count: number): unknown =>
      resolveOptions({
        mode: 'cluster',
        cluster: { nodes: nodes(count) }
      } as BymaxCacheModuleOptions)

    expect(() => resolved(1000)).not.toThrow()
    expect(() => resolved(1001)).toThrow(expect.objectContaining({ code: 'cache.invalid_options' }))
  })
})

describe('scripts are read once', () => {
  // Scenario: the length of the scripts array answers 1 once and 2 afterwards.
  // Rule: the registry is seeded from one answer, so no script that was never read is registered.
  it('keeps the first answer for the length of the scripts list', () => {
    let reads = 0
    const scripts = new Proxy(
      [
        { name: 'one', lua: 'return 1' },
        { name: 'two', lua: 'return 2' }
      ],
      {
        get: (target, key, receiver): unknown =>
          key === 'length' ? (reads++ === 0 ? 1 : 2) : Reflect.get(target, key, receiver)
      }
    )
    const resolved = resolveOptions({
      connection: { host: 'h' },
      scripts
    } as BymaxCacheModuleOptions)

    expect(resolved.scripts).toEqual([{ name: 'one', lua: 'return 1' }])
  })

  // Scenario: the lua of a definition answers one source once and another afterwards.
  it('keeps the first answer for a definition', () => {
    let reads = 0
    const definition = { name: 'one' }
    Object.defineProperty(definition, 'lua', {
      enumerable: true,
      get: (): string => (reads++ === 0 ? 'return 1' : 'return 2')
    })
    const resolved = resolveOptions({
      connection: { host: 'h' },
      scripts: [definition]
    } as unknown as BymaxCacheModuleOptions)

    expect(resolved.scripts).toEqual([{ name: 'one', lua: 'return 1' }])
    expect(reads).toBe(1)
  })
})

describe('a list whose length is not a count is refused, never copied as empty', () => {
  /** An array whose length answers `length`, whatever it holds. */
  const claiming = (length: unknown): unknown[] =>
    new Proxy([{ host: 'x', port: 1 }], {
      get: (target, key, receiver): unknown =>
        key === 'length' ? length : Reflect.get(target, key, receiver)
    })

  const lists: Array<[string, (list: unknown) => unknown]> = [
    [
      'sentinel.sentinels',
      (list) => ({ mode: 'sentinel', sentinel: { sentinels: list, name: 'm' } })
    ],
    ['cluster.nodes', (list) => ({ mode: 'cluster', cluster: { nodes: list } })],
    ['scripts', (list) => ({ connection: { host: 'h' }, scripts: list })]
  ]

  // Scenario: a list reports NaN, a negative, a fractional or an infinite length.
  // Rule: it is refused as INVALID_OPTIONS naming the option, so no list is silently emptied.
  it.each(
    lists.flatMap(([option, make]) =>
      [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY].map(
        (length) => [option, length, make] as const
      )
    )
  )('%s with length %s is refused', (option, length, make) => {
    expect(() =>
      resolveOptions(make(claiming(length)) as unknown as BymaxCacheModuleOptions)
    ).toThrow(
      expect.objectContaining({
        code: 'cache.invalid_options',
        details: expect.objectContaining({ reason: `${option} has an invalid length` })
      })
    )
  })
})
