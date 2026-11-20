/**
 * Connection lifecycle observation contract.
 *
 * Layer: server. A consumer-supplied bag of callbacks the connection manager
 * invokes on Redis lifecycle transitions. Used to bridge connection signals to
 * a logger, metrics backend, or alerting system without coupling the library to
 * any of them.
 */
import type {
  CacheEventName,
  CacheOperationName,
  CacheOperationOutcome
} from '../../shared/types/cache-event.types'

/**
 * Plug-in for connection lifecycle observation.
 *
 * Callbacks MUST be fast and non-blocking — any exception thrown is caught and
 * swallowed by the connection manager (best-effort observability must never
 * crash the connection lifecycle). Payloads carry no secret values.
 */
export interface ICacheEvents {
  /**
   * Invoked on every connection lifecycle event.
   *
   * @remarks A forced disconnect during graceful shutdown surfaces here as an
   *   `'error'` event carrying `{ role: 'main' | 'subscriber', reason: 'forced_disconnect' }`
   *   (no `error` message field), once for each of the two clients that did not quit within
   *   `shutdownTimeoutMs` or refused. A client that was already down (reconnecting) is released without a
   *   quit and without this event. The `CacheEventName` union has no dedicated
   *   shutdown member, so branch on `data.reason` to tell a forced teardown apart
   *   from an ioredis socket error (which carries an `error` string instead).
   * @param event - The lifecycle event name.
   * @param data - Secret-free structured context (e.g. `{ role: 'main' }`).
   */
  onEvent?: (event: CacheEventName, data: Record<string, unknown>) => void

  /**
   * Invoked once for each `CacheService` command when it ends, with how it ended.
   *
   * @remarks Best-effort: a throw is swallowed, and the call is made only when this callback is set.
   *   `scan` reports when the iteration ends, whether it completed, was stopped early, or threw.
   * @param operation - The command that ran.
   * @param outcome - `hit` or `miss` for a read that can find nothing, `ok` for any other command that
   *   completed, `error` when it rejected.
   */
  onOperation?: (operation: CacheOperationName, outcome: CacheOperationOutcome) => void

  /**
   * Invoked when the number of Pub/Sub messages waiting for a handler slot changes.
   *
   * @remarks Only a subscriber bounded with `pubsubMaxConcurrentHandlers` has a queue to report.
   *   Best-effort: a throw is swallowed.
   * @param queued - How many messages wait now.
   */
  onQueue?: (queued: number) => void
}
