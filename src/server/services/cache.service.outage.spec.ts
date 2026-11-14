/**
 * Runtime tests for command-failure mapping on {@link CacheService}, against the real ioredis.
 *
 * Layer: server. Nothing here is mocked: a loopback server that accepts the socket and never
 * answers makes ioredis reject with its own timeout error, and a server that goes away makes it
 * reject with its own offline error. That proves the behaviour of the installed ioredis, not the
 * text of its source.
 */
import { createServer } from 'node:net'

import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { Server, Socket } from 'node:net'

/** Commands ioredis sends while it connects, and the replies that let it finish connecting. */
const HANDSHAKE_REPLIES: Readonly<Record<string, string>> = {
  hello: "-ERR unknown command 'hello'\r\n",
  client: '+OK\r\n'
}

/**
 * A loopback server that completes ioredis's connect handshake and then never answers a command.
 * A server that answered nothing at all would never let the client become ready.
 */
const listenSilent = async (): Promise<{ server: Server; sockets: Socket[]; port: number }> => {
  const sockets: Socket[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => undefined)
    socket.on('data', (chunk) => {
      for (const match of chunk.toString().matchAll(/\*\d+\r\n\$\d+\r\n(\w+)\r\n/g)) {
        const reply = HANDSHAKE_REPLIES[(match[1] ?? '').toLowerCase()]
        if (reply !== undefined) {
          socket.write(reply)
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, sockets, port: typeof address === 'object' && address ? address.port : 0 }
}

jest.setTimeout(60_000)

describe('CacheService against the real ioredis', () => {
  let connection: ConnectionManager | undefined
  let silent: Awaited<ReturnType<typeof listenSilent>> | undefined

  afterEach(async () => {
    await connection?.onApplicationShutdown()
    connection = undefined
    silent?.sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) =>
      silent ? silent.server.close(() => resolve()) : resolve()
    )
    silent = undefined
  })

  /** Builds a service over a real client pointed at `port`. */
  const build = (port: number, connectionOptions: Record<string, unknown> = {}): CacheService => {
    const options = applyDefaults({
      connection: {
        host: '127.0.0.1',
        port,
        enableReadyCheck: false,
        commandTimeout: 150,
        // The boot wait must not be what a loaded machine trips over; the commands under test are
        // bounded by `commandTimeout` above.
        connectTimeout: 30_000,
        ...connectionOptions
      },
      namespace: 'outage'
    })
    connection = new ConnectionManager(options)
    return new CacheService(options, connection, new KeyBuilder(options))
  }

  /** What `call` rejected with, failing the test when it resolved. */
  const rejectionOf = async (call: () => Promise<unknown>): Promise<unknown> => {
    try {
      await call()
    } catch (error) {
      return error
    }
    throw new Error('expected the call to reject')
  }

  // A server that accepts the socket and never answers: ioredis rejects the command with its own
  // `Command timed out` after `commandTimeout`, and the service reports it as a coded 504.
  it('reports a command that gets no answer as COMMAND_TIMEOUT', async () => {
    silent = await listenSilent()
    const cache = build(silent.port)
    await connection?.onModuleInit()

    const error = await rejectionOf(() => cache.get('user', '1'))

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    expect(((error as CacheException).cause as Error).message).toBe('Command timed out')
  })

  // Redis stopped after the connection was up: the client is reconnecting with the offline queue off,
  // so every call rejects at once with ioredis's own offline error, reported as CONNECTION_LOST.
  it('reports a call while the connection is down as CONNECTION_LOST (offline)', async () => {
    silent = await listenSilent()
    const cache = build(silent.port)
    await connection?.onModuleInit()
    silent.sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) => silent?.server.close(() => resolve()))
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    const error = await rejectionOf(() => cache.get('user', '1'))

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect((error as CacheException).details).toEqual({ reason: 'offline' })
    expect(((error as CacheException).cause as Error).message).toBe(
      "Stream isn't writeable and enableOfflineQueue options is false"
    )
  })

  // A fresh lazy client has not connected yet: the first call hits the same offline rejection.
  it('reports the first call of a lazy client that is not connected as CONNECTION_LOST', async () => {
    silent = await listenSilent()
    const cache = build(silent.port, { lazyConnect: true })
    await connection?.onModuleInit()

    const error = await rejectionOf(() => cache.get('user', '1'))

    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
  })
})
