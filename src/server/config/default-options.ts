/**
 * Option validation and defaulting.
 *
 * Layer: server. `validateOptions` enforces bootstrap invariants (fail fast at
 * `forRoot`, not at first command); `applyDefaults` merges consumer options with
 * library defaults and shallow-freezes the result so the resolved top-level
 * fields cannot be reassigned once registered. See
 * `docs/technical_specification.md` §4.6.
 */
import type { ClusterOptions, RedisOptions } from 'ioredis'

import {
  DEFAULT_KEY_ESCAPING,
  DEFAULT_KEY_SEPARATOR,
  DEFAULT_NAMESPACE
} from '../constants/default-namespace'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  MIN_COMMAND_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ESCAPE_CHAR } from '../utils/key-escape'
import { parseRedisUrl } from '../utils/parse-redis-url'
import { isUnset } from './is-unset'
import { takeOwnRefusal, refusal } from './own-refusals'
import { refuseOption, refuseValue } from './refuse-option'
import { requireText } from './require-text'
import type { ResolvedOptions } from './resolved-options'
import { snapshotBlocks } from './snapshot-blocks'
import { KNOWN_TLS_PROFILES } from './tls-profiles'

/**
 * Characters Redis reads as glob metacharacters inside a `SCAN` / `KEYS` match
 * pattern. Measured against Redis 8.10.0, not taken from documentation.
 *
 * The namespace is not cosmetic here: `KeyBuilder.getNamespacePrefix()` composes
 * it into `flushNamespace`'s destructive match pattern (`{namespace}{sep}*`), so
 * a metacharacter that survives validation changes which keys `UNLINK` reaches.
 * Each of these was measured to break isolation in a different direction:
 *
 * - `*` and `?` WIDEN the pattern. Namespace `ten*ant` matches every other
 *   tenant's keys, turning a namespace-scoped flush into a cross-tenant delete.
 * - `\` ESCAPES the next character. Namespace `ten\ant` matches `tenant:*` — a
 *   different keyspace — while sparing its own keys, so it deletes the wrong
 *   data and reports having done the right thing.
 * - `[` opens a character class that never closes, so the pattern matches
 *   NOTHING. `flushNamespace` removes none of the namespace's keys and returns
 *   `0`, which reads as a successful flush of an empty namespace.
 *
 * `]` is deliberately absent. Unpaired it is a literal to Redis and matches only
 * its own keyspace (measured), so rejecting it would restrict a namespace the
 * library handles correctly.
 */
const GLOB_METACHARACTERS: ReadonlySet<string> = new Set(['*', '?', '[', '\\'])

/**
 * Finds the first Redis glob metacharacter in a namespace.
 *
 * Returns the character rather than a boolean so the thrown `details` can name
 * what was found — a consumer whose namespace comes from a slug needs to know
 * which character to strip, not merely that one is present.
 *
 * @param namespace - The configured namespace.
 * @returns The offending character, or `null` when the namespace is safe to
 *   compose into a match pattern.
 */
function findGlobMetacharacter(namespace: string): string | null {
  for (const character of namespace) {
    if (GLOB_METACHARACTERS.has(character)) {
      return character
    }
  }
  return null
}

/**
 * Refuses a `connection.url` that does not parse, in every mode.
 *
 * The connection manager parses it whatever the mode, and the raw parse error carries the whole URL,
 * credentials included, so it must never escape. The URL is omitted from `details` since it may embed
 * credentials (CLAUDE.md section 4).
 *
 * @param url - The configured URL, when there is one.
 * @throws {CacheException} `CONNECTION_FAILED` when the URL is malformed.
 */
function validateConnectionUrl(url: string | undefined): void {
  if (!url) {
    return
  }
  try {
    parseRedisUrl(url)
  } catch {
    throw refusal(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'invalid connection.url'
    })
  }
}

/**
 * Validates the standalone connection block.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `CONNECTION_FAILED` when neither `url` nor `host` is
 *   set.
 */
function validateStandaloneConnection(options: BymaxCacheModuleOptions): void {
  const connection = options.connection
  if (!connection || (!connection.url && !connection.host)) {
    throw refusal(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'missing connection.url or connection.host'
    })
  }
}

