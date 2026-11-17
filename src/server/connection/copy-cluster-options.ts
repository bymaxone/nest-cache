/**
 * Copies the options a host supplied for ioredis by property access, from a typed key list.
 *
 * Layer: server. An object spread copies only own enumerable properties, so a group built as a class
 * instance, whose values sit behind prototype getters, would lose them: a getter-backed password or
 * tls would be validated (the validator reads by property access) and then silently dropped, and the
 * client would connect without it. Reading each documented key by property access, and dropping the
 * unset ones, makes what is validated and what the driver gets the same.
 */
import type { ClusterOptions } from 'ioredis'

type ClusterRedisOptions = NonNullable<ClusterOptions['redisOptions']>

// Stryker disable BooleanLiteral: the values of the two records below are all `true` and only their keys
// are read, so flipping a value changes nothing; the keys are the list, and the type checks it is complete.
/**
 * Every key of ioredis `ClusterOptions`. Typed as a complete record, so a key the driver adds fails
 * the type check here instead of being dropped.
 */
export const CLUSTER_OPTION_KEYS: Record<keyof ClusterOptions, true> = {
  autoPipeliningIgnoredCommands: true,
  clusterNodeRetryStrategy: true,
  clusterRetryStrategy: true,
  dnsLookup: true,
  enableAutoPipelining: true,
  enableOfflineQueue: true,
  enableReadyCheck: true,
  himportFieldsets: true,
  keyPrefix: true,
  lazyConnect: true,
  maxRedirections: true,
  natMap: true,
  redisOptions: true,
  resolveSrv: true,
  retryDelayOnClusterDown: true,
  retryDelayOnFailover: true,
  retryDelayOnMoved: true,
  retryDelayOnTryAgain: true,
  scaleReads: true,
  scripts: true,
  shardedSubscribers: true,
  showFriendlyErrorStack: true,
  slotsRefreshInterval: true,
  slotsRefreshTimeout: true,
  useSRVRecords: true
}

/** Every key of the options a cluster hands to each node, as ioredis declares them. */
export const REDIS_OPTION_KEYS: Record<keyof ClusterRedisOptions, true> = {
  Connector: true,
  autoPipeliningIgnoredCommands: true,
  autoResendUnfulfilledCommands: true,
  autoResubscribe: true,
  blockingTimeout: true,
  blockingTimeoutGrace: true,
  clientInfoTag: true,
  commandQueue: true,
  commandTimeout: true,
  connectTimeout: true,
  connectionName: true,
  db: true,
  disableClientInfo: true,
  disconnectTimeout: true,
  enableAutoPipelining: true,
  enableReadyCheck: true,
  enableTLSForSentinelMode: true,
  failoverDetector: true,
  family: true,
  keepAlive: true,
  keyPrefix: true,
  lazyConnect: true,
  maxLoadingRetryTime: true,
  maxRetriesPerRequest: true,
  monitor: true,
  name: true,
  natMap: true,
  noDelay: true,
  offlineQueue: true,
  password: true,
  preferredSlaves: true,
  protocol: true,
  reconnectOnError: true,
  replyMapping: true,
  role: true,
  scripts: true,
  sentinelCommandTimeout: true,
  sentinelMaxConnections: true,
  sentinelPassword: true,
  sentinelReconnectStrategy: true,
  sentinelRetryStrategy: true,
  sentinelTLS: true,
  sentinelUsername: true,
  showFriendlyErrorStack: true,
  socketTimeout: true,
  stringNumbers: true,
  tls: true,
  updateSentinels: true,
  username: true
}

// Stryker restore BooleanLiteral

/**
 * Copies the set keys of `source`, each read by property access; `undefined` and `null` are unset and
 * left out, so a spread of the copy never lets an unset key replace a default.
 *
 * @param source - The group as the host wrote it; may be a class instance.
 * @param keys - The keys to read, as a complete record of the group's type.
 * @returns A plain object holding the set keys.
 */
function copySet<T extends object>(
  source: T | undefined,
  keys: Readonly<Record<keyof T, true>>
): Partial<T> {
  const copy: Partial<T> = {}
  if (source === undefined) {
    return copy
  }
  for (const key of Object.keys(keys) as (keyof T)[]) {
    // Reflect.get reads through getters and prototypes, like a property access; the key is a typed
    // list entry, never a host-supplied string.
    const value: unknown = Reflect.get(source, key)
    if (value !== undefined && value !== null) {
      Reflect.set(copy, key, value)
    }
  }
  return copy
}

/**
 * The `cluster.options` the host supplied, with its `redisOptions`, copied by property access.
 *
 * @param options - The host's `cluster.options`; may be a class instance.
 * @returns A plain copy of the set keys, `redisOptions` included.
 */
export function copyClusterOptions(options: ClusterOptions | undefined): ClusterOptions {
  const copy = copySet(options, CLUSTER_OPTION_KEYS)
  return { ...copy, redisOptions: copySet(options?.redisOptions, REDIS_OPTION_KEYS) }
}
