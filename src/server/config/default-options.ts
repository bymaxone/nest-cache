/**
 * Option validation and defaulting.
 *
 * Layer: server. `validateOptions` enforces bootstrap invariants (fail fast at
 * `forRoot`, not at first command); `applyDefaults` merges consumer options with
 * library defaults and shallow-freezes the result so the resolved top-level
 * fields cannot be reassigned once registered. See
 * `docs/technical_specification.md` §4.6.
 */
import type { ResolvedOptions } from './resolved-options'
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
 * Validates the standalone connection block.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `CONNECTION_FAILED` when neither `url` nor `host` is
 *   set, or when the URL is malformed.
 */
function validateStandaloneConnection(options: BymaxCacheModuleOptions): void {
  const connection = options.connection
  if (!connection || (!connection.url && !connection.host)) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
      reason: 'missing connection.url or connection.host'
    })
  }
  if (connection.url) {
    try {
      parseRedisUrl(connection.url)
    } catch {
      // Surface a malformed URL as the library's structured error at bootstrap
      // rather than a raw Error during connection-manager construction. The URL
      // is omitted from `details` since it may embed credentials (CLAUDE.md §4).
      throw new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, {
        reason: 'invalid connection.url'
      })
    }
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
  // Checked before the namespace `includes` guard, which would otherwise absorb this
  // case: `'anything'.includes('')` is true for every string, so an empty
  // separator used to be rejected by a check written for a different condition
  // and reported as "namespace contains key separator" — something the consumer
  // did not do.
  if (separator === '') {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'empty key separator',
      separator
    })
  }
  if (keyEscaping !== 'legacy' && keyEscaping !== 'strict') {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'unknown keyEscaping',
      keyEscaping
    })
  }
  // Only under strict: legacy never rewrites a part, so the escape character cannot reappear inside
  // one, and a configuration that boots today must keep booting.
  if (keyEscaping === 'strict' && separator.includes(ESCAPE_CHAR)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'key separator contains the escape character',
      separator
    })
  }
  // Only under strict. An astral character is two surrogate code units, and a pattern holding the
  // pair or one half of it cannot be judged exactly against the ids strict stores (a lone surrogate
  // reaches Redis as U+FFFD, a pair is escaped whole), so the separator is asked to be BMP.
  if (keyEscaping === 'strict' && /[\ud800-\udfff]/.test(separator)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'key separator contains a surrogate code unit',
      separator
    })
  }
  // Only under strict, like the `%` rule above. A glob character in the separator widens every
  // pattern built from it, `flushNamespace`'s `{namespace}{separator}*` included.
  const separatorGlob = keyEscaping === 'strict' ? findGlobMetacharacter(separator) : null
  if (separatorGlob !== null) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'key separator contains glob metacharacter',
      separator,
      metacharacter: separatorGlob
    })
  }
}

/**
 * Validates the namespace and key separator, the pair that forms this library's
 * isolation boundary.
 *
 * @param namespace - The resolved namespace.
 * @param separator - The resolved key separator.
 * @param keyEscaping - The resolved key composition mode.
 * @throws {CacheException} `INVALID_NAMESPACE` when the namespace is empty or contains a Redis glob
 *   metacharacter or the separator, or when {@link validateSeparator} refuses the separator.
 */
function validateNamespace(namespace: string, separator: string, keyEscaping: string): void {
  if (!namespace || namespace.trim() === '') {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, { namespace })
  }
  validateSeparator(separator, keyEscaping)
  const metacharacter = findGlobMetacharacter(namespace)
  if (metacharacter !== null) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'namespace contains glob metacharacter',
      namespace,
      metacharacter
    })
  }
  if (namespace.includes(separator)) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
      reason: 'namespace contains key separator',
      namespace,
      separator
    })
  }
}

/**
 * Validates consumer options at module bootstrap, throwing actionable
 * {@link CacheException}s when an invariant is violated.
 *
 * @param options - The raw consumer options.
 * @throws {CacheException} `SENTINEL_MISCONFIGURED`, `CLUSTER_MISCONFIGURED`,
 *   `CONNECTION_FAILED`, or `INVALID_NAMESPACE` depending on the violation.
 */
export function validateOptions(options: BymaxCacheModuleOptions): void {
  const mode = options.mode ?? 'standalone'

  if (mode === 'sentinel') {
    if (!options.sentinel || !options.sentinel.sentinels?.length || !options.sentinel.name) {
      throw new CacheException(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, { mode })
    }
  }
  if (mode === 'cluster') {
    if (!options.cluster || !options.cluster.nodes?.length) {
      throw new CacheException(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, { mode })
    }
  }
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
  requireTimerDelay('connectTimeout', options.connection?.connectTimeout, MIN_CONNECT_TIMEOUT_MS)
  requireTimerDelay('commandTimeout', options.connection?.commandTimeout, MIN_COMMAND_TIMEOUT_MS)
}

/**
 * Rejects a timeout that `setTimeout` would not honour or that is below its minimum: `NaN`, a
 * fraction, an infinity or a delay above 2^31-1 ms is stored as 1 ms, so the timer fires at once.
 *
 * @param option - The option name, echoed in the error details.
 * @param value - The configured delay in milliseconds; `undefined` means the option is unset.
 * @param min - The smallest accepted delay.
 * @throws {CacheException} `INVALID_OPTIONS` when the value is not a finite integer within range or is below `min`.
 */
function requireTimerDelay(option: string, value: number | undefined, min: number): void {
  if (value === undefined) {
    return
  }
  if (!Number.isInteger(value) || value > MAX_TIMER_DELAY_MS) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: `${option} not a valid timer delay`,
      value,
      max: MAX_TIMER_DELAY_MS
    })
  }
  if (value < min) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: `${option} too low`,
      value,
      min
    })
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
    scripts: options.scripts
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
 * Validates the consumer options and applies the defaults: the one sequence every entry
 * point (`forRoot`, `forRootAsync`, `createConnectionManager`) runs before it builds
 * anything from them.
 *
 * @param options - The raw consumer options.
 * @returns A shallow-frozen {@link ResolvedOptions} carrying every defaulted field.
 * @throws {CacheException} Whatever {@link validateOptions} throws for a violation.
 */
export function resolveOptions(options: BymaxCacheModuleOptions): Readonly<ResolvedOptions> {
  validateOptions(options)
  return applyDefaults(options)
}
