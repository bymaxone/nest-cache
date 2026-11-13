/**
 * End-to-end tests for `keyEscaping` over booted NestJS apps sharing one store.
 *
 * Uses `ioredis-mock`, whose store is shared by every client of one host, so a legacy app and a
 * strict app behave as two instances of one fleet on a single Redis. That is the mixed-version window
 * a rolling deploy opens: the scenarios pin what holds across it and what splits.
 */
import { CACHE_ERROR_CODES, CacheException, CacheService, KeyBuilder } from '@bymax-one/nest-cache'

import { bootCacheApp } from './fixtures/test-cache-app.module'

import type { TestingModule } from '@nestjs/testing'

// Swap real ioredis for the in-memory mock so the apps boot without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: Mock }
})

describe('keyEscaping E2E (ioredis-mock)', () => {
  let legacyApp: TestingModule
  let strictApp: TestingModule
  let legacy: CacheService
  let strict: CacheService

  beforeAll(async () => {
    legacyApp = await bootCacheApp({ connection: { host: 'shared' }, namespace: 'esc' })
    strictApp = await bootCacheApp({
      connection: { host: 'shared' },
      namespace: 'esc',
      keyEscaping: 'strict'
    })
    legacy = legacyApp.get(CacheService)
    strict = strictApp.get(CacheService)
  })

  afterAll(async () => {
    await legacyApp?.close()
    await strictApp?.close()
  })

  beforeEach(async () => {
    await legacy.getClient().flushall()
  })

  // The collision the option exists to fix, through the booted module: strict keeps both entries.
  it('keeps two tuples the unescaped composition merged under strict', async () => {
    await strict.set('a', 'b:c', 'first')
    await strict.set('a:b', 'c', 'second')

    expect(await strict.get('a', 'b:c')).toBe('first')
    expect(await strict.get('a:b', 'c')).toBe('second')
  })

  // A part holding no separator and no `%` composes one key in both modes, so a lock on it is one
  // lock across a mixed fleet: the second instance is refused whichever mode it runs.
  it('keeps mutual exclusion across modes for a key the escape does not touch', async () => {
    expect(await legacy.setNx('lock', 'job-42', 'legacy-holder', 30)).toBe(true)

    expect(await strict.setNx('lock', 'job-42', 'strict-holder', 30)).toBe(false)
    expect(await strict.get('lock', 'job-42')).toBe('legacy-holder')
  })

  // A rate-limit counter on an unaffected key is one counter across modes.
  it('shares one counter across modes for a key the escape does not touch', async () => {
    await legacy.incr('rl', 'user-7')
    await strict.incr('rl', 'user-7')

    expect(await legacy.get<number>('rl', 'user-7')).toBe(2)
  })

  // The documented split: a key whose id holds the separator is composed differently by the two
  // modes, so the same lock is held twice during a mixed-version rollout.
  it('splits a key the escape rewrites between the two modes', async () => {
    expect(await legacy.setNx('lock', 'tenant:job', 'legacy-holder', 30)).toBe(true)

    expect(await strict.setNx('lock', 'tenant:job', 'strict-holder', 30)).toBe(true)
    expect(await legacy.get('lock', 'tenant:job')).toBe('legacy-holder')
    expect(await strict.get('lock', 'tenant:job')).toBe('strict-holder')
  })

  // scan() under strict finds the escaped key by a glob over the id.
  it('scans escaped ids with a glob pattern', async () => {
    await strict.set('users', 'u:1', 'a')

    const found: string[] = []
    for await (const key of strict.scan('users', 'u*')) {
      found.push(key)
    }

    expect(found).toEqual(['esc:users:u%3A1'])
  })

  // A revocation-style sweep over a composite id: through idPrefixPattern it finds exactly the keys
  // of one owner, and the raw-separator pattern that cannot match is refused instead of returning
  // nothing.
  it('sweeps a composite id and refuses the pattern that could never match', async () => {
    const id = (...fields: string[]): string => fields.join(':')
    for (const fields of [
      ['u1', 's1'],
      ['u1', 's2'],
      ['u10', 's1']
    ]) {
      await strict.set('sessions', id(...fields), 'x')
    }
    const keys = strictApp.get(KeyBuilder)

    const swept: string[] = []
    for await (const key of strict.scan('sessions', keys.idPrefixPattern(['u1']))) {
      swept.push(key)
    }
    const refused = await strict.keys('sessions', 'u1:*').catch((error: unknown) => error)

    expect(swept.sort()).toEqual(['esc:sessions:u1%3As1', 'esc:sessions:u1%3As2'])
    expect(refused).toBeInstanceOf(CacheException)
    expect((refused as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
  })
})
