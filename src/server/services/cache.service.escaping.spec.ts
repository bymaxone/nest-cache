/**
 * Unit tests for {@link CacheService} under `keyEscaping: 'strict'`.
 *
 * Layer: server. The key builder owns the escape; these tests pin what the service does with it: two
 * tuples the legacy composition merged now hold two entries, and `keys()` / `scan()` keep treating
 * their pattern as a glob while the prefix stays a literal.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
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

  // The ticket's collision, end to end through the service: the second write used to replace the
  // first.
  it('keeps two tuples the legacy composition merged as two entries', async () => {
    const made = await setup('strict')
    connection = made.connection

    await made.cache.set('a', 'b:c', 'first')
    await made.cache.set('a:b', 'c', 'second')

    expect(await made.cache.get('a', 'b:c')).toBe('first')
    expect(await made.cache.get('a:b', 'c')).toBe('second')
  })

  // The same two writes under legacy do collide, which pins that the default did not move.
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

  // A glob metacharacter in the prefix is a literal under strict, so a prefix of `u*` no longer
  // widens a scan to every group that starts with `u`.
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
})
