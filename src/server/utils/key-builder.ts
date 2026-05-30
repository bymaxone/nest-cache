/**
 * Namespace-aware Redis key builder.
 *
 * Layer: server. Every key in the library is composed through this injectable so
 * tenant/app isolation is structural, not by convention — raw keys that bypass
 * the namespace are an anti-pattern (CLAUDE.md §4, spec §7).
 */
import { Inject, Injectable } from '@nestjs/common'

import { BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/**
 * Composes Redis keys following `{namespace}{separator}{prefix}{separator}{id}`.
 *
 * With the defaults (`namespace='app'`, `separator=':'`):
 * - `build('users', 'u_1')` → `'app:users:u_1'`
 * - `applyNamespace('rl:u_1')` → `'app:rl:u_1'`
 *
 * @see `docs/technical_specification.md` §7 — Namespace Strategy
 */
@Injectable()
export class KeyBuilder {
  private readonly namespace: string
  private readonly separator: string

  /**
   * @param options - Resolved module options supplying the namespace + separator.
   */
  constructor(@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions) {
    this.namespace = options.namespace
    this.separator = options.keySeparator
  }

  /**
   * Builds the full namespaced key.
   *
   * @param prefix - The entity-group prefix (e.g. `'users'`).
   * @param id - The entity id.
   * @returns `{namespace}{sep}{prefix}{sep}{id}`.
   * @throws {CacheException} `INVALID_KEY` when `prefix` or `id` is empty.
   */
  build(prefix: string, id: string): string {
    if (!prefix) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })
    }
    if (!id) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_id' })
    }
    return `${this.namespace}${this.separator}${prefix}${this.separator}${id}`
  }

  /**
   * Applies only the namespace to an already-composed key. Used by the Pub/Sub
   * and script services for channel/key namespacing.
   *
   * @param keyWithoutNamespace - The bare key to namespace.
   * @returns `{namespace}{sep}{keyWithoutNamespace}`.
   * @throws {CacheException} `INVALID_KEY` when the key is empty.
   */
  applyNamespace(keyWithoutNamespace: string): string {
    if (!keyWithoutNamespace) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_key' })
    }
    return `${this.namespace}${this.separator}${keyWithoutNamespace}`
  }

  /**
   * Returns the `{namespace}{separator}` prefix string used to build `SCAN`
   * match patterns scoped to this namespace.
   *
   * @returns The namespace prefix, e.g. `'app:'`.
   */
  getNamespacePrefix(): string {
    return `${this.namespace}${this.separator}`
  }
}
