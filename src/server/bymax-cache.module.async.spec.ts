/**
 * Unit tests for {@link BymaxCacheModule.forRootAsync}.
 *
 * Layer: server. Kept separate from `bymax-cache.module.spec.ts` (which covers
 * the synchronous `forRoot`) for clarity. Exercises the async path end to end:
 * the delegated `MODULE_OPTIONS_TOKEN` plumbing, the `BYMAX_CACHE_OPTIONS`
 * factory (validate + default the factory-resolved options), the derived events
 * and serializer factories, `inject`/`imports` propagation, the `isGlobal` flag,
 * and the bootstrap-time validation throw. ioredis is mocked so no socket opens.
 */
import { EventEmitter } from 'node:events'

import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { ConnectionManager } from './connection/connection.manager'
import { CacheException } from './errors/cache.exception'
import { CacheService } from './services/cache.service'
import { PubSubService } from './services/pubsub.service'
import { ScriptManagerService } from './services/script-manager.service'
import { JsonSerializer } from './utils/json-serializer'
import { KeyBuilder } from './utils/key-builder'
import { BymaxCacheModule } from './bymax-cache.module'
import {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'
import { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } from './bymax-cache.module.builder'

import type { ICacheEvents } from './interfaces/cache-events.interface'
import type { ISerializer } from './interfaces/serializer.interface'
import type { ResolvedOptions } from './config/resolved-options'
import type { DynamicModule } from '@nestjs/common'

// Mock ioredis so the eagerly-instantiated ConnectionManager never opens a real
// socket; a bare EventEmitter satisfies the listeners and lifecycle hooks.
jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
  }
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeRedis, default: FakeRedis }
})

import { findProvider } from '../test-helpers/provider.helpers'

/** A token an imported module exports, proving the async factory can `inject` it. */
const HOST_CONFIG = Symbol('HOST_CONFIG')

/** Minimal config-like module that exposes a host string for the inject test. */
@Module({
  providers: [{ provide: HOST_CONFIG, useValue: { host: 'cfg-host' } }],
  exports: [HOST_CONFIG]
})
class HostConfigModule {}

/** An identity-comparable serializer used to prove the custom one is wired. */
const makeSerializer = (): ISerializer => ({
  serialize<T>(value: T): string {
    return JSON.stringify(value)
  },
  deserialize<T>(raw: string): T {
    return JSON.parse(raw) as T
  }
})

