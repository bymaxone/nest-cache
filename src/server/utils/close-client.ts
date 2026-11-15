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
 * The statuses of a client with no live socket: the server is down and ioredis is between attempts
 * (`reconnecting`, `close`), or a lazy client never connected (`wait`), where a quit would first open a
 * connection just to say goodbye. Any other status, one this code does not know included, takes the quit.
 */
const DOWN_STATUSES: ReadonlySet<string> = new Set(['reconnecting', 'close', 'wait'])

/**
 * Closes a client: a graceful `QUIT` bounded by `timeoutMs`, or, for a client that is already down, a
 * disconnect that stops its retries.
 *
 * A live connection gets `QUIT` and at most `timeoutMs` to answer. When the quit rejects or the deadline
 * passes, `onForced` runs and the client is disconnected. A connect still in flight is quit or forced
 * within the same deadline. A client with no live socket (see {@link DOWN_STATUSES}) has nothing to quit:
 * it is disconnected without `onForced`, because nothing was forced. A client that has ended is left
 * alone: it has nothing to quit and nothing to disconnect.
 *
 * @param client - The ioredis client to close.
 * @param timeoutMs - How long the graceful quit may take.
 * @param onForced - Called before a forced disconnect, so the teardown can be signalled first; it must
 *   not throw, because the disconnect that follows it would not run.
 */
export async function closeClient(
  client: ClosableClient,
  timeoutMs: number,
  onForced: () => void
): Promise<void> {
  if (client.status === 'end') {
    return
  }
  if (DOWN_STATUSES.has(client.status)) {
    releaseClient(client)
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
