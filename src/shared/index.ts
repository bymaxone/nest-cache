/**
 * Public API of the `@bymax-one/nest-cache/shared` subpath.
 *
 * Zero-dependency types and constants, safe to import in any runtime — no
 * NestJS or ioredis imports cross this boundary.
 */

// Types
export type { CacheConnectionStatus, CacheEventName } from './types/cache-event.types'
export type { CacheKeyPrefix, CacheNamespace } from './types/cache-config.types'
export type { SerializableValue } from './types/serializable-value.types'

// Constants
export { CACHE_ERROR_CODES } from './constants/error-codes'
export type { CacheErrorCode } from './constants/error-codes'
export { CACHE_EVENT_NAMES } from './constants/event-names'
