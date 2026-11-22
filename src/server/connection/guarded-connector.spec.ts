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
import { createServer as netServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as tlsServer } from 'node:tls'

import { SentinelConnector } from 'ioredis'

import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { selfSignedCertificate } from '../../test-helpers/self-signed-certificate'
import { ConnectionManager } from './connection.manager'
import { GuardedConnector, guardSentinelConnector } from './guarded-connector'

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

const UNHEARD = [
  'connect',
  'connectionAttempt',
  'connectionAttemptFailed',
  'connectionAttemptTimeout',
  'lookup',
  'ready'
]

describe('the events Node emits on the socket that nothing listens to', () => {
  // Scenario: a string is planted on Object.prototype under the name of one of those events after the guard
  // ran; Node reads the listeners of an event with a plain property read and calls the string.
  // Rule: the socket has a listener of its own for each of them, so the read finds it.
  it('has a listener for each of them, on a plain and on a TLS socket', async () => {
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
      for (const event of UNHEARD) {
        expect(stream?.listenerCount(event)).toBeGreaterThan(0)
      }
      connector.disconnect()
    }
  })

  // A string planted from a spec lands on the Object.prototype of the spec's realm, not on the one the socket
  // code of Node reads, so the rows pin the listeners and a child process reproduces the read itself.
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

describe('the guard on the connector a sentinel client builds for itself', () => {
  // Scenario: the wrapped connect, run with and without a key planted.
  // Rule: nothing planted, the original connect runs with the same arguments and its result is returned;
  // planted, it is refused before the original runs.
  it('calls the connect it wraps when nothing is planted', async () => {
    const stream = { on: jest.fn() }
    const original = jest.fn().mockResolvedValue(stream)
    const client = { connector: { connect: original } }
    guardSentinelConnector(client)

    const result = await (
      client.connector.connect as unknown as (...args: unknown[]) => Promise<unknown>
    )('emitter')

    expect(result).toBe(stream)
    expect(original).toHaveBeenCalledWith('emitter')
  })

  it('is refused, and the connect it wraps does not run, when a key is planted', async () => {
    const original = jest.fn().mockResolvedValue('stream')
    const client = { connector: { connect: original } }
    guardSentinelConnector(client)

    const error = await planted('anything', 1, () =>
      (client.connector.connect as unknown as () => Promise<unknown>)().catch((e: unknown) => e)
    )

    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(original).not.toHaveBeenCalled()
  })

  // Scenario: the connect it wraps waits (the sentinels are asked for the master) and a key is planted
  // while it waits, before the socket is opened from what they answered.
  // Rule: the socket is destroyed before ioredis uses it and the connect is refused.
  it('destroys the socket and refuses when a key was planted while it waited', async () => {
    const stream = { destroy: jest.fn() }
    const original = jest.fn(async () => {
      Object.defineProperty(Object.prototype, 'path', { value: 'x', configurable: true })
      await Promise.resolve()
      return stream
    })
    const client = { connector: { connect: original } }
    guardSentinelConnector(client)

    let error: unknown
    try {
      await (client.connector.connect as unknown as () => Promise<unknown>)()
    } catch (caught) {
      error = caught
    } finally {
      Reflect.deleteProperty(Object.prototype, 'path')
    }

    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  it('leaves the socket alone when nothing was planted', async () => {
    const stream = { destroy: jest.fn(), on: jest.fn() }
    const client = { connector: { connect: jest.fn().mockResolvedValue(stream) } }
    guardSentinelConnector(client)

    const result = await (client.connector.connect as unknown as () => Promise<unknown>)()

    expect(result).toBe(stream)
    expect(stream.destroy).not.toHaveBeenCalled()
  })

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

  // Scenario: the socket a sentinel connector opened is handed back to ioredis.
  // Rule: it carries a listener for each event Node emits on it that ioredis does not listen to.
  it('gives the socket of a sentinel client a listener for each unheard event', async () => {
    const stream = { destroy: jest.fn(), on: jest.fn() }
    const client = { connector: { connect: jest.fn().mockResolvedValue(stream) } }
    guardSentinelConnector(client)

    await (client.connector.connect as unknown as () => Promise<unknown>)()

    expect(stream.on.mock.calls.map(([event]: [string]) => event).sort()).toEqual(UNHEARD)
  })

  it('is on the connector of a client the manager builds in sentinel mode', async () => {
    const manager = new ConnectionManager(
      resolveOptions({
        mode: 'sentinel',
        connection: { lazyConnect: true },
        sentinel: { name: 'm', sentinels: [{ host: '127.0.0.1', port: 1 }] }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as {
      connector: { connect: () => Promise<unknown> }
      disconnect: () => void
    }
    closers.push(() => client.disconnect())

    const error = await planted('anything', 1, () =>
      client.connector.connect().catch((e: unknown) => e)
    )

    expect((error as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
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