/**
 * Validates the key separator and the escaping mode it is used with.
 *
 * Runs in the order the checks were written, which is the order a consumer is told about them:
 * an empty separator, an unknown mode, then the strict-only restrictions.
 *
 * @param separator - The resolved key separator.
 * @param keyEscaping - The resolved key composition mode.
 * @throws {CacheException} `INVALID_NAMESPACE` when the separator is empty, `keyEscaping` is neither
 *   mode, or the mode is `'strict'` and the separator contains the escape character, a surrogate
 *   code unit (an astral character or an unpaired surrogate), or a glob metacharacter.
 */
function validateSeparator(separator: string, keyEscaping: string): void {
  const refuse = (problem: string, bounds?: Readonly<Record<string, number | string>>): never =>
    refuseValue(CACHE_ERROR_CODES.INVALID_NAMESPACE, 'keySeparator', problem, separator, bounds)
  // Checked before the namespace `includes` guard, which would otherwise absorb this
  // case: `'anything'.includes('')` is true for every string, so an empty
  // separator used to be rejected by a check written for a different condition
  // and reported as "namespace contains key separator" — something the consumer
  // did not do.
  if (separator === '') {
    refuse('is empty')
  }
  if (keyEscaping !== 'legacy' && keyEscaping !== 'strict') {
    refuseValue(CACHE_ERROR_CODES.INVALID_NAMESPACE, 'keyEscaping', 'is unknown', keyEscaping, {
      allowed: 'legacy or strict'
    })
  }
  // Only under strict: legacy never rewrites a part, so the escape character cannot reappear inside
  // one, and a configuration that boots today must keep booting.
  if (keyEscaping === 'strict' && separator.includes(ESCAPE_CHAR)) {
    refuse('contains the escape character')
  }
  // Only under strict. An astral character is two surrogate code units, and a pattern holding the
  // pair or one half of it cannot be judged exactly against the ids strict stores (a lone surrogate
  // reaches Redis as U+FFFD, a pair is escaped whole), so the separator is asked to be BMP.
  if (keyEscaping === 'strict' && /[\ud800-\udfff]/.test(separator)) {
    refuse('contains a surrogate code unit')
  }
  // Only under strict, like the `%` rule above. A glob character in the separator widens every
  // pattern built from it, `flushNamespace`'s `{namespace}{separator}*` included.
  const separatorGlob = keyEscaping === 'strict' ? findGlobMetacharacter(separator) : null
  if (separatorGlob !== null) {
    refuse('contains glob metacharacter', { metacharacter: separatorGlob })
  }
}

/**
 * Validates the namespace and key separator, the pair that forms this library's
 * isolation boundary.
 *
 * @param namespace - The resolved namespace.
 * @param separator - The resolved key separator.
 * @param keyEscaping - The resolved key composition mode.
 * @throws {CacheException} `INVALID_NAMESPACE` when the namespace or the separator is not a string,
 *   the namespace is empty or contains a Redis glob metacharacter or the separator, or when
 *   {@link validateSeparator} refuses the separator. The details name the option and the type
 *   received, never the value.
 */
function validateNamespace(namespace: string, separator: string, keyEscaping: string): void {
  if (typeof namespace !== 'string') {
    refuseValue(CACHE_ERROR_CODES.INVALID_NAMESPACE, 'namespace', 'must be a string', namespace)
  }
  if (typeof separator !== 'string') {
    refuseValue(CACHE_ERROR_CODES.INVALID_NAMESPACE, 'keySeparator', 'must be a string', separator)
  }
  if (namespace.trim() === '') {
    refuseValue(CACHE_ERROR_CODES.INVALID_NAMESPACE, 'namespace', 'is empty', namespace)
  }
  validateSeparator(separator, keyEscaping)
  const metacharacter = findGlobMetacharacter(namespace)
  if (metacharacter !== null) {
    refuseValue(
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      'namespace',
      'contains glob metacharacter',
      namespace,
      { metacharacter }
    )
  }
  if (namespace.includes(separator)) {
    refuseValue(
      CACHE_ERROR_CODES.INVALID_NAMESPACE,
      'namespace',
      'contains key separator',
      namespace
    )
  }
}

/**
 * Refuses a `null` credential or tls field. Where an option's default is the weaker security posture,
 * only `undefined` means unset: a secret that failed to load and reached the options as `null` would
 * otherwise connect without authentication or without tls, silently.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `INVALID_OPTIONS` naming the field, with `received` `'null'`.
 */
