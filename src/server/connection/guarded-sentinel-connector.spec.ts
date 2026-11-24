/**
 * The connector of a sentinel client: the guard before and after the connect, the seal of the listeners of the
 * socket, and the probe clients it builds to ask the sentinels for the master and to watch for a failover.
 *
 * Layer: server. A probe is built from a literal on the default connector of ioredis, which copies an
 * enumerable key visible on `Object.prototype` into its options as an own key while it builds them, so a key
 * planted while the connect waited, or only while the probe was built, would send the probe and the sentinel
 * password to a socket of the attacker. The stock connector of ioredis is run the same way as the control.
 */
import { EventEmitter } from 'node:events'
import { createServer as netServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Stream } from 'node:stream'

import { SentinelConnector } from 'ioredis'

import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import { GuardedConnector, GuardedSentinelConnector, probeConnectorFor } from './guarded-connector'

const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) {
    close()
  }
})

/** Starts a server on a unix socket and returns the path; it is closed after the test. */
async function listenOnPath(server: Server, name: string): Promise<string> {
  const path = join(tmpdir(), `bymax-cache-${process.pid}-${name}.sock`)
  await new Promise<void>((resolve) => server.listen(path, resolve))
  closers.push(() => server.close())
  return path
}

/** Plants `name` on `Object.prototype` for the length of `run`. */
async function planted<T>(name: string, value: unknown, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return await run()
  } finally {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

const SENTINEL_OPTIONS = {
  name: 'm',
  sentinels: [{ host: '127.0.0.1', port: 1 }],
  sentinelPassword: 'SENTPASS'
} as unknown as ConstructorParameters<typeof GuardedSentinelConnector>[0]

/** A socket the way a sentinel connector hands it back: with a table of listeners and a destroy. */
const fakeStream = (): { destroy: jest.Mock; _events: object } => ({
  destroy: jest.fn(),
  _events: { close: undefined }
})

type Probe = { on: (event: string, listener: () => void) => void; disconnect: () => void }

/** How the path of the attacker's socket is visible on Object.prototype while a probe is built. */
type Visibility = 'during' | 'only while it is built' | 'by an accessor that removes itself'

/**
 * Builds a probe client through `connectToSentinel` of `connector` while `path` names `attacker` on
 * Object.prototype in the way `when` says, waits for the probe to try its connect, and returns it.
 */
async function buildProbe(connector: object, attacker: string, when: Visibility): Promise<Probe> {
  const build = (): Probe =>
    (connector as { connectToSentinel: (endpoint: object) => Probe }).connectToSentinel({
      host: '127.0.0.1',
      port: 1
    })
  const wait = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 150))
  let probe: Probe
  if (when === 'during') {
    probe = await planted('path', attacker, async () => {
      const client = build()
      client.on('error', () => undefined)
      await wait()
      return client
    })
    return probe
  }
  let reads = 0
  Object.defineProperty(
    Object.prototype,
    'path',
    when === 'only while it is built'
      ? { value: attacker, configurable: true, enumerable: true, writable: true }
      : {
          configurable: true,
          enumerable: true,
          // ioredis reads the key more than once while it copies it: the value is given on the third read,
          // when the accessor takes itself off.
          get() {
            reads += 1
            if (reads < 3) return undefined
            Reflect.deleteProperty(Object.prototype, 'path')
            return attacker
          }
        }
  )
  try {
    probe = build()
  } finally {
    Reflect.deleteProperty(Object.prototype, 'path')
  }
  probe.on('error', () => undefined)
  await wait()
  return probe
}

