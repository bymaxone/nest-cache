/**
 * The `INFO` subset an administration surface reads.
 *
 * Layer: admin. Every field here is reported, never defaulted: a value this
 * server does not publish arrives as `null` and a surface renders "not
 * reported". Substituting a zero would draw a reading that means "I could not
 * measure" identically to one that means "I measured, and it is nothing".
 *
 * Where a single `null` would carry two different meanings, the type is a
 * discriminated union instead — see {@link MaxMemory}.
 */

/**
 * The configured memory ceiling.
 *
 * A union rather than `number | null` because `maxmemory` has three states and
 * only two of them are a number. Redis spells "no ceiling" as `maxmemory:0`,
 * which read as a literal ceiling makes a saturation bar show full on the least
 * constrained server there is; and a server that does not publish the field at
 * all has told us nothing. Collapsing "unbounded" and "unreported" into one
 * `null` leaves a surface unable to tell an operator which of those it is
 * looking at, and they call for opposite actions.
 */
export type MaxMemory =
  /** A ceiling is configured. */
  | { readonly kind: 'limited'; readonly bytes: number }
  /** `maxmemory:0` — the server will grow until the host stops it. */
  | { readonly kind: 'unbounded' }
  /** The server does not publish `maxmemory`. */
  | { readonly kind: 'unreported' }

/** The outcome of the most recent background save, or `null` when unreported. */
export type BgsaveStatus = 'ok' | 'err' | null

/** Whether this server is a primary or a replica. */
export type ReplicationRole = 'master' | 'replica'

/** A parsed reading of Redis `INFO`. */
export interface RedisStats {
  /**
   * When this reading was taken, by the **reading host's** clock — not the
   * Redis server's.
   *
   * Named for the side that measured it. Under clock skew between the
   * application host and the Redis host the two differ, and this value is used
   * to place a reading on an incident timeline, which is exactly where the
   * difference shows.
   */
  readonly readAt: string
  readonly server: {
    readonly redisVersion: string | null
    readonly mode: string | null
    readonly uptimeSeconds: number | null
  }
  readonly clients: {
    readonly connected: number | null
    readonly blocked: number | null
  }
  readonly memory: {
    readonly usedBytes: number | null
    readonly peakBytes: number | null
    /** Three-state: a ceiling, no ceiling, or no answer. See {@link MaxMemory}. */
    readonly max: MaxMemory
    /**
     * Allocator fragmentation, reported raw.
     *
     * Interpretation is deliberately left to the caller: on an instance holding
     * very little, allocator and copy-on-write overhead dominate and this reads
     * far above 1 without indicating a problem — 9.07 was measured on an
     * instance holding 1.1 MiB. A threshold that turns this into a health
     * verdict is deployment policy, not a property of the reading.
     */
    readonly fragmentationRatio: number | null
    readonly evictionPolicy: string | null
  }
  readonly stats: {
    readonly keyspaceHits: number | null
    readonly keyspaceMisses: number | null
    readonly expiredKeys: number | null
    readonly evictedKeys: number | null
    readonly instantaneousOpsPerSec: number | null
    readonly totalCommandsProcessed: number | null
    readonly totalConnectionsReceived: number | null
    readonly rejectedConnections: number | null
  }
  readonly persistence: {
    readonly rdbLastSaveAt: string | null
    readonly rdbChangesSinceLastSave: number | null
    readonly rdbLastBgsaveStatus: BgsaveStatus
    /**
     * Whether append-only persistence is on, or `null` when the server does not
     * publish `aof_enabled`.
     *
     * Nullable rather than defaulting to `false`, because `false` here is a
     * claim about durability made in the absence of evidence — "AOF is off" and
     * "I could not determine whether AOF is on" are different sentences to
     * someone deciding whether a restart loses writes.
     */
    readonly aofEnabled: boolean | null
  }
  readonly replication: {
    readonly role: ReplicationRole
    readonly connectedReplicas: number | null
  }
}
