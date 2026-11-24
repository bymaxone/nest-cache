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
import { EventEmitter } from 'node:events'
import { createServer as netServer, Socket } from 'node:net'
import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as tlsServer } from 'node:tls'

import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { selfSignedCertificate } from '../../test-helpers/self-signed-certificate'
import { ConnectionManager } from './connection.manager'
import { GuardedConnector } from './guarded-connector'

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
    let connections = 0
    const path = await listenOnPath(
      netServer((socket) => {
        connections += 1
        socket.on('error', () => undefined)
      }),
      'own'
    )
    const connector = new GuardedConnector({ path, port: 1, host: 'nowhere.invalid' })

    const { stream, error } = await settle(connector)
    await new Promise<void>((resolve) => stream?.once('connect', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(error).toBeUndefined()
    expect(stream?.remoteAddress).toBeUndefined()
    expect(connections).toBe(1)
    connector.disconnect()
  })

  // Scenario: the options hold a host, a port and a family, or hold null or nothing for some of them.
  // Rule: Node is handed exactly the names the options hold, no more: a name held as null or undefined is
  // not handed over at all.
  it.each([
    [
      'all three',
      { host: 'h.test', port: 123, family: 4 },
      { host: 'h.test', port: 123, family: 4 }
    ],
    ['a null host and family', { host: null, port: 123, family: null }, { port: 123 }],
    ['a null port', { host: 'h.test', port: null, family: 6 }, { host: 'h.test', family: 6 }],
    ['nothing', {}, {}]
  ])('hands Node %s: its options', async (_label, held, handed) => {
    const netModule = require('node:net') as typeof import('node:net')
    let seen: unknown
    const spy = jest.spyOn(netModule, 'createConnection').mockImplementation(((
      options: unknown
    ) => {
      seen = { ...(options as object) }
      return new netModule.Socket()
    }) as never)
    try {
      const connector = new GuardedConnector(held as never)
      await connector.connect()
      connector.disconnect()
    } finally {
      spy.mockRestore()
    }

    expect(seen).toEqual(handed)
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

describe('the connector with a then planted on a prototype of the socket', () => {
  // Scenario: a `then` appears on EventEmitter.prototype between the call of `connect()` and the tick that
  // resolves it with the socket. Rule: resolving with the socket would call the planted function, so the
  // chain is checked in that tick: the socket is destroyed, the connect refused, nothing forged.
  it('destroys the socket and refuses, and the planted function does not answer for it', async () => {
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port, family: 4 })
    Object.defineProperty(EventEmitter.prototype, 'then', {
      value: (resolve: (value: unknown) => void) => resolve('forged'),
      configurable: true,
      writable: true
    })
    let outcome: { stream?: unknown; error?: unknown }
    try {
      outcome = await settle(connector)
    } finally {
      Reflect.deleteProperty(EventEmitter.prototype, 'then')
    }

    expect(outcome.stream).toBeUndefined()
    expect((outcome.error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    connector.disconnect()
  })

  // Scenario: the prototype of EventEmitter.prototype is replaced by a Proxy whose get answers `then`, which
  // `hasOwn` cannot see. Rule: a Proxy on the chain is refused, the socket destroyed, nothing forged.
  it('refuses a Proxy on the chain of the socket, which answers then through its get trap', async () => {
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port, family: 4 })
    const original = Reflect.getPrototypeOf(EventEmitter.prototype) as object
    const proxy = new Proxy(original, {
      get(target, key, receiver) {
        if (key === 'then') return (resolve: (value: unknown) => void) => resolve('forged')
        return Reflect.get(target, key, receiver) as unknown
      }
    })
    Reflect.setPrototypeOf(EventEmitter.prototype, proxy)
    let outcome: { stream?: unknown; error?: unknown }
    try {
      outcome = await settle(connector)
    } finally {
      Reflect.setPrototypeOf(EventEmitter.prototype, original)
    }

    expect(outcome.stream).toBeUndefined()
    expect((outcome.error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    connector.disconnect()
  })
})

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

describe('a key planted only while the connector is called, and gone before the guard of the next tick', () => {
  // Scenario: a path and a tls are visible on Object.prototype when connect() is called and removed before the
  // next tick; ioredis builds the options of a client with a for...in that copies an enumerable key into them,
  // and starts the first connect in the same synchronous step, so they would be read as the host's.
  // Rule: connect() runs the guard before it reads anything: it is refused, nothing reaches the socket the
  // path names, and no socket is opened.
  it('is refused at the call, and sends nothing to a planted path', async () => {
    let connections = 0
    const attacker = await listenOnPath(
      netServer((socket) => {
        connections += 1
        socket.on('error', () => undefined)
      }),
      'transient'
    )
    const port = await listenOnPort(netServer(answer))
    const connector = new GuardedConnector({ host: '127.0.0.1', port })
    Object.defineProperty(Object.prototype, 'path', {
      value: attacker,
      configurable: true,
      enumerable: true
    })
    Object.defineProperty(Object.prototype, 'tls', {
      value: { rejectUnauthorized: false },
      configurable: true,
      enumerable: true
    })
    let pending: ReturnType<typeof settle>
    try {
      pending = settle(connector)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'path')
      Reflect.deleteProperty(Object.prototype, 'tls')
    }

    const { stream, error } = await pending
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(stream).toBeUndefined()
    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(connections).toBe(0)
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
