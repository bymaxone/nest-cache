/**
 * Runtime tests for how a client is closed, against the real ioredis.
 *
 * Layer: server. ioredis arms a teardown timer in `disconnect()` that only the stream's `close`
 * clears, and a client that has ended, or is between two reconnection attempts, has no open stream
 * and emits none. Every client is therefore created with a short `disconnectTimeout`, and a client
 * that has ended is not disconnected at all. These specs end or stop a real client (a closed port, a
 * `retryStrategy` that returns `null` or retries) and assert both.
 */
import { createServer } from 'node:net'

import { Redis } from 'ioredis'

import { applyDefaults } from '../config/default-options'
import { PubSubService } from '../services/pubsub.service'
import { KeyBuilder } from '../utils/key-builder'
import { ConnectionManager } from './connection.manager'

import type { Socket } from 'node:net'

import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

jest.setTimeout(30_000)

/** A TCP port that nothing listens on. */
const closedPort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** ioredis's own `disconnectTimeout` default, which the manager replaces on every client it creates. */
const IOREDIS_DEFAULT_DISCONNECT_TIMEOUT_MS = 2_000

/** What the spy saw of the timers armed since it started. */
interface TimerSpy {
  armedWith: (delayMs: number) => number
  clearArmed: (delayMs: number) => void
}

/**
 * Starts recording the timers armed from now on. A spy on `setTimeout` sees only the timers this
 * test's own calls arm, where a count of the process's active timers also counts ones that are not
 * ours and varies with the load of the machine.
 *
 * @returns Readers of the timers armed with a given delay, and a way to clear them.
 */
const watchTimers = (): TimerSpy => {
  const set = jest.spyOn(globalThis, 'setTimeout')
  const handles = (delayMs: number): unknown[] =>
    set.mock.calls.flatMap(([, delay], index) =>
      delay === delayMs ? [set.mock.results[index]?.value] : []
    )
  return {
    armedWith: (delayMs) => handles(delayMs).length,
    clearArmed: (delayMs) => handles(delayMs).forEach((handle) => clearTimeout(handle as never))
  }
}

/**
 * Lets short-lived callbacks finish before an assertion reads the spy.
 */
const settle = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 150))

describe('after a client has ended (real ioredis)', () => {
  const events: [string, Record<string, unknown>][] = []
  let manager: ConnectionManager | undefined

  /** A manager whose client ends on its first failed connect: nothing listens and nothing retries. */
  const build = async (
    extra: BymaxCacheModuleOptions['connection'] = {}
  ): Promise<ConnectionManager> => {
    const options = applyDefaults({
      connection: {
        host: '127.0.0.1',
        port: await closedPort(),
        enableReadyCheck: false,
        retryStrategy: () => null,
        connectTimeout: 5_000,
        ...extra
      },
      namespace: 'ended'
    })
    const bag: ICacheEvents = { onEvent: (name, data) => void events.push([name, data]) }
    manager = new ConnectionManager(options, bag)
    return manager
  }

  beforeEach(() => {
    events.length = 0
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await manager?.onApplicationShutdown()
    manager = undefined
  })

  // The boot wait gives up when the client ends. Which of the refusal and the end it sees first is up
  // to ioredis; both fail the boot, and neither leaves a 2 s timer.
  it('arms no 2 s timer after a boot that failed on a closed port', async () => {
    const built = await build()
    const timers = watchTimers()

    await expect(built.onModuleInit()).rejects.toMatchObject({ code: 'cache.connection_failed' })
    await settle()

    expect(timers.armedWith(IOREDIS_DEFAULT_DISCONNECT_TIMEOUT_MS)).toBe(0)
  })

  // A server that accepts and closes cleanly gives ioredis a close with no error, so the client ends
  // with nothing to report and the boot wait sees only `end`; that ended client has no stream to close
  // and must not be disconnected.
  it('does not disconnect a client that ended because the server hung up', async () => {
    const sockets: Socket[] = []
    const server = createServer((socket) => {
      sockets.push(socket)
      socket.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const built = await build({ port })
      const disconnect = jest.spyOn(built.getClient(), 'disconnect')

      await expect(built.onModuleInit()).rejects.toMatchObject({
        details: { error: 'connection ended before ready' }
      })
      await settle()

      expect(disconnect).not.toHaveBeenCalled()
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  // A client that ended on its own and is then shut down has nothing to quit and nothing to
  // disconnect: no quit, no disconnect, no forced-disconnect event.
  it('neither quits nor disconnects an ended client at shutdown', async () => {
    const built = await build({ lazyConnect: true })
    const client = built.getClient()
    const ended = new Promise<void>((resolve) => client.once('end', () => resolve()))
    client.connect().catch(() => undefined)
    await ended
    const quit = jest.spyOn(client, 'quit')
    const disconnect = jest.spyOn(client, 'disconnect')

    await built.onApplicationShutdown()
    await settle()

    expect(quit).not.toHaveBeenCalled()
    expect(disconnect).not.toHaveBeenCalled()
    expect(events.filter(([, data]) => data['reason'] === 'forced_disconnect')).toEqual([])
  })

  // The dedicated subscriber ends the same way; its shutdown must not quit or disconnect it either.
  it('neither quits nor disconnects an ended subscriber at shutdown', async () => {
    const built = await build()
    const minted = jest.spyOn(built, 'createSubscriberClient')
    const options = applyDefaults({
      connection: { host: '127.0.0.1', port: await closedPort(), retryStrategy: () => null },
      namespace: 'ended'
    })
    const pubsub = new PubSubService(options, built, new KeyBuilder(options))
    await pubsub.subscribe('channel', () => undefined).catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    const subscriber = minted.mock.results[0]?.value as {
      status: string
      quit: () => unknown
      disconnect: () => unknown
    }
    const quit = jest.spyOn(subscriber, 'quit')
    const disconnect = jest.spyOn(subscriber, 'disconnect')

    await pubsub.onApplicationShutdown()
    await settle()

    expect(subscriber.status).toBe('end')
    expect(quit).not.toHaveBeenCalled()
    expect(disconnect).not.toHaveBeenCalled()
  })

  // A client that is still reconnecting has not ended, so it is disconnected, but the stream of a
  // client between two attempts is already closed and emits no `close`. A teardown timer of ioredis's
  // default 2 s would keep the process alive that long after shutdown, so the client is created with
  // a short one and no 2 s timer is armed.
  it('disconnects a reconnecting client without arming a 2 s timer', async () => {
    const built = await build({ lazyConnect: true, retryStrategy: () => 50 })
    const client = built.getClient()
    client.connect().catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    expect(client.status).toBe('reconnecting')
    const disconnect = jest.spyOn(client, 'disconnect')
    const timers = watchTimers()

    await built.onApplicationShutdown()
    await settle()

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(timers.armedWith(IOREDIS_DEFAULT_DISCONNECT_TIMEOUT_MS)).toBe(0)
  })

  // The control: a client created with ioredis's own default and closed the same way does arm the 2 s
  // timer, so the zero above is the spy watching and not a spy that cannot see the timer.
  it('sees the 2 s timer of a reconnecting client created with the ioredis default', async () => {
    const client = new Redis({
      host: '127.0.0.1',
      port: await closedPort(),
      lazyConnect: true,
      retryStrategy: () => 50
    })
    client.connect().catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    const timers = watchTimers()

    client.disconnect()
    await settle()

    expect(timers.armedWith(IOREDIS_DEFAULT_DISCONNECT_TIMEOUT_MS)).toBe(1)
    timers.clearArmed(IOREDIS_DEFAULT_DISCONNECT_TIMEOUT_MS)
  })
})
