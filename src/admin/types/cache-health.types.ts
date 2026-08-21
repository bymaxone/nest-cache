/**
 * What an administration surface reads to decide what it can say about the cache.
 *
 * Layer: admin.
 */

/** How this deployment connects to Redis. */
export type CacheMode = 'standalone' | 'sentinel' | 'cluster'

/**
 * Why a probe did not answer.
 *
 * A closed union rather than the underlying error's text: an error message is
 * free-form and may carry connection detail the library is careful never to
 * echo (CLAUDE.md §4). The syscall {@link CacheProbeDown.code} carries the part
 * an operator acts on; the full error reaches the application through the
 * `ICacheEvents` hooks the module already provides.
 */
export type CacheProbeFailure = 'timeout' | 'error'

/** A probe that answered within the degraded threshold. */
export interface CacheProbeUp {
  readonly status: 'up'
  readonly latencyMs: number
}

/** A probe that answered, but slowly. */
export interface CacheProbeDegraded {
  readonly status: 'degraded'
  readonly latencyMs: number
}

/** A probe that did not answer. */
export interface CacheProbeDown {
  readonly status: 'down'
  readonly reason: CacheProbeFailure
  /** The syscall code when the driver reported one (`ECONNREFUSED`), else `null`. */
  readonly code: string | null
}

/**
 * The result of pinging Redis.
 *
 * **Three states, not two.** A server answering `PING` slowly is neither up nor
 * down, and collapsing it into either hides the state an operator most wants to
 * catch early — by the time a slow cache becomes an unreachable one, the choice
 * has been made for them.
 *
 * **A union, so `latencyMs` cannot exist without a measurement.** The invariant
 * is that a latency is reported if and only if the ping answered; expressed as
 * `latencyMs: number | null` it would be a convention, and a handler that caught
 * a throwing ping and fell back to a default shape would hand a surface a
 * confident status that really means "I did not ask" — undetectable from the
 * payload. Here that shape does not typecheck.
 */
export type CacheProbe = CacheProbeUp | CacheProbeDegraded | CacheProbeDown

/**
 * The cache's health, as an administration surface reads it.
 *
 * `mode`, `isScanSupported` and `degradedAboveMs` sit OUTSIDE the discriminated
 * part on purpose: a cluster deployment that is down should still report that
 * scanning was never going to work, and folding those into the answering
 * branches would make the `down` payload quieter about facts that have nothing
 * to do with being down.
 */
export type CacheHealth = CacheProbe & {
  readonly mode: CacheMode
  /**
   * Whether this deployment's mode supports `SCAN`.
   *
   * On the wire beside `mode` deliberately. The library refuses `scan` under
   * cluster, and applying that rule is the library's job — a surface
   * re-deriving it from `mode` would hold a copy of a rule it cannot see change.
   */
  readonly isScanSupported: boolean
  /** The round trip above which this deployment calls the cache degraded. */
  readonly degradedAboveMs: number
}

/** The resolved wiring, with every credential-bearing field withheld. */
export interface CacheConfig {
  readonly mode: CacheMode
  readonly namespace: string
  readonly keySeparator: string
  readonly shutdownTimeoutMs: number
  readonly isFlushAllowedInProduction: boolean
  /** The serializer's constructor name, or `null` when it does not report one. */
  readonly serializer: string | null
  /** The Lua scripts registered at wiring, by name only — never their bodies. */
  readonly scripts: readonly string[]
  /**
   * Where this deployment connects, with the connection URL withheld.
   *
   * `ResolvedOptions.connection` is `{ url, password, ... }`, so serving the
   * resolved options directly — the obvious implementation — ships a Redis URL
   * with its password to whatever reads this. Host, port and a TLS flag carry
   * everything an operator-facing panel needs and none of the credential.
   *
   * `host` and `port` are `null` under sentinel and cluster, where there is no
   * single endpoint to name; `mode` alongside says why.
   */
  readonly connection: {
    readonly host: string | null
    readonly port: number | null
    readonly isTls: boolean
  }
}
