/**
 * Serializer resolution helper.
 *
 * Layer: server. Both {@link CacheService} and {@link PubSubService} resolve the
 * effective serializer the same way — an explicit `options.serializer` wins,
 * then the injected `BYMAX_CACHE_SERIALIZER` provider, then the default JSON
 * serializer. Centralized here so the priority order lives in exactly one place.
 */
import { JsonSerializer } from './json-serializer'
import type { ResolvedOptions } from '../config/resolved-options'
import type { ISerializer } from '../interfaces/serializer.interface'

/**
 * Resolves the serializer to use, honoring the documented priority order.
 *
 * @param options - Resolved module options (may carry an explicit `serializer`).
 * @param injected - The optionally-injected `BYMAX_CACHE_SERIALIZER` provider.
 * @returns `options.serializer` when set, otherwise `injected` when present,
 *   otherwise a fresh {@link JsonSerializer}.
 */
export const resolveSerializer = (options: ResolvedOptions, injected?: ISerializer): ISerializer =>
  options.serializer ?? injected ?? new JsonSerializer()
