/**
 * `BymaxCacheModule` — the public NestJS dynamic module.
 *
 * Layer: server. `forRoot()` (sync) and `forRootAsync()` (async factory) both
 * wire the full surface: `ConnectionManager`, `KeyBuilder`,
 * `CacheService`, `PubSubService`, `ScriptManagerService`, the resolved
 * serializer, and the DI tokens. The topology-independent providers/exports are
 * factored into {@link BymaxCacheModule.buildCommonProviders} /
 * {@link BymaxCacheModule.buildCommonExports}; each entry point supplies its own
 * `BYMAX_CACHE_OPTIONS`/`BYMAX_CACHE_EVENTS`/`BYMAX_CACHE_SERIALIZER` providers —
 * `useValue` for `forRoot` (options known synchronously) and `useFactory`
 * injecting `BYMAX_CACHE_OPTIONS` for `forRootAsync` (options resolved at runtime).
 *
 * @see `docs/technical_specification.md` §2.1, §4 — Dynamic Module Pattern
 */
import { Module } from '@nestjs/common'
import type { DynamicModule, Provider } from '@nestjs/common'

import {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'
import {
  ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE
} from './bymax-cache.module.builder'
import { applyDefaults, validateOptions } from './config/default-options'
import type { ResolvedOptions } from './config/resolved-options'
import { ConnectionManager } from './connection/connection.manager'
import type { ICacheEvents } from './interfaces/cache-events.interface'
import type { BymaxCacheModuleOptions } from './interfaces/cache-module-options.interface'
import type { ISerializer } from './interfaces/serializer.interface'
import { CacheService } from './services/cache.service'
import { PubSubService } from './services/pubsub.service'
import { ScriptManagerService } from './services/script-manager.service'
import { JsonSerializer } from './utils/json-serializer'
import { KeyBuilder } from './utils/key-builder'

@Module({})
export class BymaxCacheModule extends ConfigurableModuleClass {
  /**
   * Registers the cache module synchronously.
   *
   * @param options - Consumer options; validated and defaulted at registration.
   * @returns The configured {@link DynamicModule}.
   * @throws {import('./errors/cache.exception').CacheException} When the options
   *   fail bootstrap validation (e.g. missing connection, misconfigured mode).
   */
  static override forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)

    const providers: Provider[] = [
      { provide: MODULE_OPTIONS_TOKEN, useValue: options },
      { provide: BYMAX_CACHE_OPTIONS, useValue: resolved },
      { provide: BYMAX_CACHE_EVENTS, useValue: resolved.events ?? null },
      resolved.serializer
        ? { provide: BYMAX_CACHE_SERIALIZER, useValue: resolved.serializer }
        : { provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer },
      ...BymaxCacheModule.buildCommonProviders()
    ]

    return {
      module: BymaxCacheModule,
      global: resolved.isGlobal,
      providers,
      exports: BymaxCacheModule.buildCommonExports()
    }
  }

  /**
   * Registers the cache module asynchronously, resolving its options through a
   * consumer-supplied factory (e.g. reading from `ConfigService`).
   *
   * @remarks
   * Delegates the async-options plumbing (the `MODULE_OPTIONS_TOKEN` factory,
   * `inject`, `imports`, and the `global` flag) to the {@link ConfigurableModuleClass}
   * base, then augments the produced module with the cache providers. Options are
   * validated and defaulted INSIDE the `BYMAX_CACHE_OPTIONS` factory — which
   * injects the base `MODULE_OPTIONS_TOKEN` — so a misconfiguration surfaces during
   * bootstrap exactly as it does for {@link BymaxCacheModule.forRoot}. The events
   * and serializer providers are factories deriving from the resolved options,
   * since those values are not known until the async factory runs.
   * @param options - Async registration options: a `useFactory` returning the
   *   module options, plus optional `inject`, `imports`, and `isGlobal` (the
   *   builder defaults `isGlobal` to `true`).
   * @returns The configured {@link DynamicModule}.
   * @throws {import('./errors/cache.exception').CacheException} During bootstrap,
   *   when the factory-resolved options fail validation.
   */
  static override forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const base = super.forRootAsync(options)

    // `DynamicModule['providers']` is optional; the builder always populates it,
    // but the `?? []` keeps the module valid if a base ever omits providers (a
    // spec exercises that fallback so it stays covered, not suppressed).
    const baseProviders = base.providers ?? []

    return {
      ...base,
      providers: [...baseProviders, ...BymaxCacheModule.buildAsyncProviders()],
      exports: BymaxCacheModule.buildCommonExports()
    }
  }

  /**
   * The cache providers layered onto the base async module: the resolved-options
   * provider (which validates + defaults the raw factory result read from
   * `MODULE_OPTIONS_TOKEN`), the derived events and serializer providers, and the
   * topology-independent {@link BymaxCacheModule.buildCommonProviders}. Mirrors the
   * options/events/serializer wiring `forRoot` performs synchronously.
   *
   * @returns The async-only provider list.
   */
  private static buildAsyncProviders(): Provider[] {
    return [
      {
        provide: BYMAX_CACHE_OPTIONS,
        useFactory: (raw: BymaxCacheModuleOptions): ResolvedOptions => {
          validateOptions(raw)
          return applyDefaults(raw)
        },
        inject: [MODULE_OPTIONS_TOKEN]
      },
      {
        provide: BYMAX_CACHE_EVENTS,
        useFactory: (resolved: ResolvedOptions): ICacheEvents | null => resolved.events ?? null,
        inject: [BYMAX_CACHE_OPTIONS]
      },
      // Let Nest own the default serializer's lifecycle — matching forRoot's
      // `useClass: JsonSerializer` — so the factory selects a consumer-supplied
      // serializer over a container-managed default rather than `new`-ing one.
      JsonSerializer,
      {
        provide: BYMAX_CACHE_SERIALIZER,
        useFactory: (resolved: ResolvedOptions, defaultSerializer: JsonSerializer): ISerializer =>
          resolved.serializer ?? defaultSerializer,
        inject: [BYMAX_CACHE_OPTIONS, JsonSerializer]
      },
      ...BymaxCacheModule.buildCommonProviders()
    ]
  }

  /**
   * Topology-independent providers shared by `forRoot` and `forRootAsync` — the
   * connection manager, key builder, cache services, and the `useExisting`
   * aliases for the key-builder and script-registry tokens. The options, events,
   * and serializer providers are NOT here: they differ between the sync
   * (`useValue`) and async (`useFactory`) entry points.
   *
   * @returns The common provider list.
   */
  private static buildCommonProviders(): Provider[] {
    return [
      ConnectionManager,
      KeyBuilder,
      CacheService,
      PubSubService,
      ScriptManagerService,
      { provide: BYMAX_CACHE_KEY_BUILDER, useExisting: KeyBuilder },
      { provide: BYMAX_CACHE_SCRIPT_REGISTRY, useExisting: ScriptManagerService },
      { provide: BYMAX_CACHE_CONNECTION, useExisting: ConnectionManager }
    ]
  }

  /**
   * Tokens and services exported by both `forRoot` and `forRootAsync`.
   *
   * @returns The common export list.
   */
  private static buildCommonExports(): NonNullable<DynamicModule['exports']> {
    return [
      BYMAX_CACHE_OPTIONS,
      BYMAX_CACHE_CONNECTION,
      BYMAX_CACHE_KEY_BUILDER,
      BYMAX_CACHE_SCRIPT_REGISTRY,
      BYMAX_CACHE_SERIALIZER,
      ConnectionManager,
      KeyBuilder,
      CacheService,
      PubSubService,
      ScriptManagerService
    ]
  }
}
