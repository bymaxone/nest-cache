import { Global, Inject, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCacheAdminModule } from './bymax-cache-admin.module'
import { BYMAX_CACHE_ADMIN_OPTIONS } from './bymax-cache-admin.constants'
import { CacheAdminService } from './services/cache-admin.service'
import { CacheStatusService } from './services/cache-status.service'
import { BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER } from '../server/bymax-cache.constants'
import { applyDefaults } from '../server/config/default-options'
import { CacheException } from '../server/errors/cache.exception'
import { CacheService } from '../server/services/cache.service'
import { JsonSerializer } from '../server/utils/json-serializer'

import type { CacheScope } from './interfaces/cache-scope.interface'
import type { DynamicModule } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'

const SCOPES: readonly CacheScope[] = [
  { id: 'cache', label: 'Cache', pattern: 'app:*', isReadable: true, origin: 'the namespace' }
]

/** Stands in for the cache module's exports, which the admin services inject.
 * Global, because the real `BymaxCacheModule` is global by default and that is
 * how a consumer's admin module reaches these providers. */
@Global()
@Module({
  providers: [
    {
      provide: CacheService,
      useValue: { ping: jest.fn(), info: jest.fn(), getClient: jest.fn() }
    },
    { provide: BYMAX_CACHE_OPTIONS, useValue: applyDefaults({ connection: { host: 'h' } }) },
    { provide: BYMAX_CACHE_SERIALIZER, useValue: new JsonSerializer() }
  ],
  exports: [CacheService, BYMAX_CACHE_OPTIONS, BYMAX_CACHE_SERIALIZER]
})
class FakeCacheModule {}

/** Boots a module definition alongside the cache providers it depends on. */
const boot = async (definition: DynamicModule): Promise<TestingModule> =>
  Test.createTestingModule({ imports: [FakeCacheModule, definition] }).compile()

describe('BymaxCacheAdminModule.forRoot', () => {
  // Both services must resolve from the DI graph — the tsup build strips
  // decorator metadata, so a missing explicit @Inject only shows up here.
  it('resolves both administration services', async () => {
    const moduleRef = await boot(BymaxCacheAdminModule.forRoot({ scopes: SCOPES }))
    expect(moduleRef.get(CacheStatusService)).toBeInstanceOf(CacheStatusService)
    expect(moduleRef.get(CacheAdminService)).toBeInstanceOf(CacheAdminService)
  })

  // The resolved options must be reachable by token, so a consumer can read the
  // thresholds it did not set rather than guessing which defaults applied.
  it('exposes the resolved options under their token', async () => {
    const moduleRef = await boot(BymaxCacheAdminModule.forRoot({ scopes: SCOPES }))
    expect(moduleRef.get(BYMAX_CACHE_ADMIN_OPTIONS)).toMatchObject({ scopes: SCOPES })
  })

  // A privileged surface is wired where it is used, not everywhere by default.
  it('is not global by default', () => {
    expect(BymaxCacheAdminModule.forRoot({ scopes: SCOPES }).global).toBe(false)
  })

  // An explicit opt-in must be honoured — the safe default is only safe if it can
  // still be overridden deliberately.
  it('honours an explicit global registration', () => {
    expect(BymaxCacheAdminModule.forRoot({ scopes: SCOPES, isGlobal: true }).global).toBe(true)
  })

  // Validation happens at WIRING, so a malformed declaration fails the boot
  // rather than the first request that happens to touch it.
  it('throws at wiring on a malformed scope', () => {
    expect(() => BymaxCacheAdminModule.forRoot({ scopes: [] })).toThrow(CacheException)
  })
})

