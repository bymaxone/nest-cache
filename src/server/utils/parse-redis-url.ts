/**
 * Redis connection URL parser.
 *
 * Layer: server. Converts a `redis://` / `rediss://` URL into a partial
 * `RedisOptions`. Used by the connection manager to let a single URL stand in
 * for the discrete connection fields; the URL takes precedence when both are set.
 */
import type { RedisOptions } from 'ioredis'

/**
 * Parses a Redis connection URL into ioredis `RedisOptions`.
 *
 * Supports `redis://` (plain TCP), `rediss://` (TLS — sets `tls: {}`), and
 * URL-encoded credentials: `redis://user:pass@host:port/db`. Returns a partial —
 * discrete connection fields act as fallback when a field is absent from the URL.
 *
 * @param url - The connection URL.
 * @returns The parsed subset of `RedisOptions`.
 * @throws {Error} If the URL is malformed, the protocol is unsupported, or the
 *   URL is missing a host.
 * @example
 * parseRedisUrl('rediss://default:secret@redis.example.com:6380/2')
 * // → { host: 'redis.example.com', port: 6380, username: 'default',
 * //     password: 'secret', db: 2, tls: {} }
 */
export function parseRedisUrl(url: string): Partial<RedisOptions> {
  const parsed = new URL(url)

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis protocol: ${parsed.protocol}`)
  }

  if (parsed.hostname === '') {
    throw new Error('Redis URL is missing a host')
  }

  const result: Partial<RedisOptions> = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379
  }

  if (parsed.username) {
    result.username = decodeURIComponent(parsed.username)
  }
  if (parsed.password) {
    result.password = decodeURIComponent(parsed.password)
  }

  const dbSegment = parsed.pathname.replace(/^\//, '')
  if (dbSegment && /^\d+$/.test(dbSegment)) {
    result.db = Number.parseInt(dbSegment, 10)
  }

  if (parsed.protocol === 'rediss:') {
    result.tls = {}
  }

  return result
}
