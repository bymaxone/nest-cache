/**
 * End-to-end test of opt-in read validation over a booted NestJS app.
 *
 * Uses `ioredis-mock`. A real zod 4 schema is the validator, since Standard Schema interop is the
 * contract. The scenarios are the ones a host meets: a stale shape after a deploy, treated as a miss
 * and rewritten, and a message of the wrong shape never reaching the subscriber.
 */
import {
  CACHE_ERROR_CODES,
  CacheException,
  CacheService,
  PubSubService
} from '@bymax-one/nest-cache'
import { z } from 'zod'

import { bootCacheApp } from './fixtures/test-cache-app.module'

import type { TestingModule } from '@nestjs/testing'

// Swap real ioredis for the in-memory mock so the app boots without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

const userSchema = z.object({ id: z.number(), name: z.string() })

describe('read validation E2E (ioredis-mock)', () => {
  let app: TestingModule
  let cache: CacheService
  let pubsub: PubSubService

  beforeAll(async () => {
    app = await bootCacheApp({ connection: { host: 'localhost' }, namespace: 'rv' })
    cache = app.get(CacheService)
    pubsub = app.get(PubSubService)
  })

  afterAll(async () => {
    await app?.close()
  })

  // The rolling-deploy pattern: an entry of the old shape fails validation, the host treats it as a
  // miss and rewrites it, and the next read passes.
  it('treats a stale shape as a miss and the rewritten entry then validates', async () => {
    await cache.set('user', '1', { legacy: true })

    const stale = await cache
      .get('user', '1', { validate: userSchema })
      .catch((error: unknown) =>
        error instanceof CacheException && error.code === CACHE_ERROR_CODES.VALIDATION_FAILED
          ? null
          : Promise.reject(error)
      )
    await cache.set('user', '1', { id: 1, name: 'Ada' })

    expect(stale).toBeNull()
    await expect(cache.get('user', '1', { validate: userSchema })).resolves.toEqual({
      id: 1,
      name: 'Ada'
    })
  })

  // The failed read left the entry where it was, and the error holds no part of it.
  it('leaves a wrong-shape entry in place and keeps its value out of the error', async () => {
    await cache.set('user', '2', { id: 'secret-token-123' })

    const error = await cache.get('user', '2', { validate: userSchema }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CacheException)
    expect(JSON.stringify((error as CacheException).getResponse())).not.toContain('secret')
    await expect(cache.get('user', '2')).resolves.toEqual({ id: 'secret-token-123' })
  })

  // A message of the wrong shape is dropped, and one of the right shape is delivered.
  it('delivers only the messages that validate', async () => {
    const received: unknown[] = []
    await pubsub.subscribe('users', (message) => void received.push(message), {
      validate: userSchema
    })

    await pubsub.publish('users', { id: 1, name: 'Ada' })
    await pubsub.publish('users', { id: 'x' })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(received).toEqual([{ id: 1, name: 'Ada' }])
  })
})
