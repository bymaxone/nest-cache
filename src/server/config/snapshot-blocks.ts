/**
 * One read of every option block the host supplied.
 *
 * Layer: server. The blocks (`connection`, `sentinel`, `cluster`) are the host's own objects, and a
 * property of one can be a getter: a secret wiped after its first use, a lazy loader. Validation and
 * each builder used to read the same property again, so a later read that answered differently
 * dropped a credential, a tls setting or a url without an error. Every property is read here, once,
 * by name from a typed list, into a plain copy that validation and the builders then share.
 */
import type { ClusterOptions } from 'ioredis'

import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS, readSet } from '../connection/copy-cluster-options'
import type {
  BymaxCacheClusterConnection,
  BymaxCacheModuleOptions,
  BymaxCacheSentinelConnection,
  BymaxCacheStandaloneConnection
} from '../interfaces/cache-module-options.interface'

// Stryker disable BooleanLiteral: only the keys of the records below are read, so flipping a `true` value changes nothing
/** Every key of the standalone block, as a complete record: a key added to the interface fails here. */
const STANDALONE_KEYS: Readonly<Record<keyof BymaxCacheStandaloneConnection, true>> = {
  url: true,
  host: true,
  port: true,
  password: true,
  db: true,
  username: true,
  tls: true,
  lazyConnect: true,
  connectTimeout: true,
  commandTimeout: true,
  maxRetriesPerRequest: true,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  retryStrategy: true,
  reconnectOnError: true,
  keepAlive: true,
  noDelay: true,
  family: true
}

/** Every key of the sentinel block, as a complete record. */
const SENTINEL_KEYS: Readonly<Record<keyof BymaxCacheSentinelConnection, true>> = {
  sentinels: true,
  name: true,
  sentinelPassword: true,
  password: true,
  role: true,
  natMap: true
}

/** Every key of the cluster block, as a complete record. */
const CLUSTER_KEYS: Readonly<Record<keyof BymaxCacheClusterConnection, true>> = {
  nodes: true,
  options: true
}
// Stryker restore BooleanLiteral

/** Whether a value can be read property by property. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Copies the `cluster.options` group and its `redisOptions`, each read once.
 *
 * @param options - The `cluster.options` value as the host wrote it.
 * @returns The same value when it is not an object, otherwise a plain copy.
 */
function readClusterOptions(options: unknown): unknown {
  if (!isObject(options)) {
    return options
  }
  const copy = readSet(options as ClusterOptions, CLUSTER_OPTION_KEYS)
  const redisOptions = copy.redisOptions
  return isObject(redisOptions)
    ? { ...copy, redisOptions: readSet(redisOptions, REDIS_OPTION_KEYS) }
    : copy
}

/**
 * Replaces the `connection`, `sentinel` and `cluster` blocks with plain copies read once.
 *
 * @param options - The top-level options, already read once by name.
 * @returns The options with each present block replaced; an absent or non-object block is kept as is
 *   so that validation refuses it as it did.
 */
export function snapshotBlocks(options: BymaxCacheModuleOptions): BymaxCacheModuleOptions {
  const { connection, sentinel, cluster } = options
  const clusterBlock = isObject(cluster) ? readSet(cluster, CLUSTER_KEYS) : cluster
  return {
    ...options,
    connection: isObject(connection) ? readSet(connection, STANDALONE_KEYS) : connection,
    sentinel: isObject(sentinel) ? readSet(sentinel, SENTINEL_KEYS) : sentinel,
    cluster: isObject(clusterBlock)
      ? { ...clusterBlock, options: readClusterOptions(clusterBlock.options) }
      : clusterBlock
  } as BymaxCacheModuleOptions
}
