/**
 * Nth-operation sweep of {@link resolveOptions}.
 *
 * Layer: server. Every object the host hands in as options is wrapped in a proxy whose Nth trap
 * throws, N is raised until the call completes without reaching it, and every N must end in a
 * library error that carries the host's error as `cause` and none of its text in `details`.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { ConnectionManager } from '../connection/connection.manager'
import { CacheException } from '../errors/cache.exception'
import { resolveOptions } from './default-options'

/** The error the host's trap throws. */
const HOST = new Error('host-trap secret=hunter2')

/** The most traps any call may reach before the sweep calls it unbounded. */
const LIMIT = 500

/** One run's counter: how many traps were reached, and the kind of the one that threw. */
interface Run {
  ops: number
  trap: string
  stack: string
}

/**
 * Wraps an object and everything reachable from it so that the nth trap of any kind throws.
 *
 * @param root - The object to wrap.
 * @param nth - The 1-based number of the trap that throws.
 * @param run - The counter this wrapping shares.
 * @returns The wrapped object.
 */
function bomb<T extends object>(root: T, nth: number, run: Run): T {
  const hit = (name: string): void => {
    run.ops += 1
    if (run.ops === nth) {
      run.trap = name
      run.stack = new Error('trap').stack ?? ''
      throw HOST
    }
  }
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(t, p, r): unknown {
        hit(`get:${String(p)}`)
        const value: unknown = Reflect.get(t, p, r)
        return value !== null && typeof value === 'object' ? wrap(value) : value
      },
      has(t, p): boolean {
        hit(`has:${String(p)}`)
        return Reflect.has(t, p)
      },
      ownKeys(t): Array<string | symbol> {
        hit('ownKeys')
        return Reflect.ownKeys(t)
      },
      getOwnPropertyDescriptor(t, p): PropertyDescriptor | undefined {
        hit(`gopd:${String(p)}`)
        return Reflect.getOwnPropertyDescriptor(t, p)
      },
      getPrototypeOf(t): object | null {
        hit('getPrototypeOf')
        return Reflect.getPrototypeOf(t)
      }
    })
  return wrap(root) as T
}

/** A valid standalone option set that touches every group the library reads. */
const standalone = (): Record<string, unknown> => ({
  connection: { host: 'h', port: 6379, db: 0, keepAlive: 1000, connectTimeout: 5000 },
  namespace: 'test',
  keySeparator: ':',
  keyEscaping: 'strict',
  shutdownTimeoutMs: 5000,
  pubsubMaxConcurrentHandlers: 4,
  pubsubMaxQueuedMessages: 10,
  events: { onEvent: () => undefined }
})

/** A valid cluster option set. */
const cluster = (): Record<string, unknown> => ({
  mode: 'cluster',
  cluster: {
    nodes: [{ host: 'a', port: 7000 }],
    options: { redisOptions: { connectTimeout: 5000, commandTimeout: 5000 } }
  }
})

/** A valid sentinel option set. */
const sentinel = (): Record<string, unknown> => ({
  mode: 'sentinel',
  sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'master' }
})

/** What a call throws, or undefined. */
const captured = (call: () => unknown): unknown => {
  try {
    call()
  } catch (error) {
    return error
  }
  return undefined
}