function validateNoNullSecrets(options: BymaxCacheModuleOptions): void {
  const redisOptions = options.cluster?.options?.redisOptions
  const fields = [
    ['connection.password', options.connection?.password],
    ['connection.username', options.connection?.username],
    ['connection.tls', options.connection?.tls],
    ['sentinel.password', options.sentinel?.password],
    ['sentinel.sentinelPassword', options.sentinel?.sentinelPassword],
    ['cluster.options.redisOptions.password', redisOptions?.password],
    ['cluster.options.redisOptions.username', redisOptions?.username],
    ['cluster.options.redisOptions.tls', redisOptions?.tls],
    ['cluster.options.redisOptions.sentinelTLS', redisOptions?.sentinelTLS]
  ] as const
  for (const [option, value] of fields) {
    if ((value as unknown) === null) {
      refuseOption(option, 'must not be null', value)
    }
  }
}

/**
 * Refuses a `tls` of a kind the driver cannot use (a number, an array, a function), and a tls profile
 * it does not resolve. The driver resolves a profile by name and leaves a connection without the pinned
 * authority for any other value, so an unknown name, a number or an object in `profile` is refused
 * rather than accepted silently. `true` and `false` are accepted: `true` makes the driver speak tls
 * with its defaults.
 *
 * @param option - The option's name, echoed in the error.
 * @param tls - The `tls` value: an object whose `profile` is checked, the profile name itself, or a flag.
 * @throws {CacheException} `INVALID_OPTIONS` naming the option when the kind is unusable or the profile
 *   is not a known name.
 */
function validateTlsProfile(option: string, tls: unknown): void {
  if (
    tls !== undefined &&
    typeof tls !== 'boolean' &&
    typeof tls !== 'string' &&
    (typeof tls !== 'object' || Array.isArray(tls))
  ) {
    refuseOption(option, 'must be an object, a profile name or a boolean', tls)
  }
  let profile: unknown
  if (typeof tls === 'string') {
    profile = tls
  } else if (typeof tls === 'object' && tls !== null) {
    profile = Reflect.get(tls, 'profile')
  }
  if (
    profile !== undefined &&
    !(typeof profile === 'string' && KNOWN_TLS_PROFILES.includes(profile))
  ) {
    refuseOption(
      typeof tls === 'string' ? option : `${option}.profile`,
      'is not a known tls profile',
      profile,
      { allowed: KNOWN_TLS_PROFILES.join(' or ') }
    )
  }
}

/**
 * Refuses an entry of `sentinels` or `cluster.nodes` that is not an address: an array, a function, a
 * boolean or `null`. A node may also be a `host:port` string or a port number; a sentinel may not.
 *
 * @param option - The list's name, echoed with the entry's position.
 * @param list - The list as copied by the snapshot; anything that is not an array is left to the caller.
 * @param shorthand - Whether a string or a number is an address too.
 * @throws {CacheException} `INVALID_OPTIONS` naming the entry.
 */
function validateAddresses(option: string, list: unknown, shorthand: boolean): void {
  if (Array.isArray(list)) {
    list.forEach((entry: unknown, index: number) => {
      const address = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      if (!address && !(shorthand && (typeof entry === 'string' || typeof entry === 'number'))) {
        refuseOption(`${option}[${index}]`, 'must be an address', entry)
      }
    })
  }
}

/**
 * Refuses a `natMap` entry that is not an object. A function map is accepted as it is.
 *
 * @param option - The map's name, echoed with the entry's position.
 * @param map - The map as copied by the snapshot.
 * @throws {CacheException} `INVALID_OPTIONS` naming the entry by position, never by key.
 */
function validateNatMap(option: string, map: unknown): void {
  if (
    map !== undefined &&
    typeof map !== 'function' &&
    (typeof map !== 'object' || Array.isArray(map))
  ) {
    refuseOption(option, 'must be an object or a function', map)
  }
  if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
    Object.values(map).forEach((entry: unknown, index: number) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        refuseOption(`${option}[${index}]`, 'must be an address', entry)
      }
    })
  }
}

/**
 * Refuses a script definition that is not an object with a name and a source, each a non-empty string.
 *
 * @param scripts - The `scripts` option as copied by the snapshot.
 * @throws {CacheException} `INVALID_OPTIONS` naming the entry and the field.
 */