describe('the connector of a sentinel client', () => {
  // Scenario: the connect, run with and without a key planted, and a key planted while it waited.
  // Rule: nothing planted, the connect of ioredis runs with the same argument and its socket is returned,
  // its table of listeners sealed; planted before, it is refused before ioredis runs; planted while it
  // waited, the socket is destroyed and the connect refused.
  it('returns the socket of the connect it extends, with its listeners sealed, when nothing is planted', async () => {
    const stream = fakeStream()
    const spy = jest
      .spyOn(SentinelConnector.prototype, 'connect')
      .mockResolvedValue(stream as never)
    try {
      const result = await new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(
        'emitter' as never
      )

      expect(result).toBe(stream)
      expect(spy).toHaveBeenCalledWith('emitter')
      expect(Reflect.getPrototypeOf(stream._events)).toBeNull()
      expect(stream.destroy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('hands back a socket that has no table of listeners as it is', async () => {
    const stream = { destroy: jest.fn() }
    const spy = jest
      .spyOn(SentinelConnector.prototype, 'connect')
      .mockResolvedValue(stream as never)
    try {
      const result = await new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(jest.fn())

      expect(result).toBe(stream)
    } finally {
      spy.mockRestore()
    }
  })

  it('is refused, and the connect it extends does not run, when a key is planted', async () => {
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect')
    try {
      const error = await planted('anything', 1, () =>
        new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(jest.fn()).catch((e: unknown) => e)
      )

      expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('destroys the socket and refuses when a key was planted while it waited', async () => {
    const stream = fakeStream()
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect').mockImplementation(async () => {
      Object.defineProperty(Object.prototype, 'path', { value: 'x', configurable: true })
      await Promise.resolve()
      return stream as never
    })
    let error: unknown
    try {
      await new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(jest.fn())
    } catch (caught) {
      error = caught
    } finally {
      Reflect.deleteProperty(Object.prototype, 'path')
      spy.mockRestore()
    }

    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  // Scenario: a `then` is planted on a prototype of the socket (Stream or EventEmitter) while the connect it
  // extends runs, after that connect resolved. Rule: returning the socket from an async function reads `then`
  // along its whole chain and would call the planted function, so the chain is checked first: the socket is
  // destroyed, the connect refused, and the planted function never answers for it.
  it.each([
    ['Stream.prototype', Stream.prototype],
    ['EventEmitter.prototype', EventEmitter.prototype]
  ])('destroys the socket and refuses when a then is planted on %s', async (_name, owner) => {
    const stream = Object.assign(Object.create(Stream.prototype) as object, fakeStream())
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect').mockImplementation(() => {
      const connected = new Promise((resolve) => resolve(stream))
      Object.defineProperty(owner, 'then', {
        value: (resolve: (value: unknown) => void) => resolve('forged'),
        configurable: true,
        writable: true
      })
      return connected as never
    })
    let outcome: { value?: unknown; error?: unknown }
    try {
      outcome = { value: await new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(jest.fn()) }
    } catch (caught) {
      outcome = { error: caught }
    } finally {
      Reflect.deleteProperty(owner, 'then')
      spy.mockRestore()
    }

    expect(outcome.value).toBeUndefined()
    expect((outcome.error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  // Scenario: the prototype of Stream.prototype is replaced by a Proxy whose get answers `then` for every
  // object that inherits from it, while `hasOwn` on that Proxy reports nothing.
  // Rule: a Proxy anywhere on the chain is refused without calling any of its traps, because resolving with the
  // socket reads `then` through the get trap; the socket is destroyed and the connect refused.
  it('destroys the socket and refuses when a Proxy is on the chain of the socket', async () => {
    const stream = Object.assign(Object.create(Stream.prototype) as object, fakeStream())
    const original = Reflect.getPrototypeOf(Stream.prototype) as object
    const traps: string[] = []
    const proxy = new Proxy(original, {
      get(target, key, receiver) {
        traps.push(String(key))
        if (key === 'then') return (resolve: (value: unknown) => void) => resolve('forged')
        return Reflect.get(target, key, receiver) as unknown
      }
    })
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect').mockImplementation(() => {
      const connected = new Promise((resolve) => resolve(stream))
      Reflect.setPrototypeOf(Stream.prototype, proxy)
      return connected as never
    })
    let outcome: { value?: unknown; error?: unknown }
    try {
      outcome = { value: await new GuardedSentinelConnector(SENTINEL_OPTIONS).connect(jest.fn()) }
    } catch (caught) {
      outcome = { error: caught }
    } finally {
      Reflect.setPrototypeOf(Stream.prototype, original)
      spy.mockRestore()
    }

    expect(outcome.value).toBeUndefined()
    expect((outcome.error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
    expect(traps).toEqual([])
  })

  // Scenario: the manager builds a client in sentinel mode.
  // Rule: it is on the connector of the library, and that connector reports its events through the client.
  it('is the connector of a client the manager builds in sentinel mode, bound to it', () => {
    const manager = new ConnectionManager(
      resolveOptions({
        mode: 'sentinel',
        connection: { lazyConnect: true },
        sentinel: { name: 'm', sentinels: [{ host: '127.0.0.1', port: 1 }] }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as {
      connector: { emitter: unknown }
      disconnect: () => void
    }
    closers.push(() => client.disconnect())

    expect(client.connector).toBeInstanceOf(GuardedSentinelConnector)
    expect(client.connector.emitter).toBe(client)
  })

  // Scenario: the probe clients the connector builds to ask the sentinels for the master and to watch for a
  // failover, from literals, on the default connector of ioredis.
  // Rule: each has the connector of the library and an own undefined for every driver option name.
  it('builds its probe clients on the connector of the library, with an own key for every option name', () => {
    const connector = new GuardedSentinelConnector(SENTINEL_OPTIONS)
    const probe = (
      connector as unknown as {
        connectToSentinel: (endpoint: object) => {
          options: Record<string, unknown>
          disconnect: () => void
          on: (event: string, listener: () => void) => void
        }
      }
    ).connectToSentinel({ host: '127.0.0.1', port: 1 })
    probe.on('error', () => undefined)
    closers.push(() => probe.disconnect())

    expect(probe.options['Connector']).toEqual(expect.any(Function))
    expect(Object.getPrototypeOf(probe.options['Connector'] as object)).toBe(GuardedConnector)
    // `path` is a name ioredis does not set for a probe, so the library defines it.
    expect(Object.getOwnPropertyDescriptor(probe.options, 'path')).toEqual({
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true
    })
    expect(Object.hasOwn(probe.options, 'sentinelPassword')).toBe(true)
  })

  // Scenario: the connector of a probe is made for the sentinel the probe is built for, and its own options say
  // another host, another port and a unix socket (ioredis copies keys into the options of a client while it
  // builds them, and can leave one out).
  // Rule: it connects to the sentinel it was made for, and to nothing its options name.
  it('connects a probe to the endpoint it was made for, whatever its options say', async () => {
    let hits = 0
    const sentinel = netServer((socket: Socket) => {
      hits += 1
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => sentinel.listen(0, '127.0.0.1', resolve))
    closers.push(() => sentinel.close())
    const port = (sentinel.address() as { port: number }).port
    let attackerHits = 0
    const attacker = await listenOnPath(
      netServer((socket: Socket) => {
        attackerHits += 1
        socket.on('error', () => undefined)
      }),
      'destination'
    )
    const Probe = probeConnectorFor({ host: '127.0.0.1', port })
    const connector = new Probe({ host: 'evil.invalid', port: 1, path: attacker } as never)

    const stream = await connector.connect()
    await new Promise<void>((resolve) => stream.once('connect', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 30))
    connector.disconnect()

    expect(stream.remotePort).toBe(port)
    expect(hits).toBe(1)
    expect(attackerHits).toBe(0)
  })

  it('gives a probe the port ioredis gives a sentinel that names none, and keeps the one it names', async () => {
    const seen: Array<{ host?: string; port?: number }> = []
    const netModule = require('node:net') as typeof import('node:net')
    const spy = jest.spyOn(netModule, 'createConnection').mockImplementation(((options: {
      host?: string
      port?: number
    }) => {
      seen.push(options)
      return new netModule.Socket()
    }) as never)
    try {
      for (const endpoint of [{ host: '127.0.0.1' }, { host: '127.0.0.1', port: 26380 }]) {
        const Probe = probeConnectorFor(endpoint)
        const connector = new Probe({} as never)
        await connector.connect()
        connector.disconnect()
      }
    } finally {
      spy.mockRestore()
    }

    expect(seen.map((options) => options.port)).toEqual([26379, 26380])
  })

  // Scenario: a key naming the attacker's unix socket is planted while the connect waits for a slow sentinel,
  // and the next probe client is built after that.
  // Rule: the probe client sends nothing and the sentinel password reaches nobody; the stock connector of
  // ioredis, run the same way, connects to that socket and sends the password (the control).
  it.each([
    ['the connector of the library', GuardedSentinelConnector, 'during', false],
    ['the stock connector of ioredis', SentinelConnector, 'during', true],
    ['the connector of the library', GuardedSentinelConnector, 'only while it is built', false],
    ['the stock connector of ioredis', SentinelConnector, 'only while it is built', true],
    [
      'the connector of the library',
      GuardedSentinelConnector,
      'by an accessor that removes itself',
      false
    ],
    [
      'the stock connector of ioredis',
      SentinelConnector,
      'by an accessor that removes itself',
      true
    ]
  ] as const)(
    'with %s, a probe built with the path planted %s leaks: %s',
    async (_label, Connector, when, leaks) => {
      const received: string[] = []
      let connections = 0
      const attacker = await listenOnPath(
        netServer((socket) => {
          connections += 1
          socket.on('data', (chunk) => received.push(chunk.toString('latin1')))
          socket.on('error', () => undefined)
        }),
        'probe'
      )
      const connector = new Connector(SENTINEL_OPTIONS)

      const probe = await buildProbe(connector, attacker, when)
      probe.disconnect()

      expect(connections > 0).toBe(leaks)
      expect(received.join('').includes('SENTPASS')).toBe(leaks)
    }
  )

  // Scenario: a sentinel client that is not lazy; ioredis starts the first connect inside its constructor.
  // Rule: that first connect goes through the guard too: a key planted while it waited destroys the
  // socket and the client ends; a lazy client is not connected at all.
  const sentinelManager = (connection: Record<string, unknown>): ConnectionManager =>
    new ConnectionManager(
      resolveOptions({
        mode: 'sentinel',
        connection,
        sentinel: { name: 'm', sentinels: [{ host: '127.0.0.1', port: 1 }] }
      } as unknown as BymaxCacheModuleOptions)
    )

  it('guards the first connect of a sentinel client that is not lazy', async () => {
    const stream = { destroy: jest.fn() }
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect').mockImplementation(async () => {
      Object.defineProperty(Object.prototype, 'path', { value: 'x', configurable: true })
      await Promise.resolve()
      return stream as never
    })
    try {
      const client = sentinelManager({}).getClient() as unknown as {
        once: (event: string, listener: (error: { code?: string }) => void) => void
        disconnect: () => void
        status: string
      }
      closers.push(() => client.disconnect())
      const code = await new Promise<string | undefined>((resolve) =>
        client.once('error', (error) => resolve(error.code))
      )

      expect(code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(stream.destroy).toHaveBeenCalledTimes(1)
      expect(client.status).toBe('end')
    } finally {
      Reflect.deleteProperty(Object.prototype, 'path')
      spy.mockRestore()
    }
  })

  // Scenario: a JavaScript host passes a truthy value that is not a boolean for lazyConnect.
  // Rule: it is lazy, as ioredis and the manager's own wait for readiness read it.
  it('reads a truthy lazyConnect as lazy, as ioredis does', () => {
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect')
    try {
      const client = sentinelManager({ lazyConnect: 1 }).getClient() as unknown as {
        disconnect: () => void
        status: string
      }
      closers.push(() => client.disconnect())

      expect(client.status).toBe('wait')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('does not connect a sentinel client that is lazy', () => {
    const spy = jest.spyOn(SentinelConnector.prototype, 'connect')
    try {
      const client = sentinelManager({ lazyConnect: true }).getClient() as unknown as {
        disconnect: () => void
        status: string
      }
      closers.push(() => client.disconnect())

      expect(client.status).toBe('wait')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