describe('BymaxCacheModule.forRootAsync', () => {
  // The async module must carry the same provider/export surface as forRoot —
  // the delegated MODULE_OPTIONS_TOKEN plus every cache token and service — and
  // default to global.
  it('returns a global module with the delegated and cache providers', () => {
    const mod: DynamicModule = BymaxCacheModule.forRootAsync({
      useFactory: () => ({ connection: { host: 'h' } })
    })

    expect(mod.module).toBe(BymaxCacheModule)
    expect(mod.global).toBe(true)

    const providers = mod.providers ?? []
    expect(findProvider(providers, MODULE_OPTIONS_TOKEN)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_OPTIONS)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_EVENTS)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_SERIALIZER)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_KEY_BUILDER)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_SCRIPT_REGISTRY)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_CONNECTION)).toBeDefined()
    expect(providers).toContain(ConnectionManager)
    expect(providers).toContain(KeyBuilder)
    expect(providers).toContain(CacheService)
    expect(providers).toContain(PubSubService)
    expect(providers).toContain(ScriptManagerService)

    expect(mod.exports).toEqual([
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
    ])
  })

  // If the builder ever returns a base module WITHOUT `providers` (the type is
  // optional), forRootAsync must still emit a valid module carrying only the cache
  // providers — exercising the `base.providers ?? []` fallback. Mocking the
  // inherited base method to omit providers covers that branch (so it needs no
  // coverage/mutation suppression): the result must contain ONLY known cache
  // providers (no leaked MODULE_OPTIONS_TOKEN, no junk-array entry), and preserve
  // the base `global` flag.
  it('falls back to an empty base provider list when the base omits providers', () => {
    const baseStub: DynamicModule = { module: BymaxCacheModule, global: true }
    jest.spyOn(ConfigurableModuleClass, 'forRootAsync').mockReturnValue(baseStub)

    const mod = BymaxCacheModule.forRootAsync({ useFactory: () => ({ connection: { host: 'h' } }) })
    const providers = mod.providers ?? []

    const knownCacheTokens = new Set<unknown>([
      BYMAX_CACHE_OPTIONS,
      BYMAX_CACHE_EVENTS,
      BYMAX_CACHE_SERIALIZER,
      BYMAX_CACHE_KEY_BUILDER,
      BYMAX_CACHE_SCRIPT_REGISTRY,
      BYMAX_CACHE_CONNECTION,
      JsonSerializer,
      ConnectionManager,
      KeyBuilder,
      CacheService,
      PubSubService,
      ScriptManagerService
    ])
    expect(providers.length).toBeGreaterThan(0)
    for (const provider of providers) {
      const token = (provider as { provide?: unknown }).provide ?? provider
      expect(knownCacheTokens.has(token)).toBe(true)
    }
    // The (absent) base contributed nothing — its MODULE_OPTIONS_TOKEN is not here.
    expect(findProvider(providers, MODULE_OPTIONS_TOKEN)).toBeUndefined()
    expect(mod.global).toBe(true)
  })

  // The async factory must resolve, and every service plus the resolved-options,
  // events (null branch), and default-serializer providers must be injectable —
  // proving the BYMAX_CACHE_OPTIONS / EVENTS / SERIALIZER factories run.
  it('resolves the factory and makes services and derived providers injectable', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCacheModule.forRootAsync({
          useFactory: () => ({ connection: { host: 'h', lazyConnect: true }, namespace: 'async' })
        })
      ]
    }).compile()

    expect(moduleRef.get(ConnectionManager)).toBeInstanceOf(ConnectionManager)
    expect(moduleRef.get(KeyBuilder)).toBeInstanceOf(KeyBuilder)
    expect(moduleRef.get(CacheService)).toBeInstanceOf(CacheService)
    expect(moduleRef.get(PubSubService)).toBeInstanceOf(PubSubService)
    expect(moduleRef.get(ScriptManagerService)).toBeInstanceOf(ScriptManagerService)

    const resolved = moduleRef.get<ResolvedOptions>(BYMAX_CACHE_OPTIONS)
    expect(resolved.namespace).toBe('async')
    expect(resolved.connection?.host).toBe('h')
    // Defaulted fields prove applyDefaults ran inside the factory, not just validate.
    expect(resolved.isGlobal).toBe(true)
    // No events supplied → the derived events provider falls back to null.
    expect(moduleRef.get(BYMAX_CACHE_EVENTS)).toBeNull()
    // No serializer supplied → the derived serializer provider builds the default.
    expect(moduleRef.get(BYMAX_CACHE_SERIALIZER)).toBeInstanceOf(JsonSerializer)

    await moduleRef.close()
  })

  // useFactory must run with its `inject` dependencies resolved from an imported
  // module — the canonical ConfigService pattern — so the host comes from config.
  it('runs useFactory with injected dependencies from imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCacheModule.forRootAsync({
          imports: [HostConfigModule],
          inject: [HOST_CONFIG],
          useFactory: (config: { host: string }) => ({
            connection: { host: config.host, lazyConnect: true }
          })
        })
      ]
    }).compile()

    const resolved = moduleRef.get<ResolvedOptions>(BYMAX_CACHE_OPTIONS)
    expect(resolved.connection?.host).toBe('cfg-host')

    await moduleRef.close()
  })

  // The supplied `imports` must be propagated onto the produced DynamicModule so
  // the factory's injected providers are in scope.
  it('propagates imports to the dynamic module', () => {
    const mod = BymaxCacheModule.forRootAsync({
      imports: [HostConfigModule],
      inject: [HOST_CONFIG],
      useFactory: (config: { host: string }) => ({ connection: { host: config.host } })
    })

    expect(mod.imports).toContain(HostConfigModule)
  })

  // A supplied events bag and custom serializer must flow through the derived
  // factories (the truthy branches of `events ?? null` / `serializer ?? new`).
  it('derives events and serializer from the resolved options when supplied', async () => {
    const events: ICacheEvents = { onEvent: jest.fn() }
    const serializer = makeSerializer()
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCacheModule.forRootAsync({
          useFactory: () => ({ connection: { host: 'h', lazyConnect: true }, events, serializer })
        })
      ]
    }).compile()

    expect(moduleRef.get(BYMAX_CACHE_EVENTS)).toBe(events)
    expect(moduleRef.get(BYMAX_CACHE_SERIALIZER)).toBe(serializer)

    await moduleRef.close()
  })

  // Validation must happen INSIDE the BYMAX_CACHE_OPTIONS factory (after the async
  // resolve), so misconfigured options reject at bootstrap — not lazily later.
  it('rejects at bootstrap when the resolved options are invalid', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          BymaxCacheModule.forRootAsync({
            useFactory: () => ({ connection: { host: 'h' }, namespace: '' })
          })
        ]
      }).compile()
    ).rejects.toBeInstanceOf(CacheException)
  })

  // `isGlobal: false` must flip the DynamicModule's `global` flag (the builder
  // extra, honored synchronously before the async factory resolves).
  it('honors isGlobal: false', () => {
    const mod = BymaxCacheModule.forRootAsync({
      isGlobal: false,
      useFactory: () => ({ connection: { host: 'h' } })
    })

    expect(mod.global).toBe(false)
  })
})
