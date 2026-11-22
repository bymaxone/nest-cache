/**
 * The connector the manager gives ioredis: the guard on every connect, the options Node reads, and a real
 * reconnect after a key was planted on `Object.prototype` once the client was built.
 *
 * Layer: server. ioredis opens its socket from an ordinary object it builds in `connect()`, on the first
 * connect and on every reconnect, and Node reads that object with inheritance. A `path` planted after
 * boot redirects the next reconnect to a unix socket; a `ca` makes a server the host never trusted
 * trusted. The guard of the manager runs at build time only, so the connector runs it again, in the tick
 * that opens the socket.
 */
import { createServer as netServer, Socket } from 'node:net'
import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as tlsServer } from 'node:tls'

import { SentinelConnector } from 'ioredis'

import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { selfSignedCertificate } from '../../test-helpers/self-signed-certificate'
import { ConnectionManager } from './connection.manager'
import { GuardedConnector, GuardedSentinelConnector } from './guarded-connector'

const closers: Array<() => void> = []
let certificate = ''
let key = ''

beforeAll(() => {
  ;({ certificate, key } = selfSignedCertificate())
})

afterEach(() => {
  for (const close of closers.splice(0)) {
    close()
  }
})

/** One RESP command per array header; the command's name is the first bulk string after it. */
const COMMAND_START = /(?=\*\d+\r\n\$)/

/** Answers INFO and PING, and every other command a connecting client sends with `+OK`, in order. */
function answer(socket: Socket): void {
  socket.on('error', () => undefined)
  socket.on('data', (chunk: Buffer) => {
    for (const command of chunk.toString('latin1').split(COMMAND_START)) {
      const name = /^\*\d+\r\n\$\d+\r\n(\w+)\r\n/.exec(command)?.[1]?.toUpperCase()
      if (name === 'INFO') {
        const info = '# Server\r\nredis_version:7.2.0\r\nloading:0\r\n'
        socket.write(`$${info.length}\r\n${info}\r\n`)
      } else if (name === 'PING') {
        socket.write('+PONG\r\n')
      } else {
        socket.write('+OK\r\n')
      }
    }
  })
}

/** Starts a server on a port and returns the port; it is closed after the test. */
async function listenOnPort(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => server.close())
  return (server.address() as { port: number }).port
}

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

/** What `connect()` settles to: the stream, or the error it was refused with. */
async function settle(connector: GuardedConnector): Promise<{ stream?: Socket; error?: unknown }> {
  try {
    return { stream: await connector.connect() }
  } catch (error) {
    return { error }
  }
}