function validateScripts(scripts: unknown): void {
  if (scripts === undefined || scripts === null) {
    return
  }
  if (!Array.isArray(scripts)) {
    refuseOption('scripts', 'must be an array', scripts)
  }
  scripts.forEach((definition: unknown, index: number) => {
    const where = `scripts[${index}]`
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
      refuseOption(where, 'must be an object', definition)
    }
    for (const field of ['name', 'lua'] as const) {
      requireText(`${where}.${field}`, Reflect.get(definition, field))
    }
  })
}

/**
 * Validates the connect and command timers of one option group.
 *
 * @param group - The group's path, prefixed to each option name in the error.
 * @param source - The group's options; `undefined` or `null` means the group is absent.
 * @throws {CacheException} `INVALID_OPTIONS` when a timer is out of range.
 */
function requireTimers(
  group: string,
  source:
    | { connectTimeout?: number | null | undefined; commandTimeout?: number | null | undefined }
    | null
    | undefined
): void {
  requireTimerDelay(`${group}.connectTimeout`, source?.connectTimeout, MIN_CONNECT_TIMEOUT_MS)
  requireTimerDelay(`${group}.commandTimeout`, source?.commandTimeout, MIN_COMMAND_TIMEOUT_MS)
}

/** The values `scaleReads` takes besides a function. */
const SCALE_READS = ['all', 'master', 'slave']

/**
 * Refuses a `scaleReads` that is not one of its three names or a function, and a `himportFieldsets`
 * that is not a list, naming the option and the type only: the driver refuses both on its own, and
 * the message of the first prints the value.
 *
 * @param options - The `cluster.options` group as copied by the snapshot; absent means nothing to check.
 * @throws {CacheException} `INVALID_OPTIONS` naming the option.
 */
function validateDriverKinds(options: ClusterOptions | undefined): void {
  const scaleReads: unknown = options?.scaleReads
  if (
    scaleReads !== undefined &&
    typeof scaleReads !== 'function' &&
    !SCALE_READS.includes(scaleReads as string)
  ) {
    refuseOption(
      'cluster.options.scaleReads',
      "must be 'all', 'master', 'slave' or a function",
      scaleReads
    )
  }
  const himportFieldsets: unknown = options?.himportFieldsets
  if (himportFieldsets !== undefined && !Array.isArray(himportFieldsets)) {
    refuseOption('cluster.options.himportFieldsets', 'must be a list', himportFieldsets)
  }
}

/**
 * Validates the cluster-specific options.
 *
 * @param options - The raw consumer options, already known to carry a `cluster` block.
 * @throws {CacheException} `INVALID_OPTIONS` when a `connection` option that a cluster ignores is
 *   set, or when a timer in `cluster.options.redisOptions` is out of range.
 */
function validateClusterOptions(options: BymaxCacheModuleOptions): void {
  const connection = options.connection
  // Each option a cluster ignores, with the place a cluster takes it from: the cluster client is
  // built from `cluster`, so one set here would leave a password or TLS silently unconfigured.
  const ignored = [
    ['password', connection?.password, 'cluster.options.redisOptions.password'],
    ['username', connection?.username, 'cluster.options.redisOptions.username'],
    ['tls', connection?.tls, 'cluster.options.redisOptions.tls'],
    ['lazyConnect', connection?.lazyConnect, 'cluster.options.lazyConnect']
  ] as const
  for (const [option, value, target] of ignored) {
    if (!isUnset(value)) {
      refuseOption(`connection.${option}`, `is ignored in cluster mode; set ${target}`, value)
    }
  }
  validateDriverKinds(options.cluster?.options)
  const redisOptions = options.cluster?.options?.redisOptions
  requireTimers('cluster.options.redisOptions', redisOptions)
  validateConnectionNumbers('cluster.options.redisOptions', redisOptions)
}

/**
 * Refuses the values the driver or the registry would take as they are and fail on later: a tls of an
 * unusable kind or with an unknown profile, an entry of a list that is not an address, a `natMap` entry
 * that is not an object, and a script definition that is not a name and a source.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `INVALID_OPTIONS` naming the option, the entry or the field.
 */
