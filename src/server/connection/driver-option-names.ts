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
