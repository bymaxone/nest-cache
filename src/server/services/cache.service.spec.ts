/**
 * Unit tests for {@link CacheService}.
 *
 * Layer: server. Exercises every command family (string/raw, numeric, expiration,
 * batch, hash, set, iteration, pipeline, flushNamespace) against an in-memory
 * ioredis-mock, plus serializer-selection priority and the Cluster-mode and
 * production-flush guards. Routing and SCAN-count assertions pin the
 * mutation-sensitive branches the published gate (Stryker) targets.
 */
import { Readable } from 'node:stream'

import { applyDefaults } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { CacheService } from './cache.service'

import type { ResolvedOptions } from '../config/resolved-options'
import type { ISerializer } from '../interfaces/serializer.interface'
import type { ScriptManagerService } from './script-manager.service'
import type { Redis } from 'ioredis'

// Swap the real ioredis for the in-memory mock so the ConnectionManager builds a
// working client without a socket. `require` inside the factory keeps it within
// the jest.mock hoisting scope (top-level imports cannot be referenced here).
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

/** Builds a fresh ISerializer whose methods can be spied for selection tests. */
const makeSerializer = (): ISerializer => ({
  serialize<T>(value: T): string {
    return JSON.stringify(value)
  },
  deserialize<T>(raw: string): T {
    return JSON.parse(raw) as T
  }
})

