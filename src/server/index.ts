/**
 * Public API of the `@bymax-one/nest-cache` (server) subpath.
 *
 * The NestJS-facing surface: DI tokens, errors, and (as the library grows) the
 * dynamic module and cache / pub-sub / script services.
 *
 * NOTE: this library is under active scaffolding. The connection manager, the
 * cache / pub-sub / script services, and `BymaxCacheModule.forRoot` /
 * `forRootAsync` land in Phases 1-3 per `docs/development_plan.md`. This barrel
 * currently exposes the foundational injection tokens and error types.
 */

// Injection tokens (Symbol)
export {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'

// Errors
export { CacheException } from './errors/cache.exception'

// Shared re-exports (convenience — also available from `@bymax-one/nest-cache/shared`)
export { CACHE_ERROR_CODES } from '../shared/constants/error-codes'
export type { CacheErrorCode } from '../shared/constants/error-codes'
export type { CacheConnectionStatus, CacheEventName } from '../shared/types/cache-event.types'