describe('the connector, run by hand', () => {
  // Scenario: the options hold a host and a port, then a path, then a TLS block.
  // Rule: it connects to what the options name, as ioredis's own connector does.
  it('connects to a port', async () => {
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port, family: 4 })

    const { stream, error } = await settle(connector)

    await new Promise<void>((resolve) => stream?.once('connect', () => resolve()))

    expect(error).toBeUndefined()
    expect(stream?.remotePort).toBe(port)
    connector.disconnect()
  })

  it('connects to a unix socket when it has a path, ignoring the port', async () => {
    const path = await listenOnPath(netServer(answer), 'own')
    const connector = new GuardedConnector({ path, port: 1, host: 'nowhere.invalid' })

    const { stream, error } = await settle(connector)

    expect(error).toBeUndefined()
    expect(stream?.remoteAddress).toBeUndefined()
    connector.disconnect()
  })

  it('connects over TLS with the options of the host', async () => {
    const port = await listenOnPort(tlsServer({ key, cert: certificate }, answer))
    const connector = new GuardedConnector({
      host: '127.0.0.1',
      port,
      tls: { ca: certificate, servername: 'localhost' }
    })

    const { stream, error } = await settle(connector)
    const secured = await new Promise<boolean>((resolve) => {
      stream?.once('secureConnect', () => resolve(true))
      stream?.once('error', () => resolve(false))
    })

    expect(error).toBeUndefined()
    expect(secured).toBe(true)
    connector.disconnect()
  })

  // Scenario: the options leave out the port, then the host.
  // Rule: only what the options hold is handed to Node: with no port it refuses the options and the
  // connect is rejected with its error; with no host it connects to the local one.
  it('hands Node only the names the options hold', async () => {
    const noPort = await settle(new GuardedConnector({ host: '127.0.0.1' }))
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ port })
    const noHost = await settle(connector)
    await new Promise<void>((resolve) => {
      noHost.stream?.once('connect', () => resolve())
      noHost.stream?.once('error', () => resolve())
    })

    expect((noPort.error as Error).name).toBe('TypeError')
    expect(noHost.error).toBeUndefined()
    connector.disconnect()
  })

  // Scenario: the options hold `null` for a name, which ioredis reads as absent.
  // Rule: it is not handed to Node, which validates the names it is given.
  it('does not hand Node a name the options hold as null', async () => {
    const port = await listenOnPort(netServer(answer))
    const options = { host: null, port, family: null } as unknown as ConstructorParameters<
      typeof GuardedConnector
    >[0]
    const connector = new GuardedConnector(options)

    const { stream, error } = await settle(connector)
    await new Promise<void>((resolve) => {
      stream?.once('connect', () => resolve())
      stream?.once('error', () => resolve())
    })

    expect(error).toBeUndefined()
    connector.disconnect()
  })

  it('has no timeout for the disconnect of an options object that gives none', () => {
    expect(new GuardedConnector({ host: 'h' })).toBeInstanceOf(GuardedConnector)
  })

  // Scenario: the connect is cancelled in the tick before the socket opens (the client was closed).
  // Rule: it is refused with ioredis's own text and no socket is opened.
  it('is refused when it is disconnected before the socket opens', async () => {
    const connector = new GuardedConnector({ host: '127.0.0.1', port: 1 })
    const pending = settle(connector)
    connector.disconnect()

    const { stream, error } = await pending

    expect(stream).toBeUndefined()
    expect((error as Error).message).toBe('Connection is closed.')
  })

  // Scenario: nothing listens on the port.
  // Rule: the first error of the stream is kept, as ioredis reads it to say why the connection failed.
  it('keeps the first error of the stream', async () => {
    const free = netServer()
    const port = await listenOnPort(free)
    await new Promise<void>((resolve) => free.close(() => resolve()))
    const connector = new GuardedConnector({ host: '127.0.0.1', port })

    const { stream } = await settle(connector)
    await new Promise<void>((resolve) => stream?.once('error', () => resolve()))

    expect((connector.firstError as NodeJS.ErrnoException).code).toBe('ECONNREFUSED')
  })
})

/**
 * The `Object.prototype` that the table of listeners of a socket of Node inherits. Node's own code runs in the
 * main realm, which is not the realm of a spec, so a key planted on the `Object.prototype` of the spec is never
 * read by it; the prototype of the table of a fresh socket is the one that is.
 */
const socketRealmPrototype = (): object =>
  Reflect.getPrototypeOf((new Socket() as unknown as { _events: object })._events) as object

/** Plants a string under each of `names` on `target`, runs `run`, and takes them off with a delete. */
function plantedOn<T>(target: object, names: string[], run: () => T): T {
  for (const name of names) {
    Object.defineProperty(target, name, { value: 'PLANTED', configurable: true, enumerable: true })
  }
  try {
    return run()
  } finally {
    for (const name of names) Reflect.deleteProperty(target, name)
  }
}