describe('CacheService', () => {
  let options: ResolvedOptions
  let connection: ConnectionManager
  let keyBuilder: KeyBuilder
  let cache: CacheService

  beforeEach(async () => {
    options = applyDefaults({ connection: { host: 'h' }, namespace: 'test' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    // The mock store can persist across instances; start every test from empty.
    await connection.getClient().flushall()
    keyBuilder = new KeyBuilder(options)
    cache = new CacheService(options, connection, keyBuilder)
  })

  afterEach(async () => {
    await connection.onModuleDestroy()
  })

  describe('get / set / getRaw / setRaw', () => {
    // A JSON object must survive a set→get round trip — the core typed-cache
    // contract (serialize on write, deserialize on read).
    it('round-trips a JSON object', async () => {
      await cache.set('users', 'u_1', { name: 'Alice' })

      expect(await cache.get<{ name: string }>('users', 'u_1')).toEqual({ name: 'Alice' })
    })

    // A missing key must read back as null (not throw, not undefined) so callers
    // can branch on absence.
    it('returns null for a missing key', async () => {
      expect(await cache.get('users', 'missing')).toBeNull()
    })

    // A TTL passed to set must apply an EXPIRE, observable through ttl() — guards
    // the `ttlSeconds !== undefined` branch of set.
    it('applies a TTL when provided', async () => {
      await cache.set('users', 'u_2', 'x', 60)

      const ttl = await cache.ttl('users', 'u_2')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    })

    // getRaw/setRaw must bypass the serializer entirely, storing and returning
    // the exact string — used for values written by other systems.
    it('reads and writes raw strings without serialization', async () => {
      await cache.setRaw('raw', 'r1', 'plain-string')

      expect(await cache.getRaw('raw', 'r1')).toBe('plain-string')
    })

    // A raw write with a TTL must also expire — the `ttlSeconds !== undefined`
    // branch of setRaw.
    it('applies a TTL on a raw write', async () => {
      await cache.setRaw('raw', 'r2', 'v', 45)

      const ttl = await cache.ttl('raw', 'r2')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(45)
    })
  })

  describe('setNx', () => {
    // The first NX write must succeed and report true (result === 'OK'). The
    // ttl assertion pins the NO-TTL path: it must leave the key persistent
    // (ttl -1), which distinguishes the plain `NX` call from the always-`EX`
    // ternary mutant (`set(key, raw, 'EX', undefined, 'NX')` never creates it).
    it('returns true on the first write without applying a TTL', async () => {
      expect(await cache.setNx('p', 'k', 'v')).toBe(true)
      expect(await cache.ttl('p', 'k')).toBe(-1)
    })

    // A second NX write on the same key must be refused and report false
    // (result === null) — proves the atomic guard.
    it('returns false on a subsequent write', async () => {
      await cache.setNx('p', 'k', 'v')

      expect(await cache.setNx('p', 'k', 'v2')).toBe(false)
    })

    // NX with a TTL must store atomically and apply the expiry — the
    // `ttlSeconds !== undefined` branch of setNx.
    it('applies a TTL atomically on the first write', async () => {
      expect(await cache.setNx('p', 'k2', 'v', 30)).toBe(true)

      const ttl = await cache.ttl('p', 'k2')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(30)
    })
  })

  describe('del / delMany / exists', () => {
    // del must report the number of removed keys (1 for a present key).
    it('del returns the removed count', async () => {
      await cache.set('d', '1', 'x')

      expect(await cache.del('d', '1')).toBe(1)
    })

    // delMany must namespace every id and report the total removed.
    it('delMany removes many keys and returns the count', async () => {
      await cache.set('d', 'a', 'x')
      await cache.set('d', 'b', 'y')

      expect(await cache.delMany('d', ['a', 'b'])).toBe(2)
    })

    // An empty id list must short-circuit to 0 WITHOUT touching Redis — the
    // empty-guard branch (also avoids a `del()` with no keys).
    it('delMany returns 0 for an empty list without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      expect(await cache.delMany('d', [])).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })

    // exists must convert the integer count to a boolean for both present and
    // absent keys (count > 0).
    it('exists reports presence as a boolean', async () => {
      await cache.set('e', '1', 'x')

      expect(await cache.exists('e', '1')).toBe(true)
      expect(await cache.exists('e', 'missing')).toBe(false)
    })
  })

  describe('numeric', () => {
    // The default step (by === 1) must route through INCR (not INCRBY) and
    // accumulate. The incr-vs-incrby spy pins the routing so the `by === 1`
    // ternary cannot collapse to an always-INCRBY mutant — INCRBY(key, 1) and
    // INCR(key) are value-equivalent, so only the call target distinguishes them.
    it('incr by 1 routes through INCR', async () => {
      const client = connection.getClient() as Redis
      const incrSpy = jest.spyOn(client, 'incr')
      const incrbySpy = jest.spyOn(client, 'incrby')

      expect(await cache.incr('c', 'k')).toBe(1)
      expect(await cache.incr('c', 'k')).toBe(2)
      expect(incrSpy).toHaveBeenCalledWith('test:c:k')
      expect(incrbySpy).not.toHaveBeenCalled()
    })

    // A custom step (by !== 1) must route through INCRBY — kills the always-INCR
    // and the `>=` / `!==` operator mutants on `by === 1`.
    it('incr by a custom step routes through INCRBY', async () => {
      const client = connection.getClient() as Redis
      const incrSpy = jest.spyOn(client, 'incr')
      const incrbySpy = jest.spyOn(client, 'incrby')

      expect(await cache.incr('c', 'k2', 5)).toBe(5)
      expect(incrbySpy).toHaveBeenCalledWith('test:c:k2', 5)
      expect(incrSpy).not.toHaveBeenCalled()
    })

    // A zero step (by < 1) must also route through INCRBY — the sole input where
    // `by === 1` and the `by <= 1` mutant diverge (0 <= 1 would wrongly hit INCR).
    it('incr by a zero step routes through INCRBY', async () => {
      const client = connection.getClient() as Redis
      const incrSpy = jest.spyOn(client, 'incr')
      const incrbySpy = jest.spyOn(client, 'incrby')

      expect(await cache.incr('c', 'z', 0)).toBe(0)
      expect(incrbySpy).toHaveBeenCalledWith('test:c:z', 0)
      expect(incrSpy).not.toHaveBeenCalled()
    })

    // The default step (by === 1) must route through DECR (not DECRBY).
    it('decr by 1 routes through DECR', async () => {
      const client = connection.getClient() as Redis
      const decrSpy = jest.spyOn(client, 'decr')
      const decrbySpy = jest.spyOn(client, 'decrby')
      await cache.incr('c', 'd1', 5)

      expect(await cache.decr('c', 'd1')).toBe(4)
      expect(decrSpy).toHaveBeenCalledWith('test:c:d1')
      expect(decrbySpy).not.toHaveBeenCalled()
    })

    // A custom step (by !== 1) must route through DECRBY.
    it('decr by a custom step routes through DECRBY', async () => {
      const client = connection.getClient() as Redis
      const decrSpy = jest.spyOn(client, 'decr')
      const decrbySpy = jest.spyOn(client, 'decrby')
      await cache.incr('c', 'd2', 10)

      expect(await cache.decr('c', 'd2', 3)).toBe(7)
      expect(decrbySpy).toHaveBeenCalledWith('test:c:d2', 3)
      expect(decrSpy).not.toHaveBeenCalled()
    })

    // A zero step (by < 1) must also route through DECRBY — kills the `by <= 1`
    // mutant on decr (0 <= 1 would wrongly hit DECR and drop the value by 1).
    it('decr by a zero step routes through DECRBY', async () => {
      const client = connection.getClient() as Redis
      const decrSpy = jest.spyOn(client, 'decr')
      const decrbySpy = jest.spyOn(client, 'decrby')

      expect(await cache.decr('c', 'zd', 0)).toBe(0)
      expect(decrbySpy).toHaveBeenCalledWith('test:c:zd', 0)
      expect(decrSpy).not.toHaveBeenCalled()
    })
  })

  describe('expiration', () => {
    // expire must return true when the key exists and false when it does not
    // (result === 1) — both sides of the boolean conversion.
    it('expire reports success as a boolean', async () => {
      await cache.set('x', '1', 'v')

      expect(await cache.expire('x', '1', 30)).toBe(true)
      expect(await cache.expire('x', 'missing', 30)).toBe(false)
    })

    // ttl must return the Redis sentinels: -2 for a missing key, -1 for a key
    // with no expiration.
    it('ttl returns -2 for missing and -1 for no expiration', async () => {
      expect(await cache.ttl('x', 'missing')).toBe(-2)

      await cache.set('x', '2', 'v')
      expect(await cache.ttl('x', '2')).toBe(-1)
    })

    // persist must remove an existing TTL (returns true) and report false when
    // there is no TTL to remove (missing key) — both sides of `result === 1`.
    it('persist reports removal as a boolean', async () => {
      await cache.set('x', '3', 'v', 60)

      expect(await cache.persist('x', '3')).toBe(true)
      expect(await cache.ttl('x', '3')).toBe(-1)
      expect(await cache.persist('x', 'missing')).toBe(false)
    })
  })

  describe('batch (mget / mset)', () => {
    // mset must namespace and write every pair; mget must deserialize present
    // values and yield null positionally for the missing one. The deserialize
    // spy pins the null short-circuit: it runs for the two present values only,
    // never for the missing (null) entry — kills the ConditionalExpression
    // mutant that drops the `value === null` guard (deserialize would run 3×).
    it('mset writes pairs and mget reads them with nulls for misses', async () => {
      const custom = makeSerializer()
      const deserializeSpy = jest.spyOn(custom, 'deserialize')
      const spied = new CacheService(
        applyDefaults({ connection: { host: 'h' }, namespace: 'test', serializer: custom }),
        connection,
        keyBuilder
      )

      await spied.mset('p', [
        ['a', 1],
        ['b', 2]
      ])

      expect(await spied.mget<number>('p', ['a', 'b', 'missing'])).toEqual([1, 2, null])
      expect(deserializeSpy).toHaveBeenCalledTimes(2)
    })

    // An empty id list must return [] WITHOUT calling Redis — the mget empty guard.
    it('mget returns [] for an empty list without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      expect(await cache.mget('p', [])).toEqual([])
      expect(spy).not.toHaveBeenCalled()
    })

    // An empty entry list must no-op WITHOUT calling Redis — the mset empty guard.
    it('mset is a no-op for an empty list without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      await expect(cache.mset('p', [])).resolves.toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('hash', () => {
    // hset/hget must round-trip a value through the serializer; field names stay
    // raw. hset on a new field returns 1.
    it('hset/hget round-trips a value via the serializer', async () => {
      expect(await cache.hset('h', 'h1', 'name', 'Alice')).toBe(1)

      expect(await cache.hget<string>('h', 'h1', 'name')).toBe('Alice')
    })

    // A missing hash field must read back as null — the hget null branch.
    it('hget returns null for a missing field', async () => {
      expect(await cache.hget('h', 'h1', 'missing')).toBeNull()
    })

    // hgetall must deserialize every field value into a record.
    it('hgetall returns every field deserialized', async () => {
      await cache.hset('h', 'h2', 'a', 1)
      await cache.hset('h', 'h2', 'b', 'x')

      expect(await cache.hgetall<unknown>('h', 'h2')).toEqual({ a: 1, b: 'x' })
    })

    // A missing hash must yield {} (the loop body never runs) — the empty branch.
    it('hgetall returns {} for a missing hash', async () => {
      expect(await cache.hgetall('h', 'none')).toEqual({})
    })

    // hdel must remove the named fields and report the count removed.
    it('hdel removes fields and returns the count', async () => {
      await cache.hset('h', 'h3', 'f1', 1)
      await cache.hset('h', 'h3', 'f2', 2)

      expect(await cache.hdel('h', 'h3', 'f1', 'f2')).toBe(2)
    })

    // No fields must short-circuit to 0 WITHOUT calling Redis — the empty guard
    // (also avoids an `hdel` with no fields).
    it('hdel returns 0 for no fields without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      expect(await cache.hdel('h', 'h3')).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('set', () => {
    // sadd/scard/sismember happy path: members are stored raw, cardinality and
    // membership reflect them (sismember converts 0|1 to boolean both ways).
    it('sadd/scard/sismember operate on raw members', async () => {
      expect(await cache.sadd('s', 's1', 'x', 'y', 'z')).toBe(3)

      expect(await cache.scard('s', 's1')).toBe(3)
      expect(await cache.sismember('s', 's1', 'x')).toBe(true)
      expect(await cache.sismember('s', 's1', 'missing')).toBe(false)
    })

    // No members must short-circuit sadd to 0 WITHOUT calling Redis.
    it('sadd returns 0 for no members without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      expect(await cache.sadd('s', 's1')).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })

    // srem must remove the named members and report the count.
    it('srem removes members and returns the count', async () => {
      await cache.sadd('s', 's2', 'x', 'y')

      expect(await cache.srem('s', 's2', 'x')).toBe(1)
    })

    // No members must short-circuit srem to 0 WITHOUT calling Redis.
    it('srem returns 0 for no members without calling Redis', async () => {
      const spy = jest.spyOn(connection, 'getClient')

      expect(await cache.srem('s', 's2')).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })

    // smembers must return the raw members of a set.
    it('smembers returns the raw members', async () => {
      await cache.sadd('s', 's3', 'a', 'b')

      expect(await cache.smembers('s', 's3')).toEqual(expect.arrayContaining(['a', 'b']))
    })

    // scard must return 0 for a set that does not exist.
    it('scard returns 0 for a missing set', async () => {
      expect(await cache.scard('s', 'none')).toBe(0)
    })
  })

  describe('iteration (keys / scan)', () => {
    // keys must return the fully-namespaced keys matching the pattern.
    it('keys returns matching namespaced keys', async () => {
      await cache.set('users', 'u_1', 'a')
      await cache.set('users', 'u_2', 'b')

      const found = await cache.keys('users', '*')
      expect(found).toEqual(expect.arrayContaining(['test:users:u_1', 'test:users:u_2']))
      expect(found).toHaveLength(2)
    })

    // scan must yield the same matching keys via async iteration, using the
    // default count when none is given (covers the default-parameter branch).
    it('scan yields matching keys via async iteration with the default count', async () => {
      await cache.set('users', 'u_1', 'a')
      await cache.set('users', 'u_2', 'b')
      const scanSpy = jest.spyOn(connection.getClient() as Redis, 'scanStream')

      const collected: string[] = []
      for await (const key of cache.scan('users', '*')) {
        collected.push(key)
      }

      expect(collected).toEqual(expect.arrayContaining(['test:users:u_1', 'test:users:u_2']))
      expect(scanSpy).toHaveBeenCalledWith({ match: 'test:users:*', count: 100 })
    })

    // An explicit count must be forwarded to scanStream — covers the override
    // side of the default parameter.
    it('scan forwards an explicit count to scanStream', async () => {
      await cache.set('users', 'u_1', 'a')
      const scanSpy = jest.spyOn(connection.getClient() as Redis, 'scanStream')

      for await (const _key of cache.scan('users', '*', 7)) {
        // drain the iterator
      }

      expect(scanSpy).toHaveBeenCalledWith({ match: 'test:users:*', count: 7 })
    })

    // Cluster mode exposes no scanStream; scan must throw a structured
    // CacheException (UNSUPPORTED_IN_CLUSTER) rather than a raw Error or silently
    // returning nothing. Shadowing the method with undefined simulates Cluster.
    // The details assertion pins `{ operation: 'scan' }` so the ObjectLiteral→{}
    // and StringLiteral 'scan'→'' mutants on the throw site (cache.service L525) die.
    it('scan throws UNSUPPORTED_IN_CLUSTER when scanStream is unavailable (cluster mode)', async () => {
      // Simulate Cluster mode by shadowing the prototype scanStream with undefined.
      Object.defineProperty(connection.getClient(), 'scanStream', {
        value: undefined,
        configurable: true
      })

      const drain = async (): Promise<void> => {
        for await (const _key of cache.scan('p', '*')) {
          // unreachable — generator throws before yielding
        }
      }
      await expect(drain()).rejects.toBeInstanceOf(CacheException)
      await drain().catch((error: unknown) => {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
        expect((error as CacheException).details).toEqual({ operation: 'scan' })
      })
    })
  })

  describe('pipeline / getClient', () => {
    // pipeline must return a chainable commander whose queued commands execute
    // on exec().
    it('pipeline returns a working chainable commander', async () => {
      const pipe = cache.pipeline()
      pipe.set(keyBuilder.build('p', 'a'), '1')
      pipe.set(keyBuilder.build('p', 'b'), '2')

      const results = await pipe.exec()
      expect(results).toHaveLength(2)
      expect(await cache.getRaw('p', 'a')).toBe('1')
    })

    // getClient must return the very same singleton the connection manager owns
    // (the documented, non-namespaced escape hatch).
    it('getClient returns the singleton ioredis client', () => {
      expect(cache.getClient()).toBe(connection.getClient())
    })
  })

  describe('flushNamespace', () => {
    // The happy path deletes every key under the namespace via SCAN+UNLINK and
    // reports the count; afterwards the keys are gone.
    it('removes all keys under the namespace and returns the count', async () => {
      await cache.set('a', '1', 'x')
      await cache.set('b', '1', 'y')

      expect(await cache.flushNamespace()).toBeGreaterThanOrEqual(2)
      expect(await cache.get('a', '1')).toBeNull()
    })

    // Real SCAN batches can be empty mid-iteration; the loop must UNLINK only
    // non-empty chunks. A controlled stream of [populated, empty] proves the
    // empty chunk is skipped (UNLINK called exactly once).
    it('unlinks populated scan chunks and skips empty ones', async () => {
      const client = connection.getClient() as Redis
      const stream = Readable.from([['test:a', 'test:b'], []])
      // The stubbed cursor yields one populated chunk then an empty one; cast to
      // scanStream's ScanStream return so the spy types precisely (no `as never`).
      const scanStreamSpy = jest
        .spyOn(client, 'scanStream')
        .mockReturnValue(stream as ReturnType<Redis['scanStream']>)
      const unlinkSpy = jest.spyOn(client, 'unlink').mockResolvedValue(2)

      expect(await cache.flushNamespace()).toBe(2)
      // Pin the namespace-scoped match pattern and the FLUSH_SCAN_COUNT hint so
      // mutants on either constant (e.g. 1000 → 0, or a broadened pattern) die.
      expect(scanStreamSpy).toHaveBeenCalledWith({ match: 'test:*', count: 1000 })
      expect(unlinkSpy).toHaveBeenCalledTimes(1)
      expect(unlinkSpy).toHaveBeenCalledWith('test:a', 'test:b')
    })

    // The production guard must block the destructive flush by default — both
    // sides of `NODE_ENV === 'production' && !allowFlushInProduction` true.
    it('throws FLUSH_DISABLED_IN_PRODUCTION in production without the flag', async () => {
      jest.replaceProperty(process.env, 'NODE_ENV', 'production')

      await expect(cache.flushNamespace()).rejects.toThrow(CacheException)
      await cache.flushNamespace().catch((error: unknown) => {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION)
      })
    })

    // With the explicit opt-in flag, the flush must run even in production — the
    // right-hand `!allowFlushInProduction === false` branch of the guard.
    it('runs in production when allowFlushInProduction is true', async () => {
      jest.replaceProperty(process.env, 'NODE_ENV', 'production')
      const allowed = new CacheService(
        applyDefaults({
          connection: { host: 'h' },
          namespace: 'test',
          allowFlushInProduction: true
        }),
        connection,
        keyBuilder
      )
      await cache.set('a', '1', 'x')

      await expect(allowed.flushNamespace()).resolves.toBeGreaterThanOrEqual(1)
    })

    // Outside production the guard is skipped entirely — the left-hand
    // `NODE_ENV === 'production' === false` branch.
    it('runs in development without the flag', async () => {
      jest.replaceProperty(process.env, 'NODE_ENV', 'development')

      await expect(cache.flushNamespace()).resolves.toBe(0)
    })

    // Cluster mode exposes no scanStream; flush must throw a structured
    // CacheException (UNSUPPORTED_IN_CLUSTER) rather than a raw Error or no-op.
    // The details assertion pins `{ operation: 'flushNamespace' }` so the
    // ObjectLiteral→{} and StringLiteral 'flushNamespace'→'' mutants on the throw
    // site (cache.service L595/596) die.
    it('throws UNSUPPORTED_IN_CLUSTER when scanStream is unavailable (cluster mode)', async () => {
      jest.replaceProperty(process.env, 'NODE_ENV', 'development')
      // Simulate Cluster mode by shadowing the prototype scanStream with undefined.
      Object.defineProperty(connection.getClient(), 'scanStream', {
        value: undefined,
        configurable: true
      })

      await expect(cache.flushNamespace()).rejects.toBeInstanceOf(CacheException)
      await cache.flushNamespace().catch((error: unknown) => {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.UNSUPPORTED_IN_CLUSTER)
        expect((error as CacheException).details).toEqual({ operation: 'flushNamespace' })
      })
    })
  })

  describe('serializer selection', () => {
    // An explicit `options.serializer` must take priority over the default JSON
    // serializer — the first link of the `?? ?? ` priority chain.
    it('uses options.serializer when provided', async () => {
      const custom = makeSerializer()
      const serializeSpy = jest.spyOn(custom, 'serialize')
      const customCache = new CacheService(
        applyDefaults({ connection: { host: 'h' }, namespace: 'test', serializer: custom }),
        connection,
        keyBuilder
      )

      await customCache.set('p', 'k', { v: 1 })

      expect(serializeSpy).toHaveBeenCalledWith({ v: 1 })
    })

    // When no option is set, the injected BYMAX_CACHE_SERIALIZER token must be
    // used — the second link of the priority chain.
    it('uses the injected serializer when no option is set', async () => {
      const custom = makeSerializer()
      const serializeSpy = jest.spyOn(custom, 'serialize')
      const injectedCache = new CacheService(
        applyDefaults({ connection: { host: 'h' }, namespace: 'test' }),
        connection,
        keyBuilder,
        custom
      )

      await injectedCache.set('p', 'k2', { v: 2 })

      expect(serializeSpy).toHaveBeenCalledWith({ v: 2 })
    })
  })

  describe('eval', () => {
    // Without a wired ScriptManagerService, eval must fail closed rather than
    // silently no-op — guards a manual instantiation that omitted the registry.
    it('throws SCRIPT_REGISTRY_MISSING when no script manager is wired', async () => {
      await expect(cache.eval('cas', ['k'], [])).rejects.toBeInstanceOf(CacheException)
      await cache.eval('cas', ['k'], []).catch((error: unknown) => {
        expect((error as CacheException).code).toBe(CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING)
      })
    })

    // With a script manager, keys are namespaced before delegation while args
    // and the return value pass through untouched.
    it('namespaces keys and delegates to the script manager', async () => {
      const evalMock = jest.fn().mockResolvedValue('lua-result')
      const cacheWithScripts = new CacheService(
        applyDefaults({ connection: { host: 'h' }, namespace: 'test' }),
        connection,
        keyBuilder,
        undefined,
        { eval: evalMock } as unknown as ScriptManagerService
      )

      const result = await cacheWithScripts.eval('cas', ['k1', 'k2'], [1, 'a'])

      expect(evalMock).toHaveBeenCalledWith('cas', ['test:k1', 'test:k2'], [1, 'a'])
      expect(result).toBe('lua-result')
    })
  })

  describe('health', () => {
    // isHealthy resolves true when the server answers PONG.
    it('reports healthy when Redis answers PONG', async () => {
      expect(await cache.isHealthy()).toBe(true)
    })

    // A non-PONG reply must read as unhealthy — the `pong === 'PONG'` false side.
    it('reports unhealthy on a non-PONG reply', async () => {
      jest.spyOn(connection.getClient(), 'ping').mockResolvedValue('LATER')

      expect(await cache.isHealthy()).toBe(false)
    })

    // A ping failure must be swallowed and read as unhealthy, never propagated.
    it('reports unhealthy (never throws) when ping fails', async () => {
      jest.spyOn(connection.getClient(), 'ping').mockRejectedValue(new Error('connection down'))

      expect(await cache.isHealthy()).toBe(false)
    })

    // ping surfaces the raw PONG on a healthy connection.
    it('ping returns PONG', async () => {
      expect(await cache.ping()).toBe('PONG')
    })

    // info() with no section must call INFO with NO arguments (not `info(undefined)`)
    // and return the full report — the zero-arg assertion kills the force-false
    // ternary mutant that would always take the `client.info(section)` branch.
    it('info returns the full report when no section is given', async () => {
      const infoSpy = jest.spyOn(connection.getClient(), 'info')

      const result = await cache.info()

      expect(infoSpy).toHaveBeenCalledWith()
      expect(result).toContain('redis_version')
    })

    // info(section) forwards the section to the INFO command (the section branch).
    it('info forwards a requested section', async () => {
      const infoSpy = jest.spyOn(connection.getClient(), 'info')

      const result = await cache.info('memory')

      expect(infoSpy).toHaveBeenCalledWith('memory')
      expect(typeof result).toBe('string')
    })
  })
})
