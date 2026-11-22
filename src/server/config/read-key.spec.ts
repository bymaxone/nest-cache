/**
 * Reading a key only where the host put it, and copying a tree so that it has no prototypes.
 *
 * Layer: server. `readKey` skips a value found only on the realm's root prototype and reads a key an
 * object, a class, a prototype between them, a proxy or an object of another realm holds. `bare` copies
 * the plain objects of a tree without a prototype and keeps everything else as it is.
 */
import { runInNewContext } from 'node:vm'

import { bare, readHooks, readKey } from './read-key'

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

  // Scenario: the root of another realm carries a planted key, and a root has its `constructor` overwritten.
  // Rule: a root is recognised by its shape (no prototype, reached through the object), never by a property
  // it holds, so neither a root of another realm nor an overwritten constructor makes a planted key count.
  it('does not read a key planted on the root of another realm', () => {
    const other = runInNewContext('Object.prototype.planted = "X"; ({ a: "own" })') as object

    expect(readKey(other, 'planted')).toBeUndefined()
    expect(readKey(other, 'a')).toBe('own')
  })

  it('is not fooled by a constructor overwritten on a root, here or in another realm', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'constructor'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'constructor', {
      value: {},
      configurable: true,
      writable: true
    })
    try {
      planted('plantedKey', 'x', () => {
        expect(readKey({}, 'plantedKey')).toBeUndefined()
        expect(readKey({ a: 1 }, 'a')).toBe(1)
      })
    } finally {
      Object.defineProperty(Object.prototype, 'constructor', original)
    }
    const other = runInNewContext(
      'Object.prototype.constructor = null; Object.prototype.planted = "X"; ({ a: 2 })'
    ) as object

    expect(readKey(other, 'planted')).toBeUndefined()
    expect(readKey(other, 'a')).toBe(2)
  })

  it('reads a key an object without a prototype holds itself, and not one only a prototype-less holder above holds', () => {
    const bare = Object.assign(Object.create(null) as object, { k: 1 })

    expect(readKey(bare, 'k')).toBe(1)
    expect(readKey(Object.create(bare) as object, 'k')).toBeUndefined()
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

describe('readHooks', () => {
  it('binds a hook to the host object so that a hook that uses this keeps working', () => {
    class Events {
      seen: string[] = []
      onEvent(event: string): void {
        this.seen.push(event)
      }
    }
    const events = new Events()
    const hooks = readHooks(events) as { onEvent: (event: string) => void }

    hooks.onEvent('ready')

    expect(events.seen).toEqual(['ready'])
    expect(Object.getPrototypeOf(hooks)).toBeNull()
  })

  it('holds only the hooks the host put, never one planted on Object.prototype', () => {
    const spy = jest.fn()
    const hooks = planted('onQueue', spy, () => readHooks({ onEvent: () => undefined })) as object

    expect(Object.keys(hooks)).toEqual(['onEvent'])
  })

  it('keeps a value that is not a function as it is, and one that is not an object', () => {
    expect((readHooks({ onEvent: 'text' }) as Record<string, unknown>)['onEvent']).toBe('text')
    expect(readHooks(undefined)).toBeUndefined()
    expect(readHooks(null)).toBeNull()
    expect(readHooks('events')).toBe('events')
  })
})
