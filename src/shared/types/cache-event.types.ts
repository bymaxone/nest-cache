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

/**
 * The cache commands a `CacheService` method runs, one name per method, reported through
 * `ICacheEvents.onOperation`. The set is closed: `pipeline()` and `getClient()` hand out the raw
 * client and run no command of their own, so they are not in it.
 */
export type CacheOperationName =
  | 'get'
  | 'getRaw'
  | 'set'
  | 'setRaw'
  | 'setNx'
  | 'del'
  | 'delMany'
  | 'exists'
  | 'incr'
  | 'decr'
  | 'expire'
  | 'ttl'
  | 'persist'
  | 'mget'
  | 'mset'
  | 'hget'
  | 'hset'
  | 'hgetall'
  | 'hdel'
  | 'sadd'
  | 'srem'
  | 'smembers'
  | 'sismember'
  | 'scard'
  | 'keys'
  | 'scan'
  | 'flushNamespace'
  | 'eval'
  | 'isHealthy'
  | 'ping'
  | 'info'

/**
 * How a cache command ended: `hit` or `miss` for a read that can find nothing, `ok` for any other
 * command that completed, `error` when it rejected.
 */
export type CacheOperationOutcome = 'hit' | 'miss' | 'ok' | 'error'
