/**
 * Unit tests for {@link CacheService} under `keyEscaping: 'strict'`.
 *
 * Layer: server. The key builder owns the escape; these tests pin what the service does with it: two
 * tuples the legacy composition merged now hold two entries, and `keys()` / `scan()` keep treating
 * their pattern as a glob while the prefix stays a literal.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

/** Builds a service wired to a fresh in-memory store under the given escaping mode. */
const setup = async (
  keyEscaping: 'legacy' | 'strict'
): Promise<{ cache: CacheService; connection: ConnectionManager }> => {
  const options = applyDefaults({ connection: { host: 'h' }, namespace: 'test', keyEscaping })
  const connection = new ConnectionManager(options)
  await connection.onModuleInit()
  await connection.getClient().flushall()
  const cache = new CacheService(options, connection, new KeyBuilder(options))
  return { cache, connection }
}

describe('CacheService under strict key escaping', () => {
  let connection: ConnectionManager

  afterEach(async () => {
    await connection.onApplicationShutdown()
  })

  // Two tuples the plain join merges stay two entries through the service: the second write does
  // not replace the first.
  it('keeps two tuples the legacy composition merged as two entries', async () => {
    const made = await setup('strict')
    connection = made.connection

    await made.cache.set('a', 'b:c', 'first')
    await made.cache.set('a:b', 'c', 'second')

    expect(await made.cache.get('a', 'b:c')).toBe('first')
    expect(await made.cache.get('a:b', 'c')).toBe('second')
  })

  // The same two writes under legacy do collide: the default composes the plain join.
  it('still merges them under legacy, the default', async () => {
    const made = await setup('legacy')
    connection = made.connection

    await made.cache.set('a', 'b:c', 'first')
    await made.cache.set('a:b', 'c', 'second')

    expect(await made.cache.get('a', 'b:c')).toBe('second')
  })

  // scan() must keep matching a glob in the id position after the id is stored escaped, and must
  // yield the escaped key as stored.
  it('scan matches a glob pattern and yields the stored key', async () => {
    const made = await setup('strict')
    connection = made.connection
    await made.cache.set('users', 'u:1', 'a')
    await made.cache.set('users', 'u_2', 'b')

    const found: string[] = []
    for await (const key of made.cache.scan('users', 'u*')) {
      found.push(key)
    }

    expect(found.sort()).toEqual(['test:users:u%3A1', 'test:users:u_2'])
  })

  // keys() takes the same pattern path as scan().
  it('keys matches a glob pattern against escaped ids', async () => {
    const made = await setup('strict')
    connection = made.connection
    await made.cache.set('users', 'u:1', 'a')

    expect(await made.cache.keys('users', '*')).toEqual(['test:users:u%3A1'])
  })

  // A glob metacharacter in the prefix is a literal under strict, so a prefix of `u*` does not
  // widen a scan to every group that starts with `u`.
  it('does not let a glob character in the prefix widen the scan', async () => {
    const made = await setup('strict')
    connection = made.connection
    await made.cache.set('users', 'u_1', 'a')
    await made.cache.set('u*', 'x', 'b')

    expect(await made.cache.keys('u*', '*')).toEqual(['test:u%2A:x'])
  })

  // An unpaired `]` is a literal to Redis and is deliberately not rewritten, so it must not widen
  // either. Pinned because dropping it from the escape set is only safe while that stays true.
  it('does not let an unpaired ] in the prefix widen the scan', async () => {
    const made = await setup('strict')
    connection = made.connection
    await made.cache.set('a]', 'x', 'one')
    await made.cache.set('a', 'x', 'two')
    await made.cache.set('ab', 'x', 'three')

    expect(await made.cache.keys('a]', '*')).toEqual(['test:a]:x'])
    const scanned: string[] = []
    for await (const key of made.cache.scan('a]', '*')) {
      scanned.push(key)
    }
    expect(scanned).toEqual(['test:a]:x'])
  })

  // A sweep over a composite id works under strict through the helper and finds exactly the keys of
  // that owner, not the neighbours whose escaped characters begin like it.
  it('sweeps a composite id through idPrefixPattern, scan and keys', async () => {
    const made = await setup('strict')
    connection = made.connection
    const builder = new KeyBuilder(
      applyDefaults({ connection: { host: 'h' }, namespace: 'test', keyEscaping: 'strict' })
    )
    const idOf = (...fields: string[]): string => fields.map((f) => builder.escapePart(f)).join(':')
    for (const fields of [
      ['u1', 's1'],
      ['u1', 's2'],
      ['u10', 's1'],
      ['u1%', 's1'],
      ['u1*', 's1']
    ]) {
      await made.cache.set('sessions', idOf(...fields), fields.join('/'))
    }
    const pattern = builder.idPrefixPattern(['u1'])

    const scanned: string[] = []
    for await (const key of made.cache.scan('sessions', pattern)) {
      scanned.push(key)
    }

    expect(scanned.sort()).toEqual(['test:sessions:u1%3As1', 'test:sessions:u1%3As2'])
    expect((await made.cache.keys('sessions', pattern)).sort()).toEqual(scanned)
  })

  // The same sweep written with the raw separator can never match under strict, so it is refused
  // instead of returning nothing.
  it('refuses a raw-separator pattern on scan and on keys', async () => {
    const made = await setup('strict')
    connection = made.connection
    await made.cache.set('sessions', 'u1:s1', 'a')

    const onKeys = await made.cache.keys('sessions', 'u1:*').catch((error: unknown) => error)
    const onScan = await (async (): Promise<unknown> => {
      try {
        for await (const _key of made.cache.scan('sessions', 'u1:*')) {
          // drain
        }
      } catch (error) {
        return error
      }
      return undefined
    })()

    for (const caught of [onKeys, onScan]) {
      expect(caught).toBeInstanceOf(CacheException)
      expect((caught as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_KEY)
      expect((caught as CacheException).details).toEqual({ reason: 'pattern_contains_separator' })
    }
  })
})
