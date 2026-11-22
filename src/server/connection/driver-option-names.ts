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
 * The string keys `Object.prototype` holds in every Node version the library supports. Anything else is a
 * key another part of the process planted there.
 */
export const STANDARD_KEYS: ReadonlySet<string> = new Set([
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf'
])

/**
 * Refuses to go on while `Object.prototype` holds a string key it does not hold by default.
 *
 * ioredis reads names off objects it creates itself (a client, a cluster, a connector, a pipeline, a
 * command, a subscriber) that those objects do not hold when they are built, through `this`, through an
 * alias of `this` and through other objects, so a key planted on `Object.prototype` is what the read
 * finds. The library cannot give those objects an own key and no list of the names can be complete, so a
 * polluted `Object.prototype` is refused as a whole. A symbol key is not a name the driver reads.
 *
 * It runs when the manager is built, when each client is built and in the tick that opens every socket,
 * on the first connect and on every reconnect (the connector). It does not cover `Array.prototype`,
 * `Function.prototype` or `Buffer`'s prototype, and a key planted after the last of those runs is still
 * read by the objects the driver builds later (a command, a pipeline).
 *
 * @throws {CacheException} `INVALID_OPTIONS` with the count of the keys, never a key or a value.
 */
export function assertDriverUnshadowed(): void {
  const planted = Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => !STANDARD_KEYS.has(name)
  )
  if (planted.length > 0) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: planted.length
    })
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