function validateShapes(options: BymaxCacheModuleOptions): void {
  validateTlsProfile('connection.tls', options.connection?.tls)
  validateTlsProfile(
    'cluster.options.redisOptions.tls',
    options.cluster?.options?.redisOptions?.tls
  )
  validateTlsProfile(
    'cluster.options.redisOptions.sentinelTLS',
    options.cluster?.options?.redisOptions?.sentinelTLS
  )
  validateAddresses('sentinel.sentinels', options.sentinel?.sentinels, false)
  validateAddresses('cluster.nodes', options.cluster?.nodes, true)
  validateNatMap('sentinel.natMap', options.sentinel?.natMap)
  validateNatMap('cluster.options.natMap', options.cluster?.options?.natMap)
  validateNatMap(
    'cluster.options.redisOptions.natMap',
    options.cluster?.options?.redisOptions?.natMap
  )
  validateScripts(options.scripts)
}

/**
 * Validates consumer options at module bootstrap, throwing actionable
 * {@link CacheException}s when an invariant is violated.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `SENTINEL_MISCONFIGURED`, `CLUSTER_MISCONFIGURED`,
 *   `CONNECTION_FAILED`, `INVALID_NAMESPACE` or `INVALID_OPTIONS` depending on the violation.
 */
export function validateOptions(options: BymaxCacheModuleOptions): void {
  const mode = options.mode ?? 'standalone'

  if (mode === 'sentinel') {
    if (!options.sentinel || !options.sentinel.sentinels?.length || !options.sentinel.name) {
      throw refusal(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'cluster') {
    if (!options.cluster || !options.cluster.nodes?.length) {
      throw refusal(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, { mode })
    }
    validateClusterOptions(options)
  }
  validateNoNullSecrets(options)
  validateConnectionUrl(options.connection?.url)
  validateShapes(options)
  if (mode === 'standalone') {
    validateStandaloneConnection(options)
  }

  validateNamespace(
    options.namespace ?? DEFAULT_NAMESPACE,
    options.keySeparator ?? DEFAULT_KEY_SEPARATOR,
    options.keyEscaping ?? DEFAULT_KEY_ESCAPING
  )

  requireTimerDelay(
    'shutdownTimeoutMs',
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    MIN_SHUTDOWN_TIMEOUT_MS
  )
  requireTimers('connection', options.connection)
  validateConnectionNumbers(
    'connection',
    options.connection,
    options.connection?.url ? parseRedisUrl(options.connection.url) : undefined
  )
  validateHandlerBounds(options)
}

/**
 * Rejects a handler bound that is not an integer in range, and a queue bound with no concurrency bound
 * to queue behind.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `INVALID_OPTIONS` naming the option, the type of the value received (a finite number as itself) and the accepted range.
 */
function validateHandlerBounds(options: BymaxCacheModuleOptions): void {
  const { pubsubMaxConcurrentHandlers: slots, pubsubMaxQueuedMessages: queued } = options
  if (isUnset(slots) && !isUnset(queued)) {
    throw refusal(CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: 'pubsubMaxQueuedMessages needs pubsubMaxConcurrentHandlers'
    })
  }
  for (const [option, value, min] of [
    ['pubsubMaxConcurrentHandlers', slots, 1],
    ['pubsubMaxQueuedMessages', queued, 0]
  ] as const) {
    if (
      !isUnset(value) &&
      (!Number.isInteger(value) || value < min || value > MAX_TIMER_DELAY_MS)
    ) {
      refuseOption(option, 'not an integer in range', value, {
        min,
        max: MAX_TIMER_DELAY_MS
      })
    }
  }
}

/** The numeric connection options a connection block and `cluster.options.redisOptions` share. */
interface NumericConnectionOptions {
  readonly port?: unknown
  readonly db?: unknown
  readonly keepAlive?: unknown
  readonly maxRetriesPerRequest?: unknown
}

/**
 * Rejects a numeric connection option the driver would take literally and a bound would be lost:
 * `NaN`, an infinity, a fraction or a string. The driver counts retries only when
 * `maxRetriesPerRequest` is a number from 0, and hands `keepAlive` to the socket, where `NaN` and 0
 * mean the operating system's own delay instead of the 30 s probe. `maxRetriesPerRequest`
 * of `null` is refused too: it is the driver's "retry without limit", which would undo the fail-fast
 * outage design and leave only `commandTimeout` to bound a command.
 *
 * @param where - The block the options sit in, echoed in the error details.
 * @param options - The block, or `undefined` when it is not set.
 * @param fromUrl - What the block's `url` carries. It always replaces the discrete `port`, and the
 *   discrete `db` when its path names a database; a value it replaces is never used and not checked.
 * @throws {CacheException} `INVALID_OPTIONS` naming the option, the type of the value received (a finite number as itself) and the accepted range.
 */
function validateConnectionNumbers(
  where: string,
  options: NumericConnectionOptions | null | undefined,
  fromUrl: Partial<RedisOptions> = {}
): void {
  if (options === undefined || options === null) {
    return
  }
  const ranges = [
    ['port', fromUrl.port === undefined ? options.port : undefined, 1, 65_535, undefined],
    ['db', fromUrl.db === undefined ? options.db : undefined, 0, MAX_TIMER_DELAY_MS, undefined],
    [
      'keepAlive',
      options.keepAlive,
      1,
      MAX_TIMER_DELAY_MS,
      { when: 0, text: '0 is the OS default delay: the 30 s probe is lost' }
    ],
    [
      'maxRetriesPerRequest',
      options.maxRetriesPerRequest,
      0,
      MAX_TIMER_DELAY_MS,
      { when: null, text: 'null lifts the retry bound: only commandTimeout would bound a command' }
    ]
  ] as const
  for (const [option, value, min, max, why] of ranges) {
    // `null` is unset too, except for `maxRetriesPerRequest`, where it is the driver's "retry forever".
    const unset = option === 'maxRetriesPerRequest' ? value === undefined : isUnset(value)
    const inRange =
      typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    if (!unset && !inRange) {
      refuseOption(`${where}.${option}`, 'not an integer in range', value, {
        min,
        max,
        ...(why !== undefined && value === why.when ? { why: why.text } : {})
      })
    }
  }
}

/**
 * Rejects a timeout that `setTimeout` would not honour or that is below its minimum: `NaN`, a
 * fraction, an infinity or a delay above 2^31-1 ms is stored as 1 ms, so the timer fires at once.
 *
 * @param option - The option's full name, group prefix included, echoed in the error details.
 * @param value - The configured delay in milliseconds; `undefined` or `null` means the option is unset.
 * @param min - The smallest accepted delay.
 * @throws {CacheException} `INVALID_OPTIONS` when the value is not a finite integer within range or is below `min`.
 */
function requireTimerDelay(option: string, value: number | null | undefined, min: number): void {
  if (isUnset(value)) {
    return
  }
  if (!Number.isInteger(value) || value > MAX_TIMER_DELAY_MS) {
    refuseOption(option, 'not a valid timer delay', value, { max: MAX_TIMER_DELAY_MS })
  }
  if (value < min) {
    refuseOption(option, 'too low', value, { min })
  }
}

/**
 * Merges consumer options with library defaults and shallow-freezes the result.
 *
 * The top-level resolved object is frozen so its fields cannot be reassigned
 * after registration. Nested blocks (`connection`, `serializer`, `events`,
 * `sentinel`, `cluster`, `scripts`) are kept by reference and intentionally NOT
 * deep-frozen — they may be consumer-owned instances (e.g. a serializer) that
 * freezing in place could break.
 *
 * @param options - The raw consumer options.
 * @returns A shallow-frozen {@link ResolvedOptions} carrying every defaulted field.
 */
export function applyDefaults(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions> {
  const resolved: ResolvedOptions = {
    mode: options.mode ?? 'standalone',
    connection: options.connection,
    sentinel: options.sentinel,
    cluster: options.cluster,
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    keySeparator: options.keySeparator ?? DEFAULT_KEY_SEPARATOR,
    keyEscaping: options.keyEscaping ?? DEFAULT_KEY_ESCAPING,
    serializer: options.serializer,
    events: options.events,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    allowFlushInProduction: options.allowFlushInProduction ?? false,
    isGlobal: options.isGlobal ?? true,
    scripts: options.scripts,
    pubsubMaxConcurrentHandlers: isUnset(options.pubsubMaxConcurrentHandlers)
      ? undefined
      : options.pubsubMaxConcurrentHandlers,
    pubsubMaxQueuedMessages: isUnset(options.pubsubMaxQueuedMessages)
      ? undefined
      : options.pubsubMaxQueuedMessages
  }
  // The three connection shapes carry the Redis credentials — a `url` holds the
  // password inline, and the discrete forms hold it as a field. This object is
  // injected into ConnectionManager, PubSubService and CacheService, so an
  // enumerable `connection` is emitted by anything that serializes one of them
  // incidentally: a structured logger rendering its arguments, an error reporter
  // capturing the scope of a throw. Attaching them as non-enumerable accessors
  // withholds them from `JSON.stringify`, object spread and `util.inspect` —
  // including `showHidden`, which still prints a hidden data property. Reads are
  // unchanged.
  for (const key of ['connection', 'sentinel', 'cluster'] as const) {
    // Read through the descriptor rather than by bracket index: the value is the
    // same, and the property name never becomes a dynamic lookup key.
    const value: unknown = Object.getOwnPropertyDescriptor(resolved, key)?.value
    Object.defineProperty(resolved, key, {
      get: (): unknown => value,
      enumerable: false,
      // Stryker disable next-line BooleanLiteral: equivalent HERE — `resolved` is `Object.freeze`d on the way out and freezing makes every property non-configurable anyway, so flipping this flag changes nothing observable. It stays because it states the guarantee where the accessor is defined, and nest-storage withholds its credentials the same way WITHOUT freezing, where this flag is the only thing enforcing it.
      configurable: false
    })
  }

  return Object.freeze(resolved)
}

/**
 * Every top-level option, as a complete record: an option added to the interface fails the type
 * check here until it is listed, so the snapshot cannot miss one. Only the keys are read.
 */
// Stryker disable BooleanLiteral: only the keys of the record are read, so flipping a `true` value changes nothing
const OPTION_KEYS: Readonly<Record<keyof BymaxCacheModuleOptions, true>> = {
  mode: true,
  connection: true,
  sentinel: true,
  cluster: true,
  namespace: true,
  keySeparator: true,
  keyEscaping: true,
  serializer: true,
  events: true,
  shutdownTimeoutMs: true,
  pubsubMaxConcurrentHandlers: true,
  pubsubMaxQueuedMessages: true,
  allowFlushInProduction: true,
  isGlobal: true,
  scripts: true
}
// Stryker restore BooleanLiteral

/**
 * Validates the consumer options and applies the defaults: the one sequence every entry
 * point (`forRoot`, `forRootAsync`, `createConnectionManager`) runs before it builds
 * anything from them.
 *
 * Each top-level option, and each property of the `connection`, `sentinel` and `cluster` blocks and
 * of `cluster.options` and its `redisOptions`, is read once, under one guard, into a plain copy that
 * both steps and every builder then read, so what is validated is what is applied. A read that
 * throws, a getter or a proxy trap of the host's, ends as `INVALID_OPTIONS`
 * (`reason: 'option could not be read'`) with the host's error on `cause` and none of its text in
 * `details`. The `tls` object, the `sentinels` and `cluster.nodes` lists, the `natMap` objects the
 * driver reads on every connect and the `scripts` list are copied once the same way; the key material of
 * a `tls` (`ca`, `cert`, `key`, `pfx`, `crl`) is copied as well, its lists read once and its `Buffer`s
 * copied, and a `secureContext` is kept by reference.
 *
 * @param options - The raw consumer options.
 * @returns A shallow-frozen {@link ResolvedOptions} carrying every defaulted field.
 * @throws {CacheException} Whatever {@link validateOptions} throws for a violation, and
 *   `INVALID_OPTIONS` for an option that could not be read.
 */
export function resolveOptions(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions> {
  return readingOptions(() => {
    const snapshot = snapshotBlocks(
      Object.fromEntries(
        Object.keys(OPTION_KEYS).map((key) => [key, Reflect.get(options, key)])
      ) as BymaxCacheModuleOptions
    )
    validateOptions(snapshot)
    return applyDefaults(snapshot)
  })
}

/**
 * Runs a read of the host's option objects so that a getter or a proxy trap of theirs that throws
 * ends as `INVALID_OPTIONS` (`reason: 'option could not be read'`) with the thrown error on
 * `cause`, and a {@link CacheException} the library raises passes through with its own code.
 *
 * @typeParam T - What the read returns.
 * @param read - The read.
 * @returns What the read returns.
 * @throws {CacheException} `INVALID_OPTIONS` when the read throws something that is not one.
 */
export function readingOptions<T>(read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (takeOwnRefusal(error)) {
      throw error
    }
    throw new CacheException(
      CACHE_ERROR_CODES.INVALID_OPTIONS,
      { reason: 'option could not be read' },
      undefined,
      error
    )
  }
}
