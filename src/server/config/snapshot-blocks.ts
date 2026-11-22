/**
 * One read of every option block the host supplied.
 *
 * Layer: server. The blocks (`connection`, `sentinel`, `cluster`) are the host's own objects, and a
 * property of one can be a getter: a secret wiped after its first use, a lazy loader. Two reads of
 * such a property can answer differently, so validation and every client builder must share one
 * answer: each property is read here, once, by name from a typed list, into a plain copy.
 */
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import { types } from 'node:util'

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
export const STANDALONE_KEYS: Readonly<Record<keyof BymaxCacheStandaloneConnection, true>> = {
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
export const TLS_KEYS: Readonly<Record<keyof TlsConnectionOptions | 'profile', true>> = {
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

/**
 * The tls options that hold bytes the driver reads again on every reconnect: a string, a `Buffer`, or a
 * list of them. `ticketKeys` decides who can resume a session, `session` and `dhparam` are read the same
 * way, and `ALPNProtocols` is a list of names or a buffer.
 */
const KEY_MATERIAL = [
  'ca',
  'cert',
  'key',
  'pfx',
  'crl',
  'ticketKeys',
  'session',
  'dhparam',
  'ALPNProtocols'
] as const

/** Whether a value is an `ArrayBuffer` or a `SharedArrayBuffer`, which a view reads and a copy must own. */
function isBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer {
  return value instanceof ArrayBuffer || value instanceof SharedArrayBuffer
}

/**
 * Copies bytes the host could write to later: any view of an `ArrayBuffer` (a `Buffer`, a `Uint8Array`, a
 * `DataView`), an `ArrayBuffer` and a `SharedArrayBuffer` (another thread can write to one) become a
 * `Buffer` of their own; anything else is kept.
 */
function copyBytes(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  return isBuffer(value) ? Buffer.from(new Uint8Array(value)) : value
}

/** The tls options whose entries may be objects, with the field that holds their bytes. */
const ENTRY_BYTES = { key: 'pem', pfx: 'buf' } as const

/**
 * Copies an object entry of `tls.key` or `tls.pfx` by name: its bytes through {@link copyBytes} and its
 * passphrase, which must be a string. A `KeyObject` is kept as it is, and so are bytes (copied through
 * {@link copyBytes}) and anything that is not an object; every other object, whatever its prototype, is
 * read by name and copied, and one with another own key is refused, so nothing the driver would read
 * goes uncopied. An entry that holds no bytes is refused too, which a proxy over a `KeyObject` is.
 *
 * @param entry - The entry as the host wrote it.
 * @param option - The list's name, echoed with the entry's position.
 * @param field - The field that holds the bytes: `pem` for a key, `buf` for a pfx.
 * @param index - The entry's position.
 * @returns A plain copy, or the entry itself (copied when it is bytes) when it is a `KeyObject`, bytes or
 *   not an object.
 * @throws {CacheException} `INVALID_OPTIONS` naming the entry by position.
 */
function copyKeyEntry(entry: unknown, option: string, field: string, index: number): unknown {
  if (
    !isObject(entry) ||
    Array.isArray(entry) ||
    ArrayBuffer.isView(entry) ||
    isBuffer(entry) ||
    types.isKeyObject(entry)
  ) {
    return copyBytes(entry)
  }
  const where = `${option}[${index}]`
  if (Object.keys(entry).some((name) => name !== field && name !== 'passphrase')) {
    refuseOption(where, `has a key that is not ${field} or passphrase`, entry)
  }
  const passphrase: unknown = Reflect.get(entry, 'passphrase')
  if (passphrase !== undefined && typeof passphrase !== 'string') {
    refuseOption(`${where}.passphrase`, 'must be a string', passphrase)
  }
  const bytes: unknown = Reflect.get(entry, field)
  if (bytes === undefined) {
    refuseOption(where, `has no ${field}`, entry)
  }
  return { [field]: copyBytes(bytes), ...(passphrase !== undefined && { passphrase }) }
}

/**
 * Copies one key material option: a list through {@link copyList}, an object entry of `key` or `pfx`
 * through {@link copyKeyEntry}, anything else through {@link copyBytes}.
 *
 * @param material - The option's value as the host wrote it.
 * @param key - The option's name.
 * @returns The copy.
 */
function copyMaterial(material: unknown, key: (typeof KEY_MATERIAL)[number]): unknown {
  const option = `tls.${key}`
  const copyOne = (entry: unknown, index: number): unknown =>
    key === 'key' || key === 'pfx'
      ? copyKeyEntry(entry, option, ENTRY_BYTES[key], index)
      : copyBytes(entry)
  return Array.isArray(material)
    ? copyList(material, option, (entry, index) =>
        Array.isArray(entry)
          ? refuseOption(`${option}[${index}]`, 'must not be a list', entry)
          : copyOne(entry, index)
      )
    : copyOne(material, 0)
}

/**
 * Copies a `tls` object once: its options by name, and the key material one level deeper. A list is
 * read once (the length first, each index once, both bounded like the other lists) and every `Buffer`
 * element of it is copied, because the driver merges the object again on every reconnect and a list or
 * a `Buffer` the host changes later would change the trust roots or the identity it connects with. An
 * object entry of `key` or `pfx` (`{ pem, passphrase }`, `{ buf, passphrase }`) is copied by name too,
 * through `copyKeyEntry`; only a `KeyObject` and a
 * `secureContext` stay by reference.
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
        Reflect.set(copy as object, key, copyMaterial(material, key))
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
function copyList(
  list: unknown,
  option: string,
  copy: (entry: unknown, index: number) => unknown
): unknown {
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
  return Array.from({ length }, (_, index) => copy(list[index], index))
}

/**
 * Copies a `natMap` once, each entry once, after its key count is checked against the cap. A function
 * map and an array are kept as they are, the array for validation to refuse.
 *
 * @param map - The map as the host wrote it.
 * @param option - The map's name, echoed when it holds too many entries.
 * @returns A plain map of copied entries.
 * @throws {CacheException} `INVALID_OPTIONS` when the map holds more than the cap.
 */
function copyNatMap(map: unknown, option: string): unknown {
  if (!isObject(map) || Array.isArray(map)) {
    return map
  }
  const names = Object.keys(map)
  if (names.length > MAX_LIST_ENTRIES) {
    refuseOption(option, 'has too many entries', names.length, { max: MAX_LIST_ENTRIES })
  }
  return Object.fromEntries(names.map((name) => [name, readEntry(Reflect.get(map, name))]))
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
    natMap: copyNatMap(copy.natMap, 'cluster.options.natMap'),
    ...(node !== undefined && {
      redisOptions: {
        ...node,
        tls: readTls(node.tls),
        sentinelTLS: readTls(node.sentinelTLS),
        natMap: copyNatMap(node.natMap, 'cluster.options.redisOptions.natMap')
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
          natMap: copyNatMap(sentinelBlock.natMap, 'sentinel.natMap')
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
