import { EventEmitter } from 'node:events'

import { Test } from '@nestjs/testing'

import { ConnectionManager } from './connection/connection.manager'
import { CacheException } from './errors/cache.exception'
import { KeyBuilder } from './utils/key-builder'
import { BymaxCacheModule } from './bymax-cache.module'
import {
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS
} from './bymax-cache.constants'
import { MODULE_OPTIONS_TOKEN } from './bymax-cache.module.builder'

import type { DynamicModule, Provider } from '@nestjs/common'

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

/** Locates a class/value provider entry by its provide token. */
const findProvider = (providers: Provider[], token: unknown): Provider | undefined =>
  providers.find(
    (provider) => provider === token || (provider as { provide?: unknown }).provide === token
  )

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
    expect(providers).toContain(ConnectionManager)
    expect(providers).toContain(KeyBuilder)

    expect(mod.exports).toEqual([
      BYMAX_CACHE_OPTIONS,
      BYMAX_CACHE_KEY_BUILDER,
      ConnectionManager,
      KeyBuilder
    ])
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

  // The wired ConnectionManager and KeyBuilder must be resolvable from the DI
  // container — proves the explicit @Inject tokens line up. lazyConnect keeps
  // onModuleInit from awaiting a (mocked) readiness signal.
  it('makes ConnectionManager and KeyBuilder injectable', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCacheModule.forRoot({ connection: { host: 'h', lazyConnect: true } })]
    }).compile()

    expect(moduleRef.get(ConnectionManager)).toBeInstanceOf(ConnectionManager)
    expect(moduleRef.get(KeyBuilder)).toBeInstanceOf(KeyBuilder)

    await moduleRef.close()
  })

  // forRootAsync is not wired with the cache providers until Phase 4 — it must
  // fail loud rather than build a silently-broken module.
  it('rejects forRootAsync until Phase 4', () => {
    expect(() =>
      BymaxCacheModule.forRootAsync({ useFactory: () => ({ connection: { host: 'h' } }) })
    ).toThrow(/Phase 4/)
  })
})
