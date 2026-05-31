/**
 * End-to-end app fixture.
 *
 * Boots a real NestJS application context whose only import is
 * `BymaxCacheModule.forRoot(...)`, then runs the full lifecycle (`init()` fires
 * `onModuleInit` → connection, and `onApplicationBootstrap` → eager script load).
 * Specs resolve `CacheService` / `PubSubService` from the returned context and
 * `close()` it in `afterAll` to exercise graceful shutdown.
 */
import { Module } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'

import { BymaxCacheModule } from '@bymax-one/nest-cache'

/** The exact option object `BymaxCacheModule.forRoot` accepts. */
export type CacheAppOptions = Parameters<typeof BymaxCacheModule.forRoot>[0]

/**
 * Builds and initializes a NestJS context wired with the cache module.
 *
 * @param options - Options forwarded verbatim to `BymaxCacheModule.forRoot`.
 * @returns The initialized {@link TestingModule}; call `close()` when done.
 */
export async function bootCacheApp(options: CacheAppOptions): Promise<TestingModule> {
  @Module({ imports: [BymaxCacheModule.forRoot(options)] })
  class TestCacheAppModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestCacheAppModule] }).compile()
  await moduleRef.init()
  return moduleRef
}
