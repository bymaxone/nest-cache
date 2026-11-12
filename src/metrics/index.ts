/**
 * Public API of the `@bymax-one/nest-cache/metrics` subpath.
 *
 * Publishes the cache connections' lifecycle on the application's `prom-client` registry through
 * `@bymax-one/nest-core`'s metrics contract. Both are optional peers, and this is the only entry that
 * loads either: `.`, `./admin` and `./shared` stay free of them.
 *
 * The library owns the semantics of its own events (two roles, six events, an `error` carrying a
 * `reason` that is not a socket failure), so an application wires this in instead of copying them.
 */
export { CacheConnectionMetrics } from './cache-connection-metrics'
export { CacheConnectionTally } from './connection-tally'
export type { CacheConnectionTallyOptions } from './connection-tally'
export { CACHE_CONNECTION_TALLY, CACHE_EVENTS_METRIC, CACHE_READY_METRIC } from './constants'
