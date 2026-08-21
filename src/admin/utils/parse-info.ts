/**
 * Reads Redis `INFO` text into a typed reading.
 *
 * Layer: admin. `INFO` is section headers (`# Memory`), `field:value` lines and
 * blank lines separated by CRLF. Every value arrives as text — a count, a ratio
 * and a Unix timestamp are indistinguishable until something decides which is
 * which, and that decision is this module's whole content.
 *
 * Parsed here rather than by each consumer: the format is a wire detail, and
 * interpreting it once on the side that can be tested against a real server
 * beats every surface holding its own copy of the rules.
 *
 * The field names are asserted against a real Redis in the E2E suite rather than
 * taken from documentation. A Redis test double returns whatever its fixture
 * decided, so every name here would pass a unit suite while being wrong — a
 * double cannot falsify an assumption about the thing it stands in for.
 */
import type {
  BgsaveStatus,
  MaxMemory,
  RedisStats,
  ReplicationRole
} from '../types/redis-stats.types'

/** Separates a field name from its value on an `INFO` line. */
const FIELD_SEPARATOR = ':'

/** Marks a section header, which carries no field. */
const SECTION_PREFIX = '#'

/** How Redis spells "no memory ceiling configured". */
const UNBOUNDED_MAXMEMORY = 0

/** Seconds per millisecond, for turning a Unix timestamp into an instant. */
const MS_PER_SECOND = 1000

/** What Redis reports for a background save that has not failed. */
const BGSAVE_OK = 'ok'

/** What Redis reports for a background save that failed. */
const BGSAVE_ERROR = 'err'

/** How Redis spells a true boolean in `INFO`. */
const INFO_TRUE = '1'

/** The wire spelling Redis uses for a replica in the replication section. */
const WIRE_REPLICA_ROLE = 'slave'

/** Matches a value this parser is willing to read as a number: optional sign,
 * digits, optional fraction, optional decimal exponent. Anchored so nothing
 * else — hex, whitespace-only, trailing text — is coerced into a measurement. */
const NUMERIC_VALUE = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/

/**
 * Splits `INFO` text into its fields.
 *
 * Section headers are dropped rather than used to namespace the fields: `INFO`
 * field names are already unique across sections, and keying by section would
 * make this depend on header spellings that vary between versions while the
 * field names do not.
 *
 * @param text - The raw `INFO` output.
 * @returns Field name to raw text value.
 */
export function parseInfoFields(text: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    // Section headers are dropped here. Blank lines need no branch of their own:
    // an empty line has no separator, so the `cut <= 0` guard below already skips
    // it — a `line.length === 0` check would be a fast path no behaviour depends
    // on, and therefore one no test could ever hold to account.
    if (line.startsWith(SECTION_PREFIX)) {
      continue
    }
    const cut = line.indexOf(FIELD_SEPARATOR)
    // `cut === 0` is a line whose separator is its first character: an empty
    // field name, which no caller can ask for. `cut === -1` is a line with no
    // separator at all, which includes every blank line.
    if (cut <= 0) {
      continue
    }
    fields.set(line.slice(0, cut), line.slice(cut + 1))
  }
  return fields
}

/**
 * Reads a field as text.
 *
 * @param fields - The parsed fields.
 * @param name - The `INFO` field name.
 * @returns The value, or `null` when this server does not publish it.
 */
function text(fields: ReadonlyMap<string, string>, name: string): string | null {
  return fields.get(name) ?? null
}

/**
 * Reads a field as a finite number.
 *
 * A field present but empty, whitespace-only or otherwise unparseable is
 * reported as absent rather than as zero. `Number('')` is `0` and
 * `Number.isFinite(0)` is `true`, so coercing directly would report a MEASURED
 * zero for a field the server declined to fill in — the exact collapse this
 * module exists to avoid, reached through its own helper.
 *
 * @param fields - The parsed fields.
 * @param name - The `INFO` field name.
 * @returns The number, or `null` when the field is missing or not numeric.
 */
