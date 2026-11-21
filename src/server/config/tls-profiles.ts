/**
 * The tls profile names `ioredis` resolves.
 *
 * Layer: server. Kept here so validation does not import the driver's internals; a spec compares this
 * list with the driver's own.
 */
export const KNOWN_TLS_PROFILES: readonly string[] = ['RedisCloudFixed', 'RedisCloudFlexible']
