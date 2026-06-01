/**
 * Unit tests for {@link BymaxCacheModule.forRoot} (synchronous registration).
 *
 * Layer: server. Asserts the produced {@link DynamicModule} shape — providers,
 * the serializer/events tokens, exports, and the `global` flag — plus DI
 * injectability of the wired services. ioredis is mocked with a bare
 * `EventEmitter` so constructing the providers never opens a socket. The async
 * counterpart lives in `bymax-cache.module.async.spec.ts`.
 */
import { EventEmitter } from 'node:events'

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
import { MODULE_OPTIONS_TOKEN } from './bymax-cache.module.builder'

import type { ISerializer } from './interfaces/serializer.interface'
import type { DynamicModule } from '@nestjs/common'

// Mock ioredis so constructing the module's ConnectionManager (during the
// injectability test) never opens a real socket. A bare EventEmitter is enough
// for the providers to instantiate; the listeners attach harmlessly.
jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'wait'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
  }
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeRedis, default: FakeRedis }
})

import { findProvider } from '../test-helpers/provider.helpers'

describe('BymaxCacheModule.forRoot', () => {
  // forRoot must return a global DynamicModule wiring every public token plus the
  // ConnectionManager and KeyBuilder, with the documented exports.
  it('returns a global module with the expected providers and exports', () => {
    const mod: DynamicModule = BymaxCacheModule.forRoot({ connection: { host: 'h' } })

    expect(mod.module).toBe(BymaxCacheModule)
    expect(mod.global).toBe(true)

    const providers = mod.providers ?? []
    expect(findProvider(providers, MODULE_OPTIONS_TOKEN)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_OPTIONS)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_EVENTS)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_KEY_BUILDER)).toBeDefined()
    expect(findProvider(providers, BYMAX_CACHE_SERIALIZER)).toBeDefined()
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

  // The default serializer must be wired as the BYMAX_CACHE_SERIALIZER class
  // provider, so a consumer that omits `options.serializer` still gets JSON.
  it('wires JsonSerializer as the default serializer provider', () => {
    const mod = BymaxCacheModule.forRoot({ connection: { host: 'h' } })

    const provider = findProvider(mod.providers ?? [], BYMAX_CACHE_SERIALIZER)
    expect(provider).toEqual({ provide: BYMAX_CACHE_SERIALIZER, useClass: JsonSerializer })
  })

  // A consumer-supplied serializer must be wired onto the BYMAX_CACHE_SERIALIZER
  // token via useValue, so anything injecting the token receives the configured
  // serializer rather than the default — matching the token's "override" contract.
  it('wires options.serializer onto the serializer token when supplied', () => {
    const customSerializer: ISerializer = {
      serialize<T>(value: T): string {
        return JSON.stringify(value)
      },
      deserialize<T>(raw: string): T {
        return JSON.parse(raw) as T
      }
    }

    const mod = BymaxCacheModule.forRoot({
      connection: { host: 'h' },
      serializer: customSerializer
    })

    const provider = findProvider(mod.providers ?? [], BYMAX_CACHE_SERIALIZER)
    expect(provider).toEqual({ provide: BYMAX_CACHE_SERIALIZER, useValue: customSerializer })
  })

  // When `isGlobal: false` is supplied, the resolved flag must flip the
  // DynamicModule's `global` to false (the non-default branch).
  it('honors isGlobal: false', () => {
    const mod = BymaxCacheModule.forRoot({ connection: { host: 'h' }, isGlobal: false })

    expect(mod.global).toBe(false)
  })

  // With an events bag, the BYMAX_CACHE_EVENTS provider must carry the bag (the
  // truthy side of `resolved.events ?? null`).
  it('provides the events bag when supplied', () => {
    const events = { onEvent: jest.fn() }
    const mod = BymaxCacheModule.forRoot({ connection: { host: 'h' }, events })

    const provider = findProvider(mod.providers ?? [], BYMAX_CACHE_EVENTS)
    expect(provider).toEqual({ provide: BYMAX_CACHE_EVENTS, useValue: events })
  })

  // Without an events bag, the provider must fall back to `null` (the nullish
  // side of `resolved.events ?? null`) so the @Optional() injection is satisfied.
  it('provides null for events when omitted', () => {
    const mod = BymaxCacheModule.forRoot({ connection: { host: 'h' } })

    const provider = findProvider(mod.providers ?? [], BYMAX_CACHE_EVENTS)
    expect(provider).toEqual({ provide: BYMAX_CACHE_EVENTS, useValue: null })
  })

  // Invalid options must throw at forRoot call time (fail fast at bootstrap),
  // not lazily at first command.
  it('throws at registration time for invalid options', () => {
    expect(() => BymaxCacheModule.forRoot({})).toThrow(CacheException)
  })

  // The wired ConnectionManager, KeyBuilder, CacheService, and default serializer
  // must all be resolvable from the DI container — proves the explicit @Inject
  // tokens line up. lazyConnect keeps onModuleInit from awaiting a (mocked)
  // readiness signal.
  it('makes ConnectionManager, KeyBuilder, CacheService, and the serializer injectable', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCacheModule.forRoot({ connection: { host: 'h', lazyConnect: true } })]
    }).compile()

    expect(moduleRef.get(ConnectionManager)).toBeInstanceOf(ConnectionManager)
    expect(moduleRef.get(KeyBuilder)).toBeInstanceOf(KeyBuilder)
    expect(moduleRef.get(CacheService)).toBeInstanceOf(CacheService)
    expect(moduleRef.get(PubSubService)).toBeInstanceOf(PubSubService)
    expect(moduleRef.get(ScriptManagerService)).toBeInstanceOf(ScriptManagerService)
    expect(moduleRef.get(BYMAX_CACHE_SERIALIZER)).toBeInstanceOf(JsonSerializer)

    await moduleRef.close()
  })
})
