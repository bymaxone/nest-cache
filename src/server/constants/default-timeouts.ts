/**
 * Default and minimum timeout values (milliseconds).
 *
 * Layer: server. Applied by the connection manager / `applyDefaults` when the
 * consumer omits a timeout, and enforced as lower bounds by `validateOptions`.
 */

/** Default connect timeout when `connection.connectTimeout` is omitted. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

/** Default per-command timeout when `connection.commandTimeout` is omitted. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5_000

/** Default graceful-shutdown timeout when `shutdownTimeoutMs` is omitted. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

/** Default `maxRetriesPerRequest` (NOT `null` — that value is BullMQ-specific). */
export const DEFAULT_MAX_RETRIES_PER_REQUEST = 3

/** Base linear backoff (ms) applied per retry attempt by the retry strategy. */
export const DEFAULT_RETRY_BASE_MS = 50

/** Upper bound (ms) for the retry backoff delay computed by the retry strategy. */
export const DEFAULT_RETRY_MAX_MS = 2000

/** Lower bound for `shutdownTimeoutMs` validation (ms). */
export const MIN_SHUTDOWN_TIMEOUT_MS = 100

/** Lower bound for `connectTimeout` validation (ms). */
export const MIN_CONNECT_TIMEOUT_MS = 100
