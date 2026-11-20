/**
 * Unit tests pinning the method list of {@link CacheService}.
 *
 * Layer: server. The hash and set commands live in a base class so the facade stays under the
 * file-length limit; the class a consumer injects must still answer to every method it always did,
 * under the same name. A method dropped, renamed or left behind in the split fails here.
 */
import { CacheService } from './cache.service'

/** Every method name on the prototype chain of `type`, up to but excluding `Object`. */
function methodsOf(type: new (...args: never[]) => unknown): string[] {
  const names = new Set<string>()
  for (
    let proto: object | null = type.prototype as object;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== 'constructor') names.add(name)
    }
  }
  return [...names].sort()
}

describe('CacheService method list', () => {
  const PUBLIC = [
    'decr',
    'del',
    'delMany',
    'eval',
    'exists',
    'expire',
    'flushNamespace',
    'get',
    'getClient',
    'getRaw',
    'hdel',
    'hget',
    'hgetall',
    'hset',
    'incr',
    'info',
    'isHealthy',
    'keys',
    'mget',
    'mset',
    'persist',
    'ping',
    'pipeline',
    'sadd',
    'scan',
    'scard',
    'set',
    'setNx',
    'setRaw',
    'sismember',
    'smembers',
    'srem',
    'ttl'
  ]

  // The names a consumer calls, and nothing else besides the internals below.
  it('answers to every public method it always did', () => {
    const internal = ['client', 'decode', 'scanKeys', 'track']

    expect(methodsOf(CacheService)).toEqual([...PUBLIC, ...internal].sort())
  })

  // The hash and set commands are inherited, not own, and still on the instance.
  it.each(['hget', 'hset', 'hgetall', 'hdel', 'sadd', 'srem', 'smembers', 'sismember', 'scard'])(
    'reaches %s through the instance',
    (name) => {
      expect(typeof Reflect.get(CacheService.prototype, name)).toBe('function')
    }
  )
})
