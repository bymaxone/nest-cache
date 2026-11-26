/**
 * Boot against a server that cannot answer, end-to-end over real sockets.
 *
 * Layer: server. A refused connection and a silent server are the two ways a boot fails without a
 * Redis to answer it. Neither needs a container: a free port with no listener refuses, and a TCP
 * server that accepts and never replies is what a frozen Redis looks like from the client.
 */
import { createServer, type Socket } from 'node:net'

import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

import { bootCacheApp, type CacheAppOptions } from './fixtures/test-cache-app.module'
import { getFreePort } from './helpers/free-port'

/** A deadline far above every bound asserted here, so it cannot be what ends the boot. */
const FAR_DEADLINE_MS = 60_000

/** The command timeout of the silent-server boot, which is the deadline it must meet. */
const COMMAND_TIMEOUT_MS = 1_000

/**
 * Slack added to a deadline before a wall-clock bound fails: a loaded machine delays the rejection,
 * not the deadline it is measured against.
 */
const MARGIN_MS = 10_000

/** Boots against `port` and returns what the boot rejected with and how long it took. */
async function failedBoot(
  port: number,
  deadlines: { connectTimeout: number; commandTimeout: number }
): Promise<{ error: unknown; elapsed: number }> {
  const options: CacheAppOptions = {
    connection: { host: '127.0.0.1', port, ...deadlines },
    namespace: 'e2e-boot'
  }
  const started = Date.now()
  try {
    const app = await bootCacheApp(options)
    await app.close()
  } catch (error) {
    return { error, elapsed: Date.now() - started }
  }
  throw new Error('expected the boot to fail')
}

describe('Boot failure E2E (real sockets)', () => {
  // Scenario: nothing listens on the port, as with a stopped Redis.
  // Rule: the boot fails with CONNECTION_FAILED at once, without waiting for either deadline.
  it('fails at once when the connection is refused', async () => {
    const port = await getFreePort()

    const { error, elapsed } = await failedBoot(port, {
      connectTimeout: FAR_DEADLINE_MS,
      commandTimeout: FAR_DEADLINE_MS
    })

    expect(error).toBeInstanceOf(CacheException)
    expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
    expect((error as CacheException).getStatus()).toBe(503)
    expect(elapsed).toBeLessThan(MARGIN_MS)
  })

  // Scenario: the server accepts and never answers, with commandTimeout below connectTimeout.
  // Rule: the first handshake command's commandTimeout ends the boot, not the connect deadline.
  it('fails at commandTimeout against a silent server when it is the shorter deadline', async () => {
    const sockets: Socket[] = []
    const silent = createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const address = silent.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const { error, elapsed } = await failedBoot(port, {
        connectTimeout: FAR_DEADLINE_MS,
        commandTimeout: COMMAND_TIMEOUT_MS
      })

      expect(error).toBeInstanceOf(CacheException)
      expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_FAILED)
      expect((error as CacheException).getStatus()).toBe(503)
      expect(elapsed).toBeGreaterThanOrEqual(COMMAND_TIMEOUT_MS - 100)
      expect(elapsed).toBeLessThan(COMMAND_TIMEOUT_MS + MARGIN_MS)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => silent.close(() => resolve()))
    }
  })
})
