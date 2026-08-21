/**
 * Narrowing of raw Redis replies into the admin surface's typed readings.
 *
 * Layer: admin. ioredis hands back `unknown` for the commands this surface
 * issues through a pipeline, and every reply that reaches a caller passes
 * through here first. Each helper reports absence rather than substituting a
 * value that would read as a measurement.
 */
import type { KeyTtl, RedisKeyType } from '../types/keyspace.types'

/** The types this surface recognises by name; anything else becomes `other`. */
const KNOWN_TYPES: ReadonlySet<string> = new Set<string>([
  'string',
  'hash',
  'set',
  'list',
  'zset',
  'stream'
])

/**
 * Reports whether a reply is one of the named Redis types.
 *
 * A type predicate rather than a cast at the call site: `Set<string>.has` cannot
 * narrow a `string` to the literal union on its own, and the narrowing is the
 * whole point of the guard.
 *
 * @param reply - Whatever the server answered.
 * @returns `true` when the reply names a recognised type.
 */
function isKnownType(reply: unknown): reply is RedisKeyType {
  return typeof reply === 'string' && KNOWN_TYPES.has(reply)
}

/**
 * What `TTL` returns for a key that exists and has no expiry set.
 *
 * Load-bearing: without this branch, `-1` would fall into the negative catch-all
 * below and a persistent key would be reported as missing — the opposite of what
 * is true about it.
 */
const TTL_PERSISTENT = -1

/**
 * Narrows a `TYPE` reply to the closed union.
 *
 * @param reply - Whatever the server answered.
 * @returns The recognised type, or `other`.
 */
export function readKeyType(reply: unknown): RedisKeyType {
  return isKnownType(reply) ? reply : 'other'
}

/**
 * Narrows a `TTL` reply to its three distinct meanings.
 *
 * A reply that is not a number, or is a negative value Redis does not document,
 * is reported as `missing` rather than as a remaining life — a negative
 * countdown on a screen is a reading no server produced.
 *
 * @param reply - Whatever the server answered.
 * @returns Whether the key expires, is persistent, or is gone.
 */
export function readKeyTtl(reply: unknown): KeyTtl {
  if (typeof reply !== 'number' || !Number.isFinite(reply)) {
    return { kind: 'missing' }
  }
  if (reply === TTL_PERSISTENT) {
    return { kind: 'persistent' }
  }
  // Redis documents `-2` as "the key does not exist"; any other negative is a
  // value it does not document for `TTL`. Both are reported missing by this one
  // check rather than by two — a separate `=== -2` branch would be subsumed by
  // this one and could never change an outcome. A negative countdown on a screen
  // is a reading no server produced.
  if (reply < 0) {
    return { kind: 'missing' }
  }
  return { kind: 'expiring', seconds: reply }
}

/**
 * Narrows a `MEMORY USAGE` reply.
 *
 * Reports `null` rather than zero when the server declines to answer: a key
 * whose size is genuinely unknown and one that occupies nothing render the same
 * under a zero, and only one of them is a measurement.
 *
 * @param reply - Whatever the server answered.
 * @returns The size in bytes, or `null` when no size was reported.
 */
export function readSizeBytes(reply: unknown): number | null {
  return typeof reply === 'number' && Number.isFinite(reply) ? reply : null
}
