/**
 * One read of every option block the host supplied.
 *
 * Layer: server. The blocks (`connection`, `sentinel`, `cluster`) are the host's own objects, and a
 * property of one can be a getter: a secret wiped after its first use, a lazy loader. Two reads of
 * such a property can answer differently, so validation and every client builder must share one
 * answer: each property is read here, once, by name from a typed list, into a plain copy.
 */
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'

import type { ClusterOptions, SentinelAddress } from 'ioredis'

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

/**
 * The tls options that decide who is trusted and which identity is presented, read by name so that a
 * class instance, a get-only proxy or a non-enumerable field is not silently dropped. The own
 * enumerable keys beyond these are copied as well.
 */
const TLS_KEYS = {
  ca: true,
  cert: true,
  key: true,
  pfx: true,
  passphrase: true,
  rejectUnauthorized: true,
  servername: true,
  checkServerIdentity: true,
  minVersion: true,
  maxVersion: true,
  ciphers: true,
  secureContext: true,
  crl: true
} satisfies Partial<Record<keyof TlsConnectionOptions, true>>

/** What an entry of `sentinels`, `cluster.nodes` or a `natMap` names, read by name. */
const ENTRY_KEYS = { host: true, port: true, family: true } satisfies Partial<
  Record<keyof SentinelAddress, true>
>

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
 * Copies an object once: the keys in `keys` by name, then its own enumerable keys. A key that answered
 * `undefined` is left out, so the driver sees the default it would see for an absent one. A value that
 * is not an object (a string address, a function, `null`) is kept as is.
 *
 * @param value - The value as the host wrote it.
 * @param keys - The keys to read by name.
 * @returns A plain copy, or the value itself when it is not an object.
 */
function readPlain(value: unknown, keys: Readonly<Record<string, true>>): unknown {
  return isObject(value)
    ? Object.fromEntries(
        Object.entries(readSet(value, keys)).filter(([, copied]) => copied !== undefined)
      )
    : value
}

/** Copies a `tls` object once: its security options by name. `Buffer`s and a `secureContext` stay by reference. */
const readTls = (tls: unknown): unknown => readPlain(tls, TLS_KEYS)

/** Copies a sentinel address, a cluster node or a `natMap` target once: host, port and family by name. */
const readEntry = (entry: unknown): unknown => readPlain(entry, ENTRY_KEYS)

/**
 * Copies a list the driver walks on every connect (`sentinels`, `nodes`): the length once and each
 * entry once, by name. A value that is not an array is kept as is, for validation to refuse.
 *
 * @param list - The list as the host wrote it.
 * @returns A plain array of copied entries.
 */
function copyEntries(list: unknown): unknown {
  if (!Array.isArray(list)) {
    return list
  }
  const length: number = list.length
  return Array.from({ length }, (_, index) => readEntry(list[index]))
}

/**
 * Copies a `natMap` once, each entry once. A function map is kept as is.
 *
 * @param map - The map as the host wrote it.
 * @returns A plain map of copied entries.
 */
function copyNatMap(map: unknown): unknown {
  return isObject(map)
    ? Object.fromEntries(Object.entries(readSet(map, {})).map(([key, to]) => [key, readEntry(to)]))
    : map
}

/**
 * Copies the `cluster.options` group and its `redisOptions`, each read once, with the `tls` and
 * `natMap` objects the driver reads live copied as well.
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
  const node = isObject(redisOptions) ? readSet(redisOptions, REDIS_OPTION_KEYS) : undefined
  return {
    ...copy,
    natMap: copyNatMap(copy.natMap),
    ...(node !== undefined && {
      redisOptions: { ...node, tls: readTls(node.tls), natMap: copyNatMap(node.natMap) }
    })
  }
}

/**
 * Replaces the `connection`, `sentinel` and `cluster` blocks with plain copies read once, down to
 * the `tls`, `sentinels`, `nodes` and `natMap` values that reach the driver as objects.
 *
 * @param options - The top-level options, already read once by name.
 * @returns The options with each present block replaced; an absent or non-object block is kept as is
 *   so that validation refuses it as it did.
 */
export function snapshotBlocks(options: BymaxCacheModuleOptions): BymaxCacheModuleOptions {
  const { connection, sentinel, cluster } = options
  const standalone = isObject(connection) ? readSet(connection, STANDALONE_KEYS) : connection
  const sentinelBlock = isObject(sentinel) ? readSet(sentinel, SENTINEL_KEYS) : sentinel
  const clusterBlock = isObject(cluster) ? readSet(cluster, CLUSTER_KEYS) : cluster
  return {
    ...options,
    connection: isObject(standalone) ? { ...standalone, tls: readTls(standalone.tls) } : standalone,
    sentinel: isObject(sentinelBlock)
      ? {
          ...sentinelBlock,
          sentinels: copyEntries(sentinelBlock.sentinels),
          natMap: copyNatMap(sentinelBlock.natMap)
        }
      : sentinelBlock,
    cluster: isObject(clusterBlock)
      ? {
          ...clusterBlock,
          nodes: copyEntries(clusterBlock.nodes),
          options: readClusterOptions(clusterBlock.options)
        }
      : clusterBlock
  } as BymaxCacheModuleOptions
}
