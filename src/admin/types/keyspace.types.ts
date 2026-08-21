/**
 * The shapes an administration surface reads about keys.
 *
 * Layer: admin. As in {@link ../types/redis-stats.types}, a value that would
 * carry two meanings under one `null` is a discriminated union instead.
 */

/**
 * The Redis data types this surface names, plus an escape hatch.
 *
 * `other` is what makes the union safe to declare closed. Redis may report a
 * type this build has never heard of — a module type, or one added by a later
 * server — and mapping the unrecognised case to a named member means a
 * consumer's exhaustive switch can never be wrong about a real reply. Passing
 * the raw string through instead would put an open set into a closed type.
 */
export type RedisKeyType = 'string' | 'hash' | 'set' | 'list' | 'zset' | 'stream' | 'other'

/**
 * How much life a key has left.
 *
 * A union rather than `number | null`, because Redis answers `TTL` with three
 * distinct facts and two of them are not a number: `-1` means the key exists
 * with no expiry, and `-2` means the key does not exist. Collapsing those into
 * one `null` forces the caller to recover the difference from somewhere else —
 * and the case where it matters most is a key that expired between the scan and
 * the read, which is exactly the key an operator is staring at when they care.
 */
export type KeyTtl =
  /** The key expires in `seconds`. */
  | { readonly kind: 'expiring'; readonly seconds: number }
  /** The key exists and has no expiry set (`TTL` → `-1`). */
  | { readonly kind: 'persistent' }
  /** The key does not exist (`TTL` → `-2`). */
  | { readonly kind: 'missing' }

/** One key as it appears in a listing. */
export interface KeyEntry {
  /** The full key, exactly as Redis stores it. */
  readonly key: string
  readonly type: RedisKeyType
  readonly ttl: KeyTtl
  /**
   * Serialized size in bytes, or `null` when not measured.
   *
   * `null` covers two cases the caller can already tell apart from the request
   * it made: sizing was not requested, or the server declined to answer for this
   * key. Reporting `0` instead would make a key of unknown size and a key
   * occupying nothing render identically, and only one of them is a measurement.
   */
  readonly sizeBytes: number | null
}

/** One page of a keyspace listing. */
export interface KeyspacePage {
  /** The scope this page was read from. */
  readonly scopeId: string
  readonly entries: readonly KeyEntry[]
  /**
   * How many keys this page actually read.
   *
   * Named `sampled` rather than `count` because it is a sum over a capped
   * `SCAN`, not a measurement of the keyspace. {@link KeyspacePage.isComplete}
   * is the fact; the name is the guard — a caller reaching for one of these does
   * not necessarily read the other, and a bare `count` would look measured.
   */
  readonly sampledCount: number
  /**
   * Total serialized bytes across the keys whose size was measured, or `null`
   * when sizing was not requested.
   *
   * Sampled for the same reason as {@link KeyspacePage.sampledCount}, and
   * renamed with it or not at all — moving only one of the pair relocates the
   * trap instead of closing it.
   */
  readonly sampledBytes: number | null
  /** Whether the scan reached the end of the scope rather than the cap. */
  readonly isComplete: boolean
  /** The cap this page was read under, so a caller can say why it stopped. */
  readonly scanLimit: number
  /** Cursor to continue from, or `null` when the scope was exhausted. */
  readonly cursor: string | null
}

/** One key, described without reading its value. */
export interface KeyDetail extends KeyEntry {
  /** The scope the key was resolved through. */
  readonly scopeId: string
  /**
   * Whether this scope permits reading the key's value.
   *
   * Present on the detail so a surface can render the listing honestly and
   * disable only the reveal, rather than discovering the refusal by attempting it.
   */
  readonly isReadable: boolean
}

/** A revealed value, shaped by the key's Redis type. */
export type RevealedValue =
  | { readonly kind: 'string'; readonly value: string; readonly isComplete: boolean }
  | {
      readonly kind: 'hash'
      readonly fields: readonly { readonly name: string; readonly value: string }[]
      readonly isComplete: boolean
    }
  /** Sets and lists: a flat member list. The enclosing `type` says which it is. */
  | { readonly kind: 'members'; readonly members: readonly string[]; readonly isComplete: boolean }
  | {
      readonly kind: 'scored'
      readonly members: readonly { readonly member: string; readonly score: string }[]
      readonly isComplete: boolean
    }
  /** A type this surface does not render — streams, module types. */
  | { readonly kind: 'unsupported'; readonly type: RedisKeyType }

/**
 * The outcome of asking for a key's value.
 *
 * A discriminated union rather than a nullable value, because `withheld` and
 * `missing` are different answers and rendering them identically is the defect
 * this whole surface exists to avoid: one means "I may not tell you", the other
 * means "there is nothing here".
 */
export type RevealResult =
  | {
      readonly status: 'revealed'
      readonly key: string
      readonly type: RedisKeyType
      readonly value: RevealedValue
    }
  /**
   * The scope withholds values. Listing, types, TTLs and sizes remain available
   * for this key — only the value is refused, and `origin` says why in the
   * application's own words.
   */
  | {
      readonly status: 'withheld'
      readonly key: string
      readonly scopeId: string
      readonly origin: string
    }
  /** The key does not exist. */
  | { readonly status: 'missing'; readonly key: string }
