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

/** The timers the process is keeping alive right now. */
const activeTimers = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length

/**
 * Lets short-lived callbacks finish, so only a timer that outlives them is counted: ioredis's teardown
 * timer lasts 2 s, and the pauses here are far shorter.
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
    await manager?.onApplicationShutdown()
    manager = undefined
  })

  // The boot wait gives up when the client ends, and must not disconnect a client that is already
  // closed: that is the call that armed the 2 s timer.
  it('leaves no timer after a boot that failed because the client ended', async () => {
    const built = await build()
    const before = activeTimers()

    // Which of the refusal and the end the wait sees first is up to ioredis; both fail the boot.
    await expect(built.onModuleInit()).rejects.toMatchObject({ code: 'cache.connection_failed' })
    await settle()

    expect(activeTimers()).toBeLessThanOrEqual(before)
  })

  // A server that accepts and closes cleanly gives ioredis a close with no error, so the client ends with
  // nothing to report and the boot wait sees only `end`; disconnecting that ended client is the call
  // that armed the 2 s timer.
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
      const before = activeTimers()

      await expect(built.onModuleInit()).rejects.toMatchObject({
        details: { error: 'connection ended before ready' }
      })
      await settle()

      expect(activeTimers()).toBeLessThanOrEqual(before)
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
    const before = activeTimers()

    await built.onApplicationShutdown()
    await settle()

    expect(activeTimers()).toBeLessThanOrEqual(before)
    expect(events.filter(([, data]) => data['reason'] === 'forced_disconnect')).toEqual([])
  })

  // The dedicated subscriber ends the same way; its shutdown must not arm the timer either.
  it('leaves no timer when an ended subscriber is shut down', async () => {
    const built = await build()
    const options = applyDefaults({
      connection: { host: '127.0.0.1', port: await closedPort(), retryStrategy: () => null },
      namespace: 'ended'
    })
    const pubsub = new PubSubService(options, built, new KeyBuilder(options))
    await pubsub.subscribe('channel', () => undefined).catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    const before = activeTimers()

    await pubsub.onApplicationShutdown()
    await settle()

    expect(activeTimers()).toBeLessThanOrEqual(before)
  })
})
