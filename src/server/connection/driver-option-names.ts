/**
 * The option names ioredis reads off the options object it was given.
 *
 * Layer: server. ioredis merges the options a client is built with into an ordinary object it makes
 * itself, copying only the names the object it was given holds and the names it has a default for, and
 * then reads names we did not set from that object. A key planted on `Object.prototype` is found there,
 * so a planted `host`, `port`, `tls`, `password`, `username`, `sentinels`, `natMap` or `path` would
 * redirect or reconfigure the connection. Giving the object an own key, with the value `undefined`, for
 * every name the driver reads shadows what is planted: `undefined` is what an absent option is to it.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS } from './copy-cluster-options'

/**
 * The names a standalone or sentinel client reads and the typed key records of a cluster node leave out
 * (`ClusterRedisOptions` omits `port`, `host`, `path`, `sentinels`, `retryStrategy`, `enableOfflineQueue`,
 * `readOnly` and `himportFieldsets`), and `timeout`, which ioredis reads and does not type.
 */
const UNTYPED = [
  'enableOfflineQueue',
  'himportFieldsets',
  'host',
  'path',
  'port',
  'readOnly',
  'retryStrategy',
  'sentinels',
  'timeout'
]

/** Every option name of a Redis client, a cluster and the options a cluster gives each node. */
export const DRIVER_OPTION_NAMES: readonly string[] = [
  ...new Set([...Object.keys(CLUSTER_OPTION_KEYS), ...Object.keys(REDIS_OPTION_KEYS), ...UNTYPED])
].sort()

/**
 * The names ioredis reads off objects it creates itself (a client, a cluster, a connector, a pipeline,
 * a command, a subscriber) that those objects do not hold when they are built, so a key planted on
 * `Object.prototype` is what the read finds. The library does not create these objects and cannot give
 * them an own key, so it refuses to build a client while any of them is planted.
 */
export const DRIVER_INSTANCE_NAMES: readonly string[] = [
  '_blockingDeadline',
  '_blockingTimeoutTimer',
  '_commandTimeoutTimer',
  '_transformer',
  'bufferMode',
  'condition',
  'firstError',
  'flagMap',
  'isReadOnly',
  'items',
  'keys',
  'lastActiveSubscriber',
  'leftRedirections',
  'length',
  'manuallyClosing',
  'nodeifiedPromise',
  'preferKey',
  'reconnectTimeout',
  'retryAttempts',
  'shardedSubscribers',
  'slot',
  'slotsTimer',
  'socketTimeoutTimer',
  'stream',
  'subscriberGroupEmitter'
]

/**
 * Refuses to go on when a name the driver reads off its own objects is planted on `Object.prototype`.
 *
 * @throws {CacheException} `INVALID_OPTIONS` naming the planted name (one of the driver's, never a value).
 */
export function assertDriverUnshadowed(): void {
  for (const name of DRIVER_INSTANCE_NAMES) {
    if (Object.hasOwn(Object.prototype, name)) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {
        reason: 'Object.prototype holds a name the driver reads from its own objects',
        name
      })
    }
  }
}

/**
 * Copies options into an object without a prototype that holds every driver option name as an own key,
 * `undefined` for each one the options leave out.
 *
 * @param options - The options built for ioredis.
 * @returns A prototype-less object: the options over an own `undefined` for every driver option name.
 */
export function withOwnKeys<T extends object>(options: T): T {
  const copy = Object.create(null) as Record<string, unknown>
  for (const name of DRIVER_OPTION_NAMES) {
    copy[name] = undefined
  }
  return Object.assign(copy, options) as T
}
