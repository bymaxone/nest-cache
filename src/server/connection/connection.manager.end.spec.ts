/**
 * Runtime tests for what happens after a client has ended, against the real ioredis.
 *
 * Layer: server. A client in status `end` never emits `close` again, and ioredis arms a 2 s teardown
 * timer in `disconnect()` that only a `close` clears, so disconnecting an ended client keeps the
 * process alive for 2 s more. These specs end a real client (a closed port and a `retryStrategy` that
 * returns `null`) and assert that no timer is left behind by any path that can reach it afterwards.
 */
import { createServer } from 'node:net'

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

/** The delay of ioredis's teardown timer: its `disconnectTimeout` default, which no code here changes. */
const TEARDOWN_DELAY_MS = 2_000

/** What the spy saw of ioredis's teardown timer: how many it armed, and how many were never cleared. */
interface TeardownTimers {
  armed: () => number
  uncleared: () => number
}

/**
 * Starts recording the teardown timers ioredis arms from now on. A spy on `setTimeout` and
 * `clearTimeout` sees only the timers this test's own calls arm and clear, where a count of the
 * process's active timers also counts ones that are not ours and varies with the load of the machine.
 * A client that has not ended arms the timer when it is disconnected and its `close` clears it, so
 * a timer is a defect only while it is armed and never cleared.
 *
 * @returns Readers of the number armed and the number never cleared since this call.
 */
const watchTeardownTimers = (): TeardownTimers => {
  const set = jest.spyOn(globalThis, 'setTimeout')
  const clear = jest.spyOn(globalThis, 'clearTimeout')
  const handles = (): unknown[] =>
    set.mock.calls.flatMap(([, delay], index) =>
      delay === TEARDOWN_DELAY_MS ? [set.mock.results[index]?.value] : []
    )
  return {
    armed: () => handles().length,
    uncleared: () =>
      handles().filter((handle) => !clear.mock.calls.some(([cleared]) => cleared === handle)).length
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

  // The boot wait gives up when the client ends, and must not disconnect a client that is already
  // closed: ioredis arms a 2 s teardown timer in `disconnect()` that only a `close` clears, and an
  // ended client never emits one.
  it('leaves no timer after a boot that failed because the client ended', async () => {
    const built = await build()
    const timers = watchTeardownTimers()

    // Which of the refusal and the end the wait sees first is up to ioredis; both fail the boot.
    await expect(built.onModuleInit()).rejects.toMatchObject({ code: 'cache.connection_failed' })
    await settle()

    expect(timers.uncleared()).toBe(0)
  })

  // A server that accepts and closes cleanly gives ioredis a close with no error, so the client ends with
  // nothing to report and the boot wait sees only `end`; that ended client must not be disconnected,
  // or its teardown timer would outlive the boot.
  it('leaves no timer after a boot where the server hung up and the client ended', async () => {
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
      const timers = watchTeardownTimers()

      await expect(built.onModuleInit()).rejects.toMatchObject({
        details: { error: 'connection ended before ready' }
      })
      await settle()

      expect(timers.uncleared()).toBe(0)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  // A client that ended on its own and is then shut down has nothing to quit: no quit, no forced
  // disconnect event, no timer.
  it('leaves no timer and no forced-disconnect event when an ended client is shut down', async () => {
    const built = await build({ lazyConnect: true })
    const client = built.getClient()
    const ended = new Promise<void>((resolve) => client.once('end', () => resolve()))
    client.connect().catch(() => undefined)
    await ended
    const timers = watchTeardownTimers()

    await built.onApplicationShutdown()
    await settle()

    expect(timers.uncleared()).toBe(0)
    expect(events.filter(([, data]) => data['reason'] === 'forced_disconnect')).toEqual([])
  })

  // The dedicated subscriber ends the same way; its shutdown must not arm the timer either.
  it('leaves no timer and sends no quit when an ended subscriber is shut down', async () => {
    const built = await build()
    const minted = jest.spyOn(built, 'createSubscriberClient')
    const options = applyDefaults({
      connection: { host: '127.0.0.1', port: await closedPort(), retryStrategy: () => null },
      namespace: 'ended'
    })
    const pubsub = new PubSubService(options, built, new KeyBuilder(options))
    await pubsub.subscribe('channel', () => undefined).catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    const subscriber = minted.mock.results[0]?.value as { status: string; quit: () => unknown }
    const quit = jest.spyOn(subscriber, 'quit')
    const timers = watchTeardownTimers()

    await pubsub.onApplicationShutdown()
    await settle()

    expect(subscriber.status).toBe('end')
    expect(quit).not.toHaveBeenCalled()
    expect(timers.uncleared()).toBe(0)
  })

  // The control: a client that has not ended and is disconnected does arm the teardown timer, and its
  // `close` clears it. The spy sees that close path, so the zero in the cases above is the spy
  // watching and not a spy that cannot see the timer.
  it('arms and clears the teardown timer when a client that has not ended is closed', async () => {
    const sockets: Socket[] = []
    const silent = createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
      // Read what the client sends, so that its end of the connection is seen and answered.
      socket.resume()
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const address = silent.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const built = await build({ port, connectTimeout: 300 })
      const timers = watchTeardownTimers()

      await expect(built.onModuleInit()).rejects.toMatchObject({
        details: { error: 'not ready within connectTimeout' }
      })
      await settle()

      expect(timers.armed()).toBe(1)
      expect(timers.uncleared()).toBe(0)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => silent.close(() => resolve()))
    }
  })
})