function num(fields: ReadonlyMap<string, string>, name: string): number | null {
  const raw = fields.get(name)?.trim()
  if (raw === undefined || !NUMERIC_VALUE.test(raw)) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Reads the configured memory ceiling as its three distinct states.
 *
 * @param fields - The parsed fields.
 * @returns Whether a ceiling is configured, absent, or not reported at all.
 */
function maxMemory(fields: ReadonlyMap<string, string>): MaxMemory {
  const value = num(fields, 'maxmemory')
  if (value === null) {
    return { kind: 'unreported' }
  }
  return value === UNBOUNDED_MAXMEMORY ? { kind: 'unbounded' } : { kind: 'limited', bytes: value }
}

/**
 * Reads the instant of the last successful background save.
 *
 * @param fields - The parsed fields.
 * @returns The instant as ISO text, or `null` when this server does not report one.
 */
function lastSaveAt(fields: ReadonlyMap<string, string>): string | null {
  const seconds = num(fields, 'rdb_last_save_time')
  return seconds === null ? null : new Date(seconds * MS_PER_SECOND).toISOString()
}

/**
 * Reads the outcome of the last background save.
 *
 * Narrowed to the two values Redis documents rather than passed through, so a
 * consumer branching on it cannot receive a third string it has no branch for.
 *
 * @param fields - The parsed fields.
 * @returns The status, or `null` when missing or unrecognised.
 */
function bgsaveStatus(fields: ReadonlyMap<string, string>): BgsaveStatus {
  const raw = text(fields, 'rdb_last_bgsave_status')
  if (raw === BGSAVE_OK) {
    return BGSAVE_OK
  }
  return raw === BGSAVE_ERROR ? BGSAVE_ERROR : null
}

/**
 * Reads whether append-only persistence is enabled.
 *
 * Nullable rather than defaulting to `false`: `false` for an absent field is a
 * claim about durability made without evidence.
 *
 * @param fields - The parsed fields.
 * @returns `true`, `false`, or `null` when the server does not publish the field.
 */
function aofEnabled(fields: ReadonlyMap<string, string>): boolean | null {
  const raw = text(fields, 'aof_enabled')
  return raw === null ? null : raw === INFO_TRUE
}

/**
 * Reads this server's replication role.
 *
 * The one place this module substitutes rather than reporting `null`, and it is
 * deliberate: a server that publishes no `role` is standalone, and standalone is
 * a primary. Unlike every numeric field, a surface has no third branch to offer.
 *
 * @param fields - The parsed fields.
 * @returns The role.
 */
function role(fields: ReadonlyMap<string, string>): ReplicationRole {
  return text(fields, 'role') === WIRE_REPLICA_ROLE ? 'replica' : 'master'
}

/**
 * Turns `INFO` text into a typed reading.
 *
 * @param infoText - The raw `INFO` output.
 * @param readAt - When the reading was taken, by the reading host's clock.
 * @returns The parsed statistics.
 */
export function readRedisStats(infoText: string, readAt: Date): RedisStats {
  const fields = parseInfoFields(infoText)
  return {
    readAt: readAt.toISOString(),
    server: {
      redisVersion: text(fields, 'redis_version'),
      mode: text(fields, 'redis_mode'),
      uptimeSeconds: num(fields, 'uptime_in_seconds')
    },
    clients: {
      connected: num(fields, 'connected_clients'),
      blocked: num(fields, 'blocked_clients')
    },
    memory: {
      usedBytes: num(fields, 'used_memory'),
      peakBytes: num(fields, 'used_memory_peak'),
      max: maxMemory(fields),
      fragmentationRatio: num(fields, 'mem_fragmentation_ratio'),
      evictionPolicy: text(fields, 'maxmemory_policy')
    },
    stats: {
      keyspaceHits: num(fields, 'keyspace_hits'),
      keyspaceMisses: num(fields, 'keyspace_misses'),
      expiredKeys: num(fields, 'expired_keys'),
      evictedKeys: num(fields, 'evicted_keys'),
      instantaneousOpsPerSec: num(fields, 'instantaneous_ops_per_sec'),
      totalCommandsProcessed: num(fields, 'total_commands_processed'),
      totalConnectionsReceived: num(fields, 'total_connections_received'),
      rejectedConnections: num(fields, 'rejected_connections')
    },
    persistence: {
      rdbLastSaveAt: lastSaveAt(fields),
      rdbChangesSinceLastSave: num(fields, 'rdb_changes_since_last_save'),
      rdbLastBgsaveStatus: bgsaveStatus(fields),
      aofEnabled: aofEnabled(fields)
    },
    replication: {
      role: role(fields),
      connectedReplicas: num(fields, 'connected_slaves')
    }
  }
}
