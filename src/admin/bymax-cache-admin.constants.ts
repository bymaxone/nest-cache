/**
 * NestJS injection tokens for the `@bymax-one/nest-cache/admin` subpath.
 *
 * Layer: admin. `Symbol`-based for the same reason as the server tokens: two
 * consumers cannot collide by accident, and a string typo cannot resolve a
 * foreign provider.
 */

/** Resolved administration options (scopes, thresholds, limits). */
export const BYMAX_CACHE_ADMIN_OPTIONS = Symbol('BYMAX_CACHE_ADMIN_OPTIONS')
