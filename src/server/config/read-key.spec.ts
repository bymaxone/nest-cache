/**
 * Reading a key only where the host put it, and copying a tree so that it has no prototypes.
 *
 * Layer: server. `readKey` skips a value found only on the realm's root prototype and reads a key an
 * object, a class, a prototype between them, a proxy or an object of another realm holds. `bare` copies
 * the plain objects of a tree without a prototype and keeps everything else as it is.
 */
import { runInNewContext } from 'node:vm'

import { bare, readKey } from './read-key'

/** Plants `key` on `Object.prototype` for the length of `run`. */
function planted<T>(key: string, value: unknown, run: () => T): T {
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, key)
  }
}

describe('readKey', () => {
  it('reads an own key, a class getter and a key of a prototype between the object and the root', () => {
    class Holder {
      get a(): string {
        return 'class'
      }
    }
    const proto = { c: 'proto' }

    expect(readKey({ a: 'own' }, 'a')).toBe('own')
    expect(readKey(new Holder(), 'a')).toBe('class')
    expect(readKey(Object.create(proto) as object, 'c')).toBe('proto')
  })

  it('reads a key of an object from another realm', () => {
    expect(readKey(runInNewContext('({ a: "otherRealm" })') as object, 'a')).toBe('otherRealm')
  })

  it('does not read a key found only on the root prototype, or nowhere', () => {
    planted('plantedKey', 'x', () => {
      expect(readKey({}, 'plantedKey')).toBeUndefined()
      expect(readKey(Object.create({ other: 1 }) as object, 'plantedKey')).toBeUndefined()
      expect(readKey(new (class {})(), 'plantedKey')).toBeUndefined()
    })
    expect(readKey({}, 'absent')).toBeUndefined()
  })

  it('reads a key of a proxy as the proxy answers it', () => {
    const proxy = new Proxy({}, { get: (_t, name) => (name === 'a' ? 'fromTrap' : undefined) })

    expect(readKey(proxy, 'a')).toBe('fromTrap')
  })

  it('lets a getter of the host throw to the caller', () => {
    const throwing = {
      get a(): string {
        throw new Error('boom')
      }
    }

    expect(() => readKey(throwing, 'a')).toThrow('boom')
  })
})

describe('bare', () => {
  it('copies plain objects and lists without a prototype, all the way down', () => {
    const tree = bare({ a: { b: [{ c: 1 }] }, d: 'text' }) as Record<string, unknown>
    const a = tree['a'] as Record<string, unknown>
    const list = a['b'] as Array<Record<string, unknown>>

    expect(Object.getPrototypeOf(tree)).toBeNull()
    expect(Object.getPrototypeOf(a)).toBeNull()
    expect(Array.isArray(list)).toBe(true)
    expect(Object.getPrototypeOf(list[0])).toBeNull()
    expect(list[0]).toEqual(expect.objectContaining({ c: 1 }))
    expect(tree['d']).toBe('text')
  })

  it('keeps what is not a plain object of this realm as it is', () => {
    class Holder {}
    const instance = new Holder()
    const buffer = Buffer.from('x')
    const otherRealm = runInNewContext('({ a: 1 })') as object
    const fn = (): void => undefined
    const tree = bare({ instance, buffer, otherRealm, fn, nothing: null }) as Record<
      string,
      unknown
    >

    expect(tree['instance']).toBe(instance)
    expect(tree['buffer']).toBe(buffer)
    expect(tree['otherRealm']).toBe(otherRealm)
    expect(tree['fn']).toBe(fn)
    expect(tree['nothing']).toBeNull()
  })

  it('keeps an own __proto__ key as a plain key', () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}') as object
    const tree = bare(parsed) as Record<string, unknown>

    expect(Object.keys(tree)).toContain('__proto__')
    expect(tree['a']).toBe(2)
    expect(Object.getPrototypeOf(tree)).toBeNull()
  })

  it('does not change a value that is not an object', () => {
    expect(bare('text')).toBe('text')
    expect(bare(undefined)).toBeUndefined()
  })
})
