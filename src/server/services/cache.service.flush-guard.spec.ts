/**
 * Unit tests for the production guard of {@link CacheService.flushNamespace}.
 *
 * Layer: server. The guard compares `NODE_ENV` trimmed and without regard to case, and treats only the
 * name `production` as production.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

describe('CacheService flushNamespace production guard', () => {
  let connection: ConnectionManager
  let cache: CacheService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    cache = new CacheService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  // The guard compares the environment name trimmed and without regard to case: `Production` and
  // ` PRODUCTION ` name production, and must not slip past a strict comparison.
  it.each(['Production', 'PRODUCTION', ' production ', 'production\n'])(
    'refuses to flush when NODE_ENV is %j',
    async (value) => {
      jest.replaceProperty(process.env, 'NODE_ENV', value)

      await expect(cache.flushNamespace()).rejects.toMatchObject({
        code: CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION
      })
    }
  )

  // Only the name `production` is production: `prod` and `staging` are not guessed at.
  it.each(['prod', 'staging', 'development', ''])(
    'does not treat NODE_ENV %j as production',
    async (value) => {
      jest.replaceProperty(process.env, 'NODE_ENV', value)

      await expect(cache.flushNamespace()).resolves.toBeGreaterThanOrEqual(0)
    }
  )
})
