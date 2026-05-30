/**
 * Cache connection event types.
 *
 * Layer: shared — zero-dependency. Emitted by the connection manager and
 * surfaced to consumers through the optional `events.onEvent` callback.
 */

/** Connection lifecycle events propagated from the underlying Redis client. */
export type CacheEventName = 'connect' | 'ready' | 'error' | 'close' | 'reconnecting' | 'end'

/** Coarse connection status derived from the lifecycle events. */
export type CacheConnectionStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed'
