/**
 * Canonical connection event names for `@bymax-one/nest-cache`.
 *
 * Layer: shared — zero-dependency. Mirrors the {@link CacheEventName} union as a
 * runtime object so consumers can reference event names by symbolic key instead
 * of repeating string literals. Values are the raw ioredis event names.
 */
import type { CacheEventName } from '../types/cache-event.types'

/**
 * Connection lifecycle event names, keyed by symbolic name. Each value is a
 * {@link CacheEventName}; the `satisfies` clause keeps the object and the union
 * in lock-step — adding an event to the union without a key here is a type error.
 */
export const CACHE_EVENT_NAMES = {
  CONNECT: 'connect',
  READY: 'ready',
  ERROR: 'error',
  CLOSE: 'close',
  RECONNECTING: 'reconnecting',
  END: 'end'
} as const satisfies Record<string, CacheEventName>
