/**
 * The administration module.
 *
 * Layer: admin. Wires the read-only administration services over an already
 * configured `BymaxCacheModule`.
 *
 * **Deliberately not global by default**, unlike the cache module. An
 * administration surface is privileged and is wired where it is used; a module
 * that arrives everywhere by default is one nobody decided to have.
 *
 * **Requires `BymaxCacheModule` to be resolvable.** It is global by default, so
 * registering it once anywhere is enough; a deployment that sets
 * `isGlobal: false` on the cache module must import it into the same module that
 * imports this one.
 */
import { Module } from '@nestjs/common'
import type { DynamicModule, InjectionToken, OptionalFactoryDependency } from '@nestjs/common'

import { BYMAX_CACHE_ADMIN_OPTIONS } from './bymax-cache-admin.constants'
import { resolveAdminOptions } from './config/resolved-admin-options'
import type { BymaxCacheAdminModuleOptions } from './interfaces/admin-module-options.interface'
import { CacheAdminService } from './services/cache-admin.service'
import { CacheStatusService } from './services/cache-status.service'

/**
 * Async wiring for {@link BymaxCacheAdminModule.forRootAsync}.
 *
 * `isGlobal` is a top-level field rather than part of the factory's result
 * because Nest needs the `global` flag while building the module definition,
 * which is before any async factory has resolved.
 */
export interface BymaxCacheAdminModuleAsyncOptions {
  /** Modules exporting whatever the factory injects. */
  imports?: DynamicModule['imports']
  /** Providers injected into the factory. */
  inject?: (InjectionToken | OptionalFactoryDependency)[]
  /** Builds the administration options. */
  useFactory: (
    ...args: never[]
  ) => BymaxCacheAdminModuleOptions | Promise<BymaxCacheAdminModuleOptions>
  /** Register globally. Decided synchronously; default `false`. */
  isGlobal?: boolean
}

/** The services and exports both wiring paths share. */
const ADMIN_SERVICES = [CacheStatusService, CacheAdminService]

/** Read-only administration for `@bymax-one/nest-cache`. */
@Module({})
export class BymaxCacheAdminModule {
  /**
   * Registers the administration surface with statically known options.
   *
   * Options are validated here, at wiring — a malformed scope or a non-positive
   * threshold fails the boot rather than the first request.
   *
   * @param options - The scopes this deployment exposes, plus any thresholds.
   * @returns The dynamic module.
   * @throws {CacheException} `INVALID_SCOPE` when the declaration is malformed.
   */
  static forRoot(options: BymaxCacheAdminModuleOptions): DynamicModule {
    const resolved = resolveAdminOptions(options)
    return {
      module: BymaxCacheAdminModule,
      global: resolved.isGlobal,
      providers: [{ provide: BYMAX_CACHE_ADMIN_OPTIONS, useValue: resolved }, ...ADMIN_SERVICES],
      exports: [BYMAX_CACHE_ADMIN_OPTIONS, ...ADMIN_SERVICES]
    }
  }

  /**
   * Registers the administration surface with options built asynchronously.
   *
   * Validation runs inside the factory, so the same rules apply on both paths
   * and neither can drift into accepting what the other rejects.
   *
   * @param options - Factory wiring plus the synchronous `isGlobal` flag.
   * @returns The dynamic module.
   */
  static forRootAsync(options: BymaxCacheAdminModuleAsyncOptions): DynamicModule {
    return {
      module: BymaxCacheAdminModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [
        {
          provide: BYMAX_CACHE_ADMIN_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: never[]): Promise<ReturnType<typeof resolveAdminOptions>> =>
            resolveAdminOptions(await options.useFactory(...args))
        },
        ...ADMIN_SERVICES
      ],
      exports: [BYMAX_CACHE_ADMIN_OPTIONS, ...ADMIN_SERVICES]
    }
  }
}
