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
import { assertPromiseIntrinsics, ignoreRejection, settleWithin } from './settle'

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
 * Rejects what a down client still has queued, at once. A client in its retry delay has a stream that
 * is already closed, so disconnecting it emits no `close` and ioredis never flushes its queue: each
 * queued command would keep its own timeout timer, and the process alive, until it fires. ioredis has
 * no public call for the flush, only `flushQueue` on both client classes, declared private; it is
 * called when it is there and skipped when it is not or when it throws, so a release without it, or
 * with one that fails, leaves the queue to the command timeouts, as before. The error carries fixed text only.
 *
 * @param client - The client that was just disconnected.
 */
function rejectQueued(client: ClosableClient): void {
  const flush: unknown = Reflect.get(client, 'flushQueue')
  if (typeof flush === 'function') {
    try {
      Reflect.apply(flush, client, [
        new CacheException(CACHE_ERROR_CODES.CONNECTION_LOST, { reason: 'shutdown' })
      ])
    } catch {
      // A private API of ioredis that fails or changed must not fail the application's shutdown:
      // the queue is left to the command timeouts, as when the method is missing.
    }
  }
}

/**
 * Closes a client: a graceful `QUIT` bounded by `timeoutMs`, or, for a client that is already down, a
 * disconnect that stops its retries.
 *
 * A live connection gets `QUIT` and at most `timeoutMs` to answer. When the quit rejects or the deadline
 * passes, `onForced` runs and the client is disconnected. A connect still in flight is quit or forced
 * within the same deadline. A client with no live socket (see {@link DOWN_STATUSES}) has nothing to quit:
 * it is disconnected without `onForced`, because nothing was forced, and what is queued on it is
 * rejected. A client that has ended is left
 * alone: it has nothing to quit and nothing to disconnect. When the promise machinery was replaced or
 * planted on, the close is not trusted to have been clean: it is forced.
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
    rejectQueued(client)
    return
  }
  // The quit is clean only when it resolved before the deadline. A rejection, the deadline and a refusal
  // of the promise guard all read the same way, forced, so a replaced built-in can only make the close
  // louder (the disconnect still runs), never make a failed quit look clean.
  let clean: boolean
  try {
    assertPromiseIntrinsics()
    const quit = client.quit()
    ignoreRejection(quit)
    assertPromiseIntrinsics()
    const settlement = await settleWithin(quit, timeoutMs)
    if (settlement.kind === 'timeout') {
      throw new CacheException(CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT, { timeoutMs })
    }
    clean = settlement.kind === 'value'
  } catch {
    clean = false
  }
  if (!clean) {
    onForced()
    releaseClient(client)
  }
}
