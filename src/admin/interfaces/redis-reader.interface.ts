/**
 * The Redis commands the administration surface issues.
 *
 * Layer: admin. Declared as capabilities rather than taken as ioredis's `Redis`
 * so a unit test can supply a plain object with no cast — a cast would be a
 * blocking finding under this repository's suppression policy, making the narrow
 * interface a correctness requirement rather than a convenience. The real client
 * satisfies these structurally, which a compile-time check in the service pins.
 *
 * **Every command named here is read-only.** No `DEL`, no `SET`, no `EXPIRE`, no
 * `UNLINK`, no `FLUSHDB`. That is worth stating because the client this surface
 * holds can do all of them — and it is enforced rather than asserted: the
 * `check:admin-readonly` gate fails the build if a mutating command appears in
 * this subpath.
 */

/** One entry of a pipeline's result: an error, or a value. */
export type PipelineReply = [Error | null, unknown]

/** A pipeline being composed, chainable the way ioredis's commander is. */
export interface IRedisPipeline {
  /** Queues `TYPE`. */
  type(key: string): IRedisPipeline
  /** Queues `TTL`. */
  ttl(key: string): IRedisPipeline
  /** Queues `MEMORY USAGE`. */
  memory(subcommand: 'USAGE', key: string): IRedisPipeline
  /** Sends the batch. */
  exec(): Promise<PipelineReply[] | null>
}

/** The subset of the Redis client this surface reads through. */
export interface IRedisReader {
  /** Cursor-based key iteration. */
  scan(
    cursor: string | number,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number | string
  ): Promise<[string, string[]]>
  /** Opens a batch. */
  pipeline(): IRedisPipeline
  /** Reads one key's type. */
  type(key: string): Promise<string>
  /** Reads one key's remaining life in seconds. */
  ttl(key: string): Promise<number>
  /** Reads a string's value. */
  get(key: string): Promise<string | null>
  /** Reads a hash's fields. */
  hgetall(key: string): Promise<Record<string, string>>
  /** Reads a set's members. */
  smembers(key: string): Promise<string[]>
  /** Reads a slice of a list. */
  lrange(key: string, start: number, stop: number): Promise<string[]>
  /**
   * Sends a command by name.
   *
   * Present for the one read this interface cannot express as a method:
   * ioredis's `zrange` overload set cannot be narrowed to a four-argument
   * signature (measured — TypeScript resolves the assignment against a nine
   * argument overload and rejects it), so the sorted-set read goes through here
   * as `ZRANGE key start stop WITHSCORES`.
   *
   * It is a general escape hatch, which is exactly why the `check:admin-readonly`
   * gate inspects the command names this subpath passes to it rather than
   * trusting that only reads are sent.
   */
  call(command: string, ...args: (string | number)[]): Promise<unknown>
}

/** How the administration surface obtains its reader. */
export interface IRedisReaderSource {
  /**
   * Returns the client.
   *
   * The library's own `CacheService.getClient()` refuses cluster mode with
   * `cache.unsupported_in_cluster`, so the cluster refusal this surface needs
   * comes from the same rule the rest of the library applies rather than a
   * second copy of it.
   */
  getClient(): IRedisReader
}
