/**
 * What a key planted on `Object.prototype` does to the client the connection manager builds.
 *
 * Layer: server. The manager reads the resolved `connection` block even when the host left it out
 * (a sentinel or a cluster), and a read of a key that block does not hold must not find what another
 * part of the process planted on `Object.prototype`: a planted `url` would redirect the client. The
 * driver is a recording fake: what the library hands to its constructors is what is compared, and
 * what the real driver does with its own copy of the options is the driver's business.
 */
import { EventEmitter } from 'node:events'

import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'

type Raw = Record<string, unknown>

interface Captured {
  options: Record<string, unknown>
  disconnect: jest.Mock
}

// `var`: initialised before the hoisted import runs the mock factory (see connection.manager.spec).
var created: Captured[] = []

// The refusal to build while Object.prototype holds a key (driver-guard.spec.ts) would stop every
// row here before the library read anything; it is switched off so that the reads of the library itself,
// of the options it hands to the driver and of an omitted connection block, are what is compared.
jest.mock('./driver-option-names', () => ({
  ...jest.requireActual<typeof import('./driver-option-names')>('./driver-option-names'),
  assertDriverUnshadowed: (): void => undefined
}))

jest.mock('ioredis', () => {
  class Fake extends EventEmitter {
    status = 'wait'
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    connector = { connect: jest.fn() }
    constructor(...args: unknown[]) {
      super()
      this.options = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown>
      created.push(this as unknown as Captured)
    }
  }
  return {
    __esModule: true,
    AbstractConnector: jest.requireActual<typeof import('ioredis')>('ioredis').AbstractConnector,
    Redis: Fake,
    Cluster: Fake,
    default: Fake
  }
})

beforeEach(() => {
  created = []
})

const SHAPES: Record<string, () => Raw> = {
  standalone: () => ({ connection: { host: 'h', lazyConnect: true } }),
  sentinel: () => ({
    mode: 'sentinel',
    sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'm' }
  }),
  cluster: () => ({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options: { lazyConnect: true } }
  })
}

/** Every key the manager reads from the connection block, planted one at a time. */
const KEYS = [
  'url',
  'host',
  'port',
  'password',
  'username',
  'db',
  'tls',
  'family',
  'retryStrategy',
  'reconnectOnError',
  'lazyConnect',
  'connectTimeout',
  'commandTimeout',
  'keepAlive',
  'noDelay',
  'maxRetriesPerRequest',
  'enableOfflineQueue',
  'enableReadyCheck'
]

const VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['an address', 'redis://:secret@evil:1/3'],
  ['a number', 7],
  ['an object', { planted: true }]
]

/** The options the client was built with, read for every key the spec plants. */
function built(make: () => Raw): string {
  try {
    const manager = new ConnectionManager(
      resolveOptions({ ...make() } as unknown as BymaxCacheModuleOptions)
    )
    manager.getClient()
    const o = (created[0] as Captured).options
    // Every planted key is read from the options object and from the cluster's redisOptions, functions
    // shown as a word, so a key the object inherits from Object.prototype always shows in the text.
    const read = (object: unknown): Record<string, unknown> =>
      Object.fromEntries(
        KEYS.map((key) => [key, (object as Record<string, unknown> | undefined)?.[key]])
      )
    const text = JSON.stringify(
      { options: read(o), redisOptions: read(o['redisOptions']), sentinels: o['sentinels'] },
      (_key, value: unknown) => (typeof value === 'function' ? '[function]' : value)
    )
    return text
  } catch (error) {
    return `throws ${(error as { code?: string }).code}`
  }
}

/** Builds the client with `key` planted on `Object.prototype`, taking it off again. */
function withPlanted(key: string, value: unknown, make: () => Raw): string {
  Object.defineProperty(Object.prototype, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: false
  })
  try {
    return built(make)
  } finally {
    Reflect.deleteProperty(Object.prototype, key)
  }
}

describe.each(Object.keys(SHAPES))('the client of the %s options', (shape) => {
  const make = SHAPES[shape] as () => Raw

  // Scenario: another part of the process plants a connection option the host did not set.
  // Rule: the client is built exactly as without it, so a planted url redirects nothing.
  it.each(KEYS)('is built as without it when %s is planted', (key) => {
    const base = built(make)
    expect(base).not.toContain('throws')
    for (const [label, value] of VALUES) {
      expect([key, label, withPlanted(key, value, make)]).toEqual([key, label, base])
    }
  })
})