describe('the table of listeners of the socket', () => {
  // Scenario: a string is planted on Object.prototype under the name of an event after the guard ran; Node
  // reads the listeners of an event with a plain property read of a table that inherits Object.prototype,
  // finds the string, calls it and throws in the event loop.
  // Rule: the table of the socket has no prototype, on a plain and on a TLS socket, so only its own listeners
  // are found: the planted names are inert and a listener of the host's still fires.
  it('has no prototype, on a plain and on a TLS socket, and keeps it', async () => {
    const plain = await listenOnPort(netServer(answer))
    const secure = await listenOnPort(tlsServer({ key, cert: certificate }, answer))
    const connectors = [
      new GuardedConnector({ host: '127.0.0.1', port: plain }),
      new GuardedConnector({
        host: '127.0.0.1',
        port: secure,
        tls: { ca: certificate, servername: 'localhost' }
      })
    ]

    for (const connector of connectors) {
      const { stream } = await settle(connector)
      const table = (): object | null =>
        Reflect.getPrototypeOf((stream as unknown as { _events: object })._events)
      expect(table()).toBeNull()
      stream?.on('anything', () => undefined)
      expect(table()).toBeNull()
      stream?.removeAllListeners('anything')
      expect(table()).toBeNull()
      connector.disconnect()
    }
  })

  it('finds no listener in a string planted under resume, pause, drain or any other event name', async () => {
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port })
    const { stream } = await settle(connector)
    const fired: string[] = []
    stream?.on('arbitrary-event', () => fired.push('arbitrary-event'))
    const names = ['resume', 'pause', 'drain', 'lookup', 'ready', 'arbitrary-other-event']

    const emitted = plantedOn(socketRealmPrototype(), names, () => {
      const results = names.map((name) => stream?.emit(name))
      stream?.emit('arbitrary-event')
      return results
    })

    expect(emitted).toEqual(names.map(() => false))
    expect(fired).toEqual(['arbitrary-event'])
    connector.disconnect()
  })

  it('would throw on the same planted names when the table keeps its prototype', () => {
    const socket = new Socket()
    const names = ['resume', 'lookup', 'ready']

    const thrown = plantedOn(socketRealmPrototype(), names, () => {
      try {
        socket.emit('lookup')
        return undefined
      } catch (error) {
        return error
      }
    })

    expect((thrown as Error).name).toBe('TypeError')
  })
})

describe('the connector with a key planted on Object.prototype after the client was built', () => {
  // Scenario: a `path` is planted, the options name a port.
  // Rule: the connection is refused (INVALID_OPTIONS, the count only); the unix socket the key names
  // never sees a connection, and the connection to the port is not opened either.
  it('refuses to connect, and a planted path reaches no socket', async () => {
    let reached = 0
    const path = await listenOnPath(
      netServer((socket) => {
        reached += 1
        socket.destroy()
      }),
      'planted'
    )
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port })

    const { stream, error } = await planted('path', path, () => settle(connector))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(stream).toBeUndefined()
    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect((error as { details?: unknown }).details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 1
    })
    expect(reached).toBe(0)
  })

  // Scenario: a `ca` is planted, the options name a TLS server whose certificate the host never trusted.
  // Rule: the connection is refused, so the planted certificate does not make that server trusted.
  it('refuses to connect, and a planted ca does not make an untrusted server trusted', async () => {
    const port = await listenOnPort(tlsServer({ key, cert: certificate }, answer))
    const connector = new GuardedConnector({
      host: '127.0.0.1',
      port,
      tls: { servername: 'localhost' }
    })

    const { stream, error } = await planted('ca', certificate, () => settle(connector))

    expect(stream).toBeUndefined()
    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })
})

