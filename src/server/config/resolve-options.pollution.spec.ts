/**
 * What a key planted on `Object.prototype` does to the options the host supplied.
 *
 * Layer: server. A property access on a plain object also finds what another part of the process
 * planted on `Object.prototype`, so an option the host left out takes the planted value. A key counts
 * only when the host's object, or a prototype between it and the realm's root, holds it. The sweep
 * plants every key the library reads, one at a time, and the options must resolve exactly as without it.
 */
import { runInNewContext } from 'node:vm'
import { inspect } from 'node:util'

import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS } from '../connection/copy-cluster-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { OPTION_KEYS, resolveOptions } from './default-options'
import {
  CLUSTER_KEYS,
  ENTRY_KEYS,
  SCRIPT_KEYS,
  SENTINEL_KEYS,
  STANDALONE_KEYS,
  TLS_KEYS
} from './snapshot-blocks'

type Raw = Record<string, unknown>

/** The shapes of options the sweep resolves: each reads a different part of the key lists. */
const SHAPES: Record<string, () => Raw> = {
  standalone: () => ({ connection: { host: 'h' } }),
  standaloneFull: () => ({
    mode: 'standalone',
    namespace: 'n',
    connection: {
      host: 'h',
      port: 6379,
      tls: { ca: 'x', rejectUnauthorized: true },
      password: 'p'
    },
    scripts: [{ name: 'a', lua: 'return 1' }]
  }),
  url: () => ({ connection: { url: 'redis://h:6379' } }),
  sentinel: () => ({
    mode: 'sentinel',
    sentinel: {
      sentinels: [{ host: 's', port: 26379 }],
      name: 'm',
      natMap: { 'a:1': { host: 'b', port: 2 } }
    }
  }),
  cluster: () => ({
    mode: 'cluster',
    cluster: {
      nodes: [{ host: 'a', port: 7000 }],
      options: {
        redisOptions: { tls: { ca: 'x' } },
        himportFieldsets: [{ name: 'n', fields: ['f'] }],
        scripts: { s: { lua: 'return 1', numberOfKeys: 1 } }
      }
    }
  })
}

/** Every key the library reads from the host's objects: the top level, each group and each entry. */
const KEYS = [
  ...new Set([
    ...Object.keys(OPTION_KEYS),
    ...Object.keys(STANDALONE_KEYS),
    ...Object.keys(SENTINEL_KEYS),
    ...Object.keys(CLUSTER_KEYS),
    ...Object.keys(TLS_KEYS),
    ...Object.keys(CLUSTER_OPTION_KEYS),
    ...Object.keys(REDIS_OPTION_KEYS),
    ...Object.keys(SCRIPT_KEYS),
    ...Object.keys(ENTRY_KEYS),
    'name',
    'fields',
    'lua',
    'numberOfKeys',
    'readOnly',
    'pem',
    'buf',
    'passphrase'
  ])
].sort()

const VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['a string', 'PLANTED'],
  ['a number', 7],
  ['an object', { planted: true }],
  ['true', true]
]

/** What resolving `shape` gives or throws, as text, so two results compare. */
function outcome(raw: Raw): string {
  try {
    return inspect(resolveOptions(raw as unknown as BymaxCacheModuleOptions), {
      depth: 12,
      breakLength: Infinity,
      maxArrayLength: 50
    })
  } catch (error) {
    const thrown = error as { code?: string; details?: { reason?: string } }
    return `throws ${thrown.code} ${thrown.details?.reason}`
  }
}

/** Resolves `make()` with `key` planted on `Object.prototype`, taking it off again. */
function withPlanted(key: string, value: unknown, make: () => Raw): string {
  Object.defineProperty(Object.prototype, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: false
  })
  try {
    return outcome(make())
  } finally {
    Reflect.deleteProperty(Object.prototype, key)
  }
}

describe('a key planted on Object.prototype', () => {
  // Scenario: another part of the process plants a key the library reads, with the host's options not
  // holding it. Rule: the options resolve exactly as without it, for every key and every shape.
  describe.each(Object.keys(SHAPES))('with the %s options', (shape) => {
    const make = SHAPES[shape] as () => Raw
    const base = outcome(make())

    it.each(KEYS)('changes nothing when %s is planted', (key) => {
      for (const [label, value] of VALUES) {
        expect([key, label, withPlanted(key, value, make)]).toEqual([key, label, base])
      }
    })
  })

  // Scenario: the four consequences that matter most. Rule: none of them happens.
  it('does not redirect the connection to a planted url', () => {
    const planted = withPlanted('url', 'redis://evil:1', () => ({ connection: { host: 'h' } }))

    expect(planted).not.toContain('evil')
  })

  it('does not take a planted namespace', () => {
    expect(withPlanted('namespace', 'PLANTED', SHAPES['standalone'] as () => Raw)).not.toContain(
      'PLANTED'
    )
  })

  it('does not register planted scripts', () => {
    const planted = withPlanted(
      'scripts',
      [{ name: 'evil', lua: 'return 1' }],
      SHAPES['standalone'] as () => Raw
    )

    expect(planted).not.toContain('evil')
  })

  it('does not take a planted serializer', () => {
    const planted = withPlanted(
      'serializer',
      { serialize: () => 'x' },
      SHAPES['standalone'] as () => Raw
    )

    expect(planted).toContain('serializer: undefined')
  })
})

describe('a key the host did put', () => {
  // Scenario: the host's options object holds `namespace` on itself, on its class, on a prototype it was
  // made over, or it comes from another realm. Rule: the value is read as before.
  class Holder {
    connection = { host: 'h' }
    get namespace(): string {
      return 'fromClass'
    }
  }
  const made = (proto: object): Raw =>
    Object.assign(Object.create(proto) as Raw, { connection: { host: 'h' } })

  it.each([
    ['an own key', (): unknown => ({ connection: { host: 'h' }, namespace: 'own' }), 'own'],
    ['a class getter', (): unknown => new Holder(), 'fromClass'],
    ['a prototype', (): unknown => made({ namespace: 'fromProto' }), 'fromProto'],
    [
      'another realm',
      (): unknown => runInNewContext('({ connection: { host: "h" }, namespace: "otherRealm" })'),
      'otherRealm'
    ]
  ])('is read from %s', (_label, make, expected) => {
    expect(resolveOptions(make() as BymaxCacheModuleOptions).namespace).toBe(expected)
  })

  it('is read from a proxy that answers for the key', () => {
    const proxy = new Proxy(
      {},
      { get: (_t, name) => ({ connection: { host: 'h' }, namespace: 'fromProxy' })[String(name)] }
    )

    expect(resolveOptions(proxy as unknown as BymaxCacheModuleOptions).namespace).toBe('fromProxy')
  })
})
