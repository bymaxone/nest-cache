/**
 * Names, closed sets and tokens of the observability surface.
 *
 * Layer: observability. The metric names and the log event codes are a public contract: dashboards
 * and alerts are written against them, so they change only with a release that says so. The label
 * values come from the closed sets below, so no event can mint a series without bound.
 */
import type { CacheOperationName, CacheOperationOutcome } from '@bymax-one/nest-cache/shared'

/** Counter of cache commands, labelled by command and how it ended. */
export const CACHE_OPERATIONS_METRIC = 'bymax_cache_operations_total'

/** Gauge of the Pub/Sub messages waiting for a handler slot. */
export const CACHE_PUBSUB_QUEUED_METRIC = 'bymax_cache_pubsub_queued'

/** Counter of the Pub/Sub messages dropped because every slot and the whole queue were taken. */
export const CACHE_PUBSUB_DROPPED_METRIC = 'bymax_cache_pubsub_dropped_total'

/** Label naming the command on the operations counter. */
export const OPERATION_LABEL = 'operation'

/** Label naming how the command ended on the operations counter. */
export const OUTCOME_LABEL = 'outcome'

/** Injection token for the {@link CacheObservability} the contributor publishes. */
export const CACHE_OBSERVABILITY = Symbol('CACHE_OBSERVABILITY')

/**
 * Every command name an operation counter may carry, as a complete record: a name added to
 * `CacheOperationName` fails the type check here until it is listed. Only the keys are read.
 */
// Stryker disable BooleanLiteral: only the keys of the two records below are read, so flipping a `true` value changes nothing
export const CACHE_OPERATION_NAMES: Readonly<Record<CacheOperationName, true>> = {
  get: true,
  getRaw: true,
  set: true,
  setRaw: true,
  setNx: true,
  del: true,
  delMany: true,
  exists: true,
  incr: true,
  decr: true,
  expire: true,
  ttl: true,
  persist: true,
  mget: true,
  mset: true,
  hget: true,
  hset: true,
  hgetall: true,
  hdel: true,
  sadd: true,
  srem: true,
  smembers: true,
  sismember: true,
  scard: true,
  keys: true,
  scan: true,
  flushNamespace: true,
  eval: true,
  isHealthy: true,
  ping: true,
  info: true
}

/** Every outcome an operation counter may carry, as a complete record. */
export const CACHE_OPERATION_OUTCOMES: Readonly<Record<CacheOperationOutcome, true>> = {
  hit: true,
  miss: true,
  ok: true,
  error: true
}
// Stryker restore BooleanLiteral

/**
 * The code of every log event the library writes, as the `event` field of an object message.
 *
 * One code per connection or Pub/Sub event the library already reports, and one for the failure of a
 * host hook; the README lists the level, the moment and the fields of each.
 */
export const CACHE_LOG_EVENTS = {
  connect: 'CACHE_CONNECT',
  ready: 'CACHE_READY',
  close: 'CACHE_CLOSE',
  reconnecting: 'CACHE_RECONNECTING',
  end: 'CACHE_END',
  connectionError: 'CACHE_CONNECTION_ERROR',
  forcedDisconnect: 'CACHE_FORCED_DISCONNECT',
  handlerError: 'CACHE_HANDLER_ERROR',
  pubsubDropped: 'CACHE_PUBSUB_DROPPED',
  hookFailed: 'CACHE_HOOK_FAILED'
} as const
