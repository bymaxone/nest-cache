/**
 * Unit tests for what {@link ConnectionManager} hands to ioredis when an option is spelled out but
 * unset: an explicit `undefined`, or a `null`, on every option that has a default, in every group.
 *
 * Layer: server. An unset option means the library default, never "no bound" or `NaN`: a key that
 * is present and holds `undefined` must not replace the default the way an object spread does.
 */
import { EventEmitter } from 'node:events'

import { applyDefaults, validateOptions } from '../config/default-options'
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_KEEP_ALIVE_MS,
  DEFAULT_MAX_RETRIES_PER_REQUEST,
  DISCONNECT_TIMEOUT_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from './connection.manager'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

interface Captured extends EventEmitter {
  status: string
  options: Record<string, unknown>
  quit: jest.Mock
  disconnect: jest.Mock
}

// `var`: initialised before the hoisted import runs the mock factory (see connection.manager.spec).
var redisInstances: Captured[]
var clusterInstances: Captured[]

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      redisInstances.push(this as unknown as Captured)
    }
  }
  class FakeCluster extends EventEmitter {
    status = 'wait'
    options: Record<string, unknown>
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    constructor(_nodes: unknown, options: Record<string, unknown>) {
      super()
      this.options = options
      clusterInstances.push(this as unknown as Captured)
    }
  }
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeCluster, default: FakeRedis }
})

beforeEach(() => {
  redisInstances = []
  clusterInstances = []
})

/** The options ioredis was constructed with, for `options` validated and resolved as a host would. */
function built(raw: unknown): Record<string, unknown> {
  redisInstances = []
  clusterInstances = []
  const options = raw as BymaxCacheModuleOptions
  validateOptions(options)
  new ConnectionManager(applyDefaults(options)).getClient()
  return (redisInstances[0] ?? clusterInstances[0])?.options as Record<string, unknown>
}

const UNSET = [undefined, null] as const

/** Standalone: each option of `connection` that has a default, with the value the driver gets. */
const STANDALONE_DEFAULTS: ReadonlyArray<readonly [string, unknown]> = [
  ['lazyConnect', false],
  ['connectTimeout', DEFAULT_CONNECT_TIMEOUT_MS],
  ['commandTimeout', DEFAULT_COMMAND_TIMEOUT_MS],
  ['enableReadyCheck', true],
  ['enableOfflineQueue', false],
  ['keepAlive', DEFAULT_KEEP_ALIVE_MS],
  ['noDelay', true],
  ['family', 4]
]

describe('a standalone connection option that is spelled out but unset', () => {
  // Scenario: the option is present and holds undefined or null.
  // Rule: the driver receives the library default, exactly as if the key were absent.
  describe.each(STANDALONE_DEFAULTS)('%s', (option, expected) => {
    it.each(UNSET)('resolves %p to the default', (value) => {
      const options = built({
        connection: { host: 'h', [option]: value }
      } as unknown)

      expect(options[option]).toBe(expected)
    })
  })

  // Scenario: maxRetriesPerRequest is spelled out as undefined.
  // Rule: the default bound applies; null is a different matter (the driver's "retry forever"), and
  // stays refused with its reason.
  it('resolves an explicit undefined maxRetriesPerRequest to the default and still refuses null', () => {
    const options = built({
      connection: { host: 'h', maxRetriesPerRequest: undefined }
    } as unknown)

    expect(options['maxRetriesPerRequest']).toBe(DEFAULT_MAX_RETRIES_PER_REQUEST)
    expect(() =>
      validateOptions({ connection: { host: 'h', maxRetriesPerRequest: null } } as never)
    ).toThrow()
  })

  // Scenario: port and db are unset by an explicit null or undefined; a credential or tls only by
  // undefined, because a null there is refused (see the credential table below).
  // Rule: none of them reaches the driver as a key holding nothing.
  it.each([
    ['port', UNSET],
    ['db', UNSET],
    ['password', [undefined]],
    ['username', [undefined]],
    ['tls', [undefined]]
  ] as const)('does not pass %s when it is unset', (option, values) => {
    for (const value of values) {
      const options = built({
        connection: { host: 'h', [option]: value }
      } as unknown)

      expect(options[option]).toBeUndefined()
    }
  })
})