describe('a real client that reconnects after a key was planted', () => {
  /** The first of `ready` and `error` the client emits next, as `ready` or the error's code. */
  const nextOutcome = (client: {
    once: (event: string, listener: (error?: Error) => void) => void
  }): Promise<string> =>
    new Promise((resolve) => {
      client.once('ready', () => resolve('ready'))
      client.once('error', (error) => resolve((error as { code?: string }).code ?? 'error'))
    })

  const build = (
    port: number
  ): { client: ReturnType<typeof clientOf>; manager: ConnectionManager } => {
    const manager = new ConnectionManager(
      resolveOptions({
        connection: { host: '127.0.0.1', port, retryStrategy: () => 50 }
      } as unknown as BymaxCacheModuleOptions)
    )
    return { client: clientOf(manager), manager }
  }
  const clientOf = (manager: ConnectionManager) =>
    manager.getClient() as unknown as {
      once: (event: string, listener: (error?: Error) => void) => void
      on: (event: string, listener: (error?: Error) => void) => void
      disconnect: (reconnect?: boolean) => void
      ping: () => Promise<string>
    }

  // Scenario: a normal reconnect, nothing planted.
  // Rule: the client becomes ready again and answers a PING.
  it('becomes ready again when nothing is planted', async () => {
    const port = await listenOnPort(netServer(answer))
    const { client } = build(port)
    closers.push(() => client.disconnect())
    client.on('error', () => undefined)
    expect(await nextOutcome(client)).toBe('ready')

    const again = nextOutcome(client)
    client.disconnect(true)

    expect(await again).toBe('ready')
    expect(await client.ping()).toBe('PONG')
  })

  // Scenario: a `path` is planted after the client was ready, then the connection drops.
  // Rule: the reconnect is refused and the unix socket the key names sees no connection.
  it('does not reconnect to a planted path', async () => {
    let reached = 0
    const path = await listenOnPath(
      netServer((socket) => {
        reached += 1
        socket.destroy()
      }),
      'reconnect'
    )
    const port = await listenOnPort(netServer(answer))
    const { client } = build(port)
    closers.push(() => client.disconnect())
    client.on('error', () => undefined)
    expect(await nextOutcome(client)).toBe('ready')

    const outcome = await planted('path', path, async () => {
      const next = nextOutcome(client)
      client.disconnect(true)
      return next
    })
    const status = (client as unknown as { status: string }).status
    client.disconnect()

    expect(outcome).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(reached).toBe(0)
    // ioredis ends a client whose connector rejects: it is not retried, so it is not used again.
    expect(status).toBe('end')
  })
})

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

    expect(probe.options['Connector']).toBe(GuardedConnector)
    expect(Object.hasOwn(probe.options, 'socketTimeout')).toBe(true)
    expect(Object.hasOwn(probe.options, 'sentinelPassword')).toBe(true)
  })

  // Scenario: a key naming the attacker's unix socket is planted while the connect waits for a slow sentinel,
  // and the next probe client is built after that.
  // Rule: the probe client sends nothing and the sentinel password reaches nobody; the stock connector of
  // ioredis, run the same way, connects to that socket and sends the password (the control).
  it.each([
    ['the connector of the library', GuardedSentinelConnector, false],
    ['the stock connector of ioredis', SentinelConnector, true]
  ] as const)(
    'with %s, a probe built after a planted path leaks: %s',
    async (_label, Connector, leaks) => {
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
      const build = (): { on: (e: string, l: () => void) => void; disconnect: () => void } =>
        (
          connector as unknown as {
            connectToSentinel: (endpoint: object) => ReturnType<typeof build>
          }
        ).connectToSentinel({ host: '127.0.0.1', port: 1 })

      const probe = await planted('path', attacker, async () => {
        const client = build()
        client.on('error', () => undefined)
        await new Promise((resolve) => setTimeout(resolve, 150))
        return client
      })
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

describe('the connector in the options the manager hands ioredis', () => {
  // Scenario: a cluster client; the nodes are built by ioredis from `redisOptions`.
  // Rule: that is where the connector is, so every node connects through it.
  it('is in the redisOptions of a cluster', () => {
    const manager = new ConnectionManager(
      resolveOptions({
        mode: 'cluster',
        cluster: { nodes: [{ host: '127.0.0.1', port: 1 }], options: { lazyConnect: true } }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as {
      options: { redisOptions: { Connector: unknown } }
      disconnect: () => void
    }
    closers.push(() => client.disconnect())

    expect(client.options.redisOptions.Connector).toBe(GuardedConnector)
  })

  // Scenario: the host puts a connector in the connection block of a standalone client.
  // Rule: it is not read; the library's is the one used (the host can only give one to cluster nodes).
  it('is the connector of a standalone client whatever the connection block holds', () => {
    class Own {}
    const manager = new ConnectionManager(
      resolveOptions({
        connection: { host: '127.0.0.1', lazyConnect: true, Connector: Own }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as {
      options: { Connector: unknown }
      disconnect: () => void
    }
    closers.push(() => client.disconnect())

    expect(client.options.Connector).toBe(GuardedConnector)
  })

  // Scenario: the host gives its own connector in the options of the nodes.
  // Rule: the host's is the one used; the library's is only the default.
  it('is not the one used when the host gave a connector of its own', () => {
    class Own {}
    const manager = new ConnectionManager(
      resolveOptions({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: '127.0.0.1', port: 1 }],
          options: { lazyConnect: true, redisOptions: { Connector: Own } }
        }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as {
      options: { redisOptions: { Connector: unknown } }
      disconnect: () => void
    }
    closers.push(() => client.disconnect())

    expect(client.options.redisOptions.Connector).toBe(Own)
  })
})
