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
import type { IScriptDefinition } from '../interfaces/script-definition.interface'
import { refuseOption } from './refuse-option'

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
 * Every documented option of `tls.ConnectionOptions`, plus the `profile` that `ioredis` reads, as a
 * complete record: an option a newer Node adds fails the type check here until it is listed. Each is
 * read by name, so a class instance, a get-only proxy or a non-enumerable field loses none of them;
 * the own enumerable keys beyond these are copied as well.
 */
const TLS_KEYS: Readonly<Record<keyof TlsConnectionOptions | 'profile', true>> = {
  ALPNCallback: true,
  ALPNProtocols: true,
  SNICallback: true,
  allowPartialTrustChain: true,
  ca: true,
  cert: true,
  certificateCompression: true,
  checkServerIdentity: true,
  ciphers: true,
  clientCertEngine: true,
  crl: true,
  dhparam: true,
  ecdhCurve: true,
  enableTrace: true,
  honorCipherOrder: true,
  host: true,
  key: true,
  lookup: true,
  maxVersion: true,
  minDHSize: true,
  minVersion: true,
  passphrase: true,
  path: true,
  pfx: true,
  port: true,
  privateKeyEngine: true,
  privateKeyIdentifier: true,
  profile: true,
  pskCallback: true,
  rejectUnauthorized: true,
  requestCert: true,
  requestOCSP: true,
  secureContext: true,
  secureOptions: true,
  secureProtocol: true,
  servername: true,
  session: true,
  sessionIdContext: true,
  sessionTimeout: true,
  sigalgs: true,
  socket: true,
  ticketKeys: true,
  timeout: true
}

/** The most entries a list the driver walks, or the `scripts` list, may hold. */
const MAX_LIST_ENTRIES = 1000

/** Every key of a script definition, as a complete record. */
const SCRIPT_KEYS: Readonly<Record<keyof IScriptDefinition, true>> = { name: true, lua: true }

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
 * is not an object (a string address, a function, `null`) or is an array is kept as is, for validation to
 * refuse.
 *
 * @param value - The value as the host wrote it.
 * @param keys - The keys to read by name.
 * @returns A plain copy, or the value itself when it is not an object or is an array.
 */
function readPlain(value: unknown, keys: Readonly<Record<string, true>>): unknown {
  return isObject(value) && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(readSet(value, keys)).filter(([, copied]) => copied !== undefined)
      )
    : value
}

/** The tls options that hold key material: a string, a `Buffer`, or a list of them. */
const KEY_MATERIAL = ['ca', 'cert', 'key', 'pfx', 'crl'] as const

/** Copies a `Buffer`, so a later write by the host does not reach the copy; anything else is kept. */
const copyBytes = (value: unknown): unknown => (Buffer.isBuffer(value) ? Buffer.from(value) : value)

/**
 * Copies a `tls` object once: its options by name, and the key material one level deeper. A list is
 * read once (the length first, each index once, both bounded like the other lists) and every `Buffer`
 * in it is copied, because the driver merges the object again on every reconnect and a list or a
 * `Buffer` the host changes later would change the trust roots or the identity it connects with. A
 * `secureContext` stays by reference.
 *
 * @param tls - The `tls` value as the host wrote it.
 * @returns A plain copy, or the value itself when it is not an object or is an array.
 * @throws {CacheException} `INVALID_OPTIONS` naming `tls.<option>` when a list is too long or its
 *   length is not a count.
 */
function readTls(tls: unknown): unknown {
  const copy = readPlain(tls, TLS_KEYS)
  if (copy !== tls) {
    for (const key of KEY_MATERIAL) {
      const material: unknown = Reflect.get(copy as object, key)
      if (material !== undefined) {
        Reflect.set(
          copy as object,
          key,
          Array.isArray(material)
            ? copyList(material, `tls.${key}`, copyBytes)
            : copyBytes(material)
        )
      }
    }
  }
  return copy
}

/** Copies a sentinel address, a cluster node or a `natMap` target once: host, port and family by name. */
const readEntry = (entry: unknown): unknown => readPlain(entry, ENTRY_KEYS)

/**
 * Copies a list the driver or the registry walks (`sentinels`, `nodes`, `scripts`): the length once,
 * checked against the cap before anything is allocated, and each entry once through `copy`. A value
 * that is not an array is kept as is, for validation to refuse.
 *
 * @param list - The list as the host wrote it.
 * @param option - The option's name, echoed when the list is too long.
 * @param copy - Copies one entry.
 * @returns A plain array of copied entries.
 * @throws {CacheException} `INVALID_OPTIONS` when the length is not a count, or the list holds more
 *   than the cap.
 */
function copyList(list: unknown, option: string, copy: (entry: unknown) => unknown): unknown {
  if (!Array.isArray(list)) {
    return list
  }
  const length: number = list.length
  if (!Number.isInteger(length) || length < 0) {
    refuseOption(option, 'has an invalid length', length)
  }
  if (length > MAX_LIST_ENTRIES) {
    refuseOption(option, 'has too many entries', length, { max: MAX_LIST_ENTRIES })
  }
  return Array.from({ length }, (_, index) => copy(list[index]))
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
      redisOptions: {
        ...node,
        tls: readTls(node.tls),
        sentinelTLS: readTls(node.sentinelTLS),
        natMap: copyNatMap(node.natMap)
      }
    })
  }
}

/**
 * Replaces the `connection`, `sentinel` and `cluster` blocks with plain copies read once, down to
 * the `tls`, `sentinels`, `nodes` and `natMap` values that reach the driver as objects, and the
 * `scripts` list the registry is seeded from.
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
    scripts: copyList(options.scripts, 'scripts', (definition) =>
      readPlain(definition, SCRIPT_KEYS)
    ),
    connection: isObject(standalone) ? { ...standalone, tls: readTls(standalone.tls) } : standalone,
    sentinel: isObject(sentinelBlock)
      ? {
          ...sentinelBlock,
          sentinels: copyList(sentinelBlock.sentinels, 'sentinel.sentinels', readEntry),
          natMap: copyNatMap(sentinelBlock.natMap)
        }
      : sentinelBlock,
    cluster: isObject(clusterBlock)
      ? {
          ...clusterBlock,
          nodes: copyList(clusterBlock.nodes, 'cluster.nodes', readEntry),
          options: readClusterOptions(clusterBlock.options)
        }
      : clusterBlock
  } as BymaxCacheModuleOptions
}