describe('a cluster option that is spelled out but unset', () => {
  const cluster = (extra: Record<string, unknown>, redisOptions: Record<string, unknown>) =>
    ({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'n', port: 6379 }], options: { ...extra, redisOptions } }
    }) as unknown

  // Scenario: a cluster timer or bound is spelled out as undefined or null.
  // Rule: the default applies, so a command stays bounded: an explicit undefined must never replace a
  // default with "no bound".
  describe.each([
    ['connectTimeout', DEFAULT_CONNECT_TIMEOUT_MS],
    ['commandTimeout', DEFAULT_COMMAND_TIMEOUT_MS],
    ['disconnectTimeout', DISCONNECT_TIMEOUT_MS]
  ] as const)('redisOptions.%s', (option, expected) => {
    it.each(UNSET)('resolves %p to the default', (value) => {
      const options = built(cluster({}, { [option]: value }))

      expect((options['redisOptions'] as Record<string, unknown>)[option]).toBe(expected)
    })
  })

  it('resolves an explicit undefined redisOptions.maxRetriesPerRequest to the default', () => {
    const options = built(cluster({}, { maxRetriesPerRequest: undefined }))

    expect((options['redisOptions'] as Record<string, unknown>)['maxRetriesPerRequest']).toBe(
      DEFAULT_MAX_RETRIES_PER_REQUEST
    )
  })

  it.each(UNSET)('resolves an explicit %p enableOfflineQueue to false', (value) => {
    const options = built(cluster({ enableOfflineQueue: value }, {}))

    expect(options['enableOfflineQueue']).toBe(false)
  })

  // Scenario: the group is a class instance whose values sit behind prototype getters.
  // Rule: a set value is honoured and an unset one resolves to the default, because each known key is
  // read by property access; an enumeration of own keys would miss the getters.
  it('reads the known keys of a class-instance redisOptions through its getters', () => {
    class Timers {
      get commandTimeout(): number {
        return 750
      }
      get connectTimeout(): undefined {
        return undefined
      }
    }

    const options = built(cluster({}, new Timers() as unknown as Record<string, unknown>))
    const redisOptions = options['redisOptions'] as Record<string, unknown>

    expect(redisOptions['commandTimeout']).toBe(750)
    expect(redisOptions['connectTimeout']).toBe(DEFAULT_CONNECT_TIMEOUT_MS)
  })

  it('reads the known keys of a class-instance connection group through its getters', () => {
    class Connection {
      host = 'h'
      get commandTimeout(): number {
        return 750
      }
      get keepAlive(): null {
        return null
      }
    }

    const options = built({ connection: new Connection() } as unknown as unknown)

    expect(options['commandTimeout']).toBe(750)
    expect(options['keepAlive']).toBe(DEFAULT_KEEP_ALIVE_MS)
  })
})

describe('a class-instance cluster group that carries its values behind getters', () => {
  // Scenario: the host builds `cluster.options.redisOptions` and `cluster.options` as class instances
  // whose values, secrets included, sit behind prototype getters.
  // Rule: every documented key reaches the driver, because each is read by property access from a typed
  // key list; the spread of a class instance would drop them, and the client would then connect without
  // the password or without tls (the validator reads these keys by property access too).
  it('hands a getter-backed password, username and tls to the driver', () => {
    const tls = { servername: 'redis.internal' }
    class Secrets {
      get password(): string {
        return 'from-a-getter'
      }
      get username(): string {
        return 'app'
      }
      get tls(): typeof tls {
        return tls
      }
      get keyPrefix(): string {
        return 'p:'
      }
    }
    const options = built({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'n', port: 6379 }], options: { redisOptions: new Secrets() } }
    })
    const redisOptions = options['redisOptions'] as Record<string, unknown>

    expect(redisOptions['password']).toBe('from-a-getter')
    expect(redisOptions['username']).toBe('app')
    expect(redisOptions['tls']).toBe(tls)
    expect(redisOptions['keyPrefix']).toBe('p:')
  })

  it('hands the getter-backed keys of a class-instance cluster.options to the driver', () => {
    class Options {
      get scaleReads(): string {
        return 'slave'
      }
      get slotsRefreshTimeout(): number {
        return 1234
      }
      get enableOfflineQueue(): boolean {
        return true
      }
    }
    const options = built({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'n', port: 6379 }], options: new Options() }
    })

    expect(options['scaleReads']).toBe('slave')
    expect(options['slotsRefreshTimeout']).toBe(1234)
    expect(options['enableOfflineQueue']).toBe(true)
  })
})

describe('a cluster group that is null', () => {
  // Scenario: `cluster.options`, or `cluster.options.redisOptions`, is null.
  // Rule: the group counts as absent, so the client boots with the library defaults.
  it.each([
    ['cluster.options', null],
    ['cluster.options.redisOptions', { redisOptions: null }]
  ])('boots with the defaults when %s is null', (_name, group) => {
    const options = built({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'n', port: 6379 }], options: group }
    })
    const redisOptions = options['redisOptions'] as Record<string, unknown>

    expect(options['enableOfflineQueue']).toBe(false)
    expect(redisOptions['commandTimeout']).toBe(DEFAULT_COMMAND_TIMEOUT_MS)
    expect(redisOptions['connectTimeout']).toBe(DEFAULT_CONNECT_TIMEOUT_MS)
  })
})

