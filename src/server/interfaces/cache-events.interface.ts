/**
 * Connection lifecycle observation contract.
 *
 * Layer: server. A consumer-supplied bag of callbacks the connection manager
 * invokes on Redis lifecycle transitions. Used to bridge connection signals to
 * a logger, metrics backend, or alerting system without coupling the library to
 * any of them.
 */
import type { CacheEventName } from '../../shared/types/cache-event.types'

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
   *   `'error'` event carrying `{ role: 'main', reason: 'forced_disconnect' }`
   *   (no `error` message field). The `CacheEventName` union has no dedicated
   *   shutdown member, so branch on `data.reason` to tell a forced teardown apart
   *   from an ioredis socket error (which carries an `error` string instead).
   * @param event - The lifecycle event name.
   * @param data - Secret-free structured context (e.g. `{ role: 'main' }`).
   */
  onEvent?: (event: CacheEventName, data: Record<string, unknown>) => void
}
