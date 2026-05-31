/**
 * End-to-end tests for {@link CacheService} over a booted NestJS app.
 *
 * Uses `ioredis-mock` (fast, in-memory) since the scenarios exercised here —
 * value roundtrips, batch reads/writes, deletes, counters, existence — behave
 * identically on the mock and a real server. Atomic-script and lifecycle
 * scenarios that the mock cannot reproduce live in the Testcontainers specs.
 */
import { CacheService } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'

import type { TestingModule } from '@nestjs/testing'

// Swap real ioredis for the in-memory mock so the app boots without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

interface User {
  name: string
  age: number
}

describe('CacheService E2E (ioredis-mock)', () => {
  let app: TestingModule
  let cache: CacheService

  beforeAll(async () => {
    app = await bootCacheApp({ connection: { host: 'localhost' }, namespace: 'e2e' })
    cache = app.get(CacheService)
  })

  afterAll(async () => {
    await app?.close()
  })

  // A structured value must survive a set→get roundtrip through the configured
  // serializer, proving the full module path (DI, key builder, serializer, client).
  it('roundtrips a structured value through set and get', async () => {
    const user: User = { name: 'Ada', age: 36 }
    await cache.set('user', 'roundtrip', user)

    expect(await cache.get<User>('user', 'roundtrip')).toEqual(user)
  })

  // A missing key must read back as null (the cache-miss contract), not throw.
  it('returns null for a missing key', async () => {
    expect(await cache.get('user', 'absent')).toBeNull()
  })

  // mset/mget must write and read a batch in one call, preserving order and types.
  it('writes and reads a batch via mset and mget', async () => {
    await cache.mset<number>('score', [
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])

    expect(await cache.mget<number>('score', ['a', 'b', 'c'])).toEqual([1, 2, 3])
  })

  // del must remove a key so a subsequent get misses — and report one key deleted.
  it('deletes a key', async () => {
    await cache.set('user', 'deletable', { name: 'Bob', age: 1 })

    expect(await cache.del('user', 'deletable')).toBe(1)
    expect(await cache.get('user', 'deletable')).toBeNull()
  })

  // incr must atomically create-and-increment a counter, returning the new value.
  it('increments a counter', async () => {
    expect(await cache.incr('visits', 'counter')).toBe(1)
    expect(await cache.incr('visits', 'counter', 4)).toBe(5)
  })

  // exists must reflect a key's presence before and after it is written.
  it('reports key existence', async () => {
    expect(await cache.exists('flag', 'present')).toBe(false)
    await cache.set('flag', 'present', true)
    expect(await cache.exists('flag', 'present')).toBe(true)
  })
})
