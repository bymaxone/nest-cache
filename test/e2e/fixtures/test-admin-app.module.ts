/**
 * End-to-end fixture for the `./admin` subpath.
 *
 * Boots a real NestJS context wired with both `BymaxCacheModule` and
 * `BymaxCacheAdminModule`, so the administration services resolve through the
 * same DI graph a consumer builds — including the cross-subpath injection that
 * a bundling mistake would break.
 */
import { Module } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'

import { BymaxCacheModule } from '@bymax-one/nest-cache'
import { BymaxCacheAdminModule } from '@bymax-one/nest-cache/admin'

/** Options accepted by the cache module. */
export type CacheAppOptions = Parameters<typeof BymaxCacheModule.forRoot>[0]
/** Options accepted by the admin module. */
export type AdminAppOptions = Parameters<typeof BymaxCacheAdminModule.forRoot>[0]

/**
 * Builds and initializes a context wired with the cache and admin modules.
 *
 * @param cacheOptions - Forwarded to `BymaxCacheModule.forRoot`.
 * @param adminOptions - Forwarded to `BymaxCacheAdminModule.forRoot`.
 * @returns The initialized {@link TestingModule}; call `close()` when done.
 */
export async function bootAdminApp(
  cacheOptions: CacheAppOptions,
  adminOptions: AdminAppOptions
): Promise<TestingModule> {
  @Module({
    imports: [BymaxCacheModule.forRoot(cacheOptions), BymaxCacheAdminModule.forRoot(adminOptions)]
  })
  class TestAdminAppModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestAdminAppModule] }).compile()
  await moduleRef.init()
  return moduleRef
}
