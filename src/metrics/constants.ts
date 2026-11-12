/**
 * Names and tokens of the connection-metrics surface.
 *
 * Layer: metrics. The metric names are a public contract: dashboards and alerts are written against
 * them, so they change only with a release that says so.
 */

/** Counter of connection lifecycle events, labelled by role and event. */
export const CACHE_EVENTS_METRIC = 'bymax_cache_connection_events_total'

/** Gauge of whether each connection is currently ready, labelled by role. */
export const CACHE_READY_METRIC = 'bymax_cache_connection_ready'

/** Label naming which connection an observation belongs to. */
export const ROLE_LABEL = 'role'

/** Label naming the lifecycle event on the counter. */
export const EVENT_LABEL = 'event'

/** Injection token for the {@link CacheConnectionTally} the contributor publishes. */
export const CACHE_CONNECTION_TALLY = Symbol('CACHE_CONNECTION_TALLY')
