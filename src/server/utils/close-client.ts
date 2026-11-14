/**
 * Closes a client gracefully within a deadline, forcing it closed when it does not quit in time.
 *
 * Layer: server. The one place the shutdown of the main client and of the Pub/Sub subscriber is
 * bounded, so the two cannot drift: both end within `shutdownTimeoutMs`, whatever their command
 * timeout is.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { releaseClient } from './release-client'

/** The part of an ioredis client (standalone or cluster) that closing needs. */
export interface ClosableClient {
  readonly status: string
  quit(): Promise<unknown>
  disconnect(): void
}

/**
 * Sends `QUIT` and waits at most `timeoutMs` for it. When the quit rejects or the deadline passes,
 * `onForced` runs and the client is disconnected, unless it has ended. A client that has already
 * ended is left alone: it has nothing to quit and nothing to disconnect.
 *
 * @param client - The ioredis client to close.
 * @param timeoutMs - How long the graceful quit may take.
 * @param onForced - Called before a forced disconnect, so the teardown can be signalled first.
 */
export async function closeClient(
  client: ClosableClient,
  timeoutMs: number,
  onForced: () => void
): Promise<void> {
  if (client.status === 'end') {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.quit(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CacheException(CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT, { timeoutMs })),
          timeoutMs
        )
      })
    ])
  } catch {
    onForced()
    releaseClient(client)
  } finally {
    clearTimeout(timer)
  }
}
