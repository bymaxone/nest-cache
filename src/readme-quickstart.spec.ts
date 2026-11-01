/**
 * Execution test for the README Quick Start.
 *
 * Layer: repository root (drives the public entry point of the package, with an in-memory Redis).
 * `check:published` compiles the Quick Start snippets but cannot run them, so a wrong argument
 * shape or a value that fails validation would still compile. This test runs the flow as the
 * README writes it: the Scenario 1 module (`url` and `namespace` as shown), the `ProfileService`
 * of "3. Inject `CacheService`", and the outcome the README states: the key is
 * `app:user-profile:<userId>` and the value is written with a 3600-second TTL.
 */
import { Inject, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCacheModule, CacheService } from '@bymax-one/nest-cache'

// Swap the real ioredis for the in-memory mock, so the module's own options handling (the URL
// parsing, the defaults) runs for real and only the socket is replaced.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

interface Profile {
  id: string
  name: string
}

/** Stands in for the application's repository, which the README leaves undeclared. */
class ProfileRepository {
  readonly findProfile = jest.fn(async (userId: string): Promise<Profile> => ({
    id: userId,
    name: 'Ada'
  }))
}

// README "3. Inject `CacheService`", unchanged apart from the `repo` property.
@Injectable()
class ProfileService {
  // Not in the README: it leaves `this.repo` undeclared.
  @Inject(ProfileRepository) private readonly repo!: ProfileRepository

  constructor(private readonly cache: CacheService) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const cached = await this.cache.get<Profile>('user-profile', userId)
    if (cached) return cached

    const profile = await this.repo.findProfile(userId)
    await this.cache.set('user-profile', userId, profile, 3600) // TTL in seconds
    return profile
  }
}

// A consumer's tsconfig compiles with `emitDecoratorMetadata` (Nest's default), which is what lets
// the README's constructor inject `CacheService` without an `@Inject`. This suite's tsconfig does
// not, so the metadata the compiler would emit is declared here.
Reflect.defineMetadata('design:paramtypes', [CacheService], ProfileService)

// README Scenario 1 — Standalone, unchanged.
@Module({
  imports: [
    BymaxCacheModule.forRoot({
      connection: { url: 'redis://localhost:6379' },
      namespace: 'app'
    })
  ],
  providers: [ProfileRepository, ProfileService]
})
class AppModule {}

describe('README Quick Start', () => {
  /*
   * Scenario: guards README "Quick Start" (2. Register the Module, Scenario 1, and 3. Inject
   * `CacheService`). If the README flow changes, this test changes with it.
   * Arrange: the Scenario 1 module and the ProfileService, over an in-memory Redis.
   * Act: ask for the same profile twice.
   * Assert: the first call reads the repository and stores the value under
   * `app:user-profile:<userId>` with a 3600-second TTL; the second is served from the cache.
   */
  it('caches a profile under app:user-profile:<userId> with a 3600-second TTL', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    await moduleRef.init()
    const cache = moduleRef.get(CacheService)
    const repository = moduleRef.get(ProfileRepository)
    const service = moduleRef.get(ProfileService)
    await cache.getClient().flushall()

    const first = await service.getProfile('42')
    const second = await service.getProfile('42')

    const client = cache.getClient()
    expect(first).toEqual({ id: '42', name: 'Ada' })
    expect(second).toEqual(first)
    expect(repository.findProfile).toHaveBeenCalledTimes(1)
    expect(JSON.parse((await client.get('app:user-profile:42')) ?? 'null')).toEqual(first)
    const ttl = await client.ttl('app:user-profile:42')
    expect(ttl).toBeGreaterThan(3590)
    expect(ttl).toBeLessThanOrEqual(3600)

    await moduleRef.close()
  })
})