describe('resolveOptions under a throwing host object', () => {
  it.each([
    ['standalone', standalone],
    ['cluster', cluster],
    ['sentinel', sentinel]
  ])(
    'ends every trap of a %s option set in a coded error carrying the host error',
    (_mode, make) => {
      let reached = 0
      for (let nth = 1; nth <= LIMIT; nth++) {
        const run: Run = { ops: 0, trap: '', stack: '' }
        let thrown: unknown
        try {
          resolveOptions(bomb(make(), nth, run) as never)
        } catch (error) {
          thrown = error
        }
        if (run.ops < nth) {
          expect(thrown).toBeUndefined()
          expect(reached).toBeGreaterThan(10)
          return
        }
        reached = nth
        expect({ nth, trap: run.trap, raw: thrown === HOST }).toEqual({
          nth,
          trap: run.trap,
          raw: false
        })
        expect(thrown).toBeInstanceOf(CacheException)
        const failure = thrown as CacheException
        expect(failure.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
        expect(failure.cause).toBe(HOST)
        expect(failure.details).toEqual({ reason: 'option could not be read' })
        expect(JSON.stringify(failure.details)).not.toContain('hunter2')
      }
      throw new Error(`the call still reached traps after ${LIMIT}`)
    }
  )

  // A refusal the library itself raises is not a read failure: it keeps its own code.
  it('keeps the code of a refusal the library raises for a value it could read', () => {
    expect(() => resolveOptions({ connection: { host: 'h' }, namespace: 'a*b' })).toThrow(
      expect.objectContaining({ code: CACHE_ERROR_CODES.INVALID_NAMESPACE })
    )
  })

  // Scenario: the host's getter throws a proxy whose prototype trap itself throws.
  // Rule: the thrown value is never inspected, so the trap does not run and the error is still coded.
  it('ends a thrown proxy with a throwing prototype trap as a coded error carrying it', () => {
    const thrown = new Proxy(new Error('proxied'), {
      getPrototypeOf(): never {
        throw new Error('prototype trap')
      }
    })
    const options = Object.defineProperty({ connection: { host: 'h' } }, 'namespace', {
      enumerable: true,
      get: (): never => {
        throw thrown
      }
    })

    const failure = captured(() => resolveOptions(options))

    expect(failure).toMatchObject({ code: CACHE_ERROR_CODES.INVALID_OPTIONS })
    expect((failure as CacheException).cause).toBe(thrown)
  })

  // Scenario: the host's getter throws a CacheException of its own.
  // Rule: it is the host's error, not a refusal of the library's, so it is wrapped with its cause.
  it('wraps a CacheException that the host throws instead of passing it through', () => {
    const hostException = new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'host text' })
    const options = Object.defineProperty({ connection: { host: 'h' } }, 'namespace', {
      enumerable: true,
      get: (): never => {
        throw hostException
      }
    })

    const failure = captured(() => resolveOptions(options))

    expect(failure).toMatchObject({
      code: CACHE_ERROR_CODES.INVALID_OPTIONS,
      details: { reason: 'option could not be read' }
    })
    expect((failure as CacheException).cause).toBe(hostException)
  })

  // Rule: the options are read once, so what is validated is what is applied.
  it('reads each top-level option once and applies what it validated', () => {
    const reads: string[] = []
    const values: Record<string, unknown> = { connection: { host: 'h' }, namespace: 'first' }
    const options = new Proxy(values, {
      get(t, p, r): unknown {
        reads.push(String(p))
        const value: unknown = Reflect.get(t, p, r)
        if (p === 'namespace') {
          t['namespace'] = 'second'
        }
        return value
      }
    })

    const resolved = resolveOptions(options as never)

    expect(resolved.namespace).toBe('first')
    expect(new Set(reads).size).toBe(reads.length)
  })
})

/** An option set the real driver accepts without opening a socket. */
const lazyStandalone = (): Record<string, unknown> => ({
  connection: { host: '127.0.0.1', port: 6399, lazyConnect: true, enableOfflineQueue: false },
  namespace: 'test'
})

/** A cluster option set the real driver accepts without opening a socket. */
const lazyCluster = (): Record<string, unknown> => ({
  mode: 'cluster',
  cluster: {
    nodes: [{ host: '127.0.0.1', port: 7000 }],
    options: { lazyConnect: true }
  }
})

/** A sentinel option set the real driver accepts without opening a socket. */
const lazySentinel = (): Record<string, unknown> => ({
  mode: 'sentinel',
  sentinel: { sentinels: [{ host: '127.0.0.1', port: 26379 }], name: 'master' },
  connection: { lazyConnect: true, enableOfflineQueue: false }
})

describe('registration under a throwing host object', () => {
  // The same sweep, carried through the connection manager: its constructor builds the driver's
  // options and its boot reads the timers and the lazy flag, all from the host's live blocks.
  it.each([
    ['standalone', lazyStandalone],
    ['cluster', lazyCluster],
    ['sentinel', lazySentinel]
  ])(
    'ends every trap of a %s option set that the library reads in a coded error, and lets only a trap the driver reaches through',
    async (_mode, make) => {
      for (let nth = 1; nth <= LIMIT; nth++) {
        const run: Run = { ops: 0, trap: '', stack: '' }
        let thrown: unknown
        let client: { disconnect: () => void } | undefined
        try {
          const manager = new ConnectionManager(resolveOptions(bomb(make(), nth, run) as never))
          await manager.onModuleInit()
          client = manager.getClient()
        } catch (error) {
          thrown = error
        } finally {
          client?.disconnect()
        }
        if (run.ops < nth) {
          expect(thrown).toBeUndefined()
          return
        }
        if (thrown === HOST) {
          // The one escape left is a trap the driver itself reached, in an object handed to it as it is.
          expect({
            nth,
            trap: run.trap,
            inDriver: run.stack.includes('/node_modules/ioredis/')
          }).toEqual({
            nth,
            trap: run.trap,
            inDriver: true
          })
          continue
        }
        expect(thrown).toBeInstanceOf(CacheException)
        expect((thrown as CacheException).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
        expect((thrown as CacheException).cause).toBe(HOST)
      }
      throw new Error(`the call still reached traps after ${LIMIT}`)
    }
  )
})