describe('an own key of a cluster group that the typed lists do not name', () => {
  // Scenario: the host passes an option a newer ioredis added, or one the declarations lag behind.
  // Rule: it reaches the driver as given, in `cluster.options` and in `redisOptions`.
  it('forwards it to ioredis', () => {
    const options = built({
      mode: 'cluster',
      cluster: {
        nodes: [{ host: 'n', port: 6379 }],
        options: { futureClusterOption: 'a', redisOptions: { futureNodeOption: 'b' } }
      }
    })

    expect(options['futureClusterOption']).toBe('a')
    expect((options['redisOptions'] as Record<string, unknown>)['futureNodeOption']).toBe('b')
  })
})

describe('a sentinel option that is spelled out but unset', () => {
  // Scenario: an optional sentinel field is present and holds undefined or null.
  // Rule: it is not passed to the driver, so a null password is never sent as one.
  it.each([
    ['password', [undefined]],
    ['sentinelPassword', [undefined]],
    ['role', UNSET],
    ['natMap', UNSET]
  ] as const)('does not pass %s', (field, values) => {
    for (const value of values) {
      const options = built({
        mode: 'sentinel',
        sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'm', [field]: value }
      } as unknown)

      expect(options[field]).toBeUndefined()
    }
  })
})

describe('the module-level options that are spelled out but unset', () => {
  // Scenario: a top-level option with a default is present and holds undefined or null.
  // Rule: it resolves to the default.
  it.each(UNSET)('resolves %p for every defaulted top-level option', (value) => {
    const options = {
      connection: { host: 'h' },
      mode: value,
      namespace: value,
      keySeparator: value,
      keyEscaping: value,
      shutdownTimeoutMs: value,
      allowFlushInProduction: value,
      isGlobal: value,
      pubsubMaxConcurrentHandlers: value,
      pubsubMaxQueuedMessages: value
    } as unknown as BymaxCacheModuleOptions

    expect(() => validateOptions(options)).not.toThrow()
    expect(applyDefaults(options)).toMatchObject({
      mode: 'standalone',
      keyEscaping: 'legacy',
      allowFlushInProduction: false,
      isGlobal: true
    })
    expect(applyDefaults(options).pubsubMaxConcurrentHandlers).toBeUndefined()
    expect(applyDefaults(options).pubsubMaxQueuedMessages).toBeUndefined()
  })
})

/** Every credential or tls field, with the options that carry a `null` in it. */
const SECRET_SPELLINGS: ReadonlyArray<readonly [string, (value: unknown) => unknown]> = [
  ['connection.password', (v) => ({ connection: { host: 'h', password: v } })],
  ['connection.username', (v) => ({ connection: { host: 'h', username: v } })],
  ['connection.tls', (v) => ({ connection: { host: 'h', tls: v } })],
  [
    'sentinel.password',
    (v) => ({
      mode: 'sentinel',
      sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'm', password: v }
    })
  ],
  [
    'sentinel.sentinelPassword',
    (v) => ({
      mode: 'sentinel',
      sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'm', sentinelPassword: v }
    })
  ],
  ...(['password', 'username', 'tls'] as const).map(
    (field) =>
      [
        `cluster.options.redisOptions.${field}`,
        (v: unknown) => ({
          mode: 'cluster',
          cluster: { nodes: [{ host: 'n', port: 6379 }], options: { redisOptions: { [field]: v } } }
        })
      ] as const
  )
]

describe('a credential or tls field that is null', () => {
  // Scenario: a secret that failed to load reaches the options as null, for instance from a config
  // service that returned nothing.
  // Rule: it is refused at startup, naming the field and the type, because its default is the weaker
  // posture: the connection would open without authentication or without tls. Only undefined is unset.
  it.each(SECRET_SPELLINGS)('refuses null in %s', (name, build) => {
    let thrown: unknown
    try {
      validateOptions(build(null) as BymaxCacheModuleOptions)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheException)
    expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect((thrown as CacheException).details).toMatchObject({ option: name, received: 'null' })
  })

  it.each(SECRET_SPELLINGS)('accepts an undefined %s as unset', (_name, build) => {
    expect(() => validateOptions(build(undefined) as BymaxCacheModuleOptions)).not.toThrow()
  })
})