describe('BymaxCacheAdminModule.forRootAsync', () => {
  // The async path must wire the same services as the sync one; a factory that
  // built options nobody could resolve would fail only at first use.
  it('resolves both services from an async factory', async () => {
    const moduleRef = await boot(
      BymaxCacheAdminModule.forRootAsync({ useFactory: () => ({ scopes: SCOPES }) })
    )
    expect(moduleRef.get(CacheStatusService)).toBeInstanceOf(CacheStatusService)
    expect(moduleRef.get(CacheAdminService)).toBeInstanceOf(CacheAdminService)
  })

  // A factory returning a promise is the normal case for config loaded at boot,
  // so the result must be awaited rather than stored as a pending promise.
  it('awaits a promise-returning factory', async () => {
    const moduleRef = await boot(
      BymaxCacheAdminModule.forRootAsync({
        useFactory: async () => Promise.resolve({ scopes: SCOPES })
      })
    )
    expect(moduleRef.get(BYMAX_CACHE_ADMIN_OPTIONS)).toMatchObject({ scopes: SCOPES })
  })

  // The same validation runs on both paths, so neither can drift into accepting
  // what the other rejects.
  it('validates the factory result', async () => {
    await expect(
      boot(BymaxCacheAdminModule.forRootAsync({ useFactory: () => ({ scopes: [] }) }))
    ).rejects.toThrow(CacheException)
  })

  // `isGlobal` is decided synchronously because Nest needs the flag while
  // building the definition, before any factory has resolved.
  it('decides global registration synchronously', () => {
    expect(
      BymaxCacheAdminModule.forRootAsync({ useFactory: () => ({ scopes: SCOPES }), isGlobal: true })
        .global
    ).toBe(true)
  })

  // The privileged default holds on the async path too — a flag decided in two
  // places is a flag that eventually disagrees with itself.
  it('is not global by default', () => {
    expect(
      BymaxCacheAdminModule.forRootAsync({ useFactory: () => ({ scopes: SCOPES }) }).global
    ).toBe(false)
  })

  // Omitted wiring must default to empty rather than undefined, which Nest would
  // reject while building the module definition.
  it('defaults imports and inject to empty', () => {
    const definition = BymaxCacheAdminModule.forRootAsync({
      useFactory: () => ({ scopes: SCOPES })
    })
    expect(definition.imports).toEqual([])
  })

  // A factory that injects a provider must receive it, or async wiring is
  // decorative. The provider arrives through `imports`, which exercises that
  // passthrough at the same time.
  it('injects providers from an imported module into the factory', async () => {
    const TOKEN = Symbol('scopes-source')

    @Module({ providers: [{ provide: TOKEN, useValue: SCOPES }], exports: [TOKEN] })
    class ScopesModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeCacheModule,
        BymaxCacheAdminModule.forRootAsync({
          imports: [ScopesModule],
          inject: [TOKEN],
          useFactory: (scopes: readonly CacheScope[]) => ({ scopes })
        })
      ]
    }).compile()
    expect(moduleRef.get(BYMAX_CACHE_ADMIN_OPTIONS)).toMatchObject({ scopes: SCOPES })
  })
})

describe('BymaxCacheAdminModule exports', () => {
  /** A consumer that injects the admin services from OUTSIDE the admin module. */
  @Injectable()
  class ConsumerService {
    constructor(
      @Inject(CacheStatusService) readonly status: CacheStatusService,
      @Inject(CacheAdminService) readonly admin: CacheAdminService,
      @Inject(BYMAX_CACHE_ADMIN_OPTIONS) readonly options: unknown
    ) {}
  }

  /**
   * Boots a consumer module that imports the admin module rather than declaring
   * its providers. This is the only shape that exercises `exports`: resolving
   * from the admin module itself succeeds whether or not anything is exported,
   * so a test that did that would pass against an empty export list.
   */
  const bootConsumer = async (definition: DynamicModule): Promise<TestingModule> => {
    @Module({ imports: [definition], providers: [ConsumerService] })
    class ConsumerModule {}

    return Test.createTestingModule({ imports: [FakeCacheModule, ConsumerModule] }).compile()
  }

  // Both services must cross the module boundary, or a consumer can wire the
  // admin module and still not reach the thing it wired it for.
  it('exports both services to an importing module', async () => {
    const moduleRef = await bootConsumer(BymaxCacheAdminModule.forRoot({ scopes: SCOPES }))
    const consumer = moduleRef.get(ConsumerService)
    expect(consumer.status).toBeInstanceOf(CacheStatusService)
    expect(consumer.admin).toBeInstanceOf(CacheAdminService)
  })

  // The options token is exported too, so a consumer can read the thresholds it
  // did not set instead of duplicating the defaults.
  it('exports the options token to an importing module', async () => {
    const moduleRef = await bootConsumer(BymaxCacheAdminModule.forRoot({ scopes: SCOPES }))
    expect(moduleRef.get(ConsumerService).options).toMatchObject({ scopes: SCOPES })
  })

  // The async path exports the same surface; the two wiring paths must not
  // disagree about what a consumer can reach.
  it('exports the same surface from the async path', async () => {
    const moduleRef = await bootConsumer(
      BymaxCacheAdminModule.forRootAsync({ useFactory: () => ({ scopes: SCOPES }) })
    )
    const consumer = moduleRef.get(ConsumerService)
    expect(consumer.status).toBeInstanceOf(CacheStatusService)
    expect(consumer.admin).toBeInstanceOf(CacheAdminService)
  })
})
