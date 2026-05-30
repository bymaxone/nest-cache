/**
 * Cache configuration value types.
 *
 * Layer: shared — zero-dependency. Semantic aliases used across the public API
 * to make key-building intent explicit at call sites (spec §11.2, §D11/D17).
 */

/**
 * A logical key namespace. Every key in an application shares one namespace,
 * which guarantees tenant/app isolation — keys from one namespace never collide
 * with another. Must be non-empty and must not contain the key separator.
 *
 * @example
 * ```ts
 * const namespace: CacheNamespace = 'app'        // single-app default
 * const tenant: CacheNamespace = 'tenant-42'     // per-tenant isolation
 * ```
 */
export type CacheNamespace = string

/**
 * A logical key prefix that groups related entities under a namespace. Combined
 * by the key builder as `{namespace}{sep}{prefix}{sep}{id}`.
 *
 * @example
 * ```ts
 * const prefix: CacheKeyPrefix = 'user'      // → app:user:1
 * const session: CacheKeyPrefix = 'session'  // → app:session:abc
 * ```
 */
export type CacheKeyPrefix = string
