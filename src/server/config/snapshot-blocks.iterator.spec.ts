/**
 * The copy of a list of key material does not run an iterator planted on `Object.prototype`.
 *
 * Layer: server. `Array.from({ length }, fn)` reads `Symbol.iterator` off its first argument, an ordinary
 * object, so a generator planted under that symbol decides how many entries of `tls.ca`, `cert` and `key`
 * survive. The copy is built with an index.
 */
import { snapshotBlocks } from './snapshot-blocks'

describe('snapshotBlocks, with an iterator planted on Object.prototype', () => {
  // Scenario: a generator that yields one value is planted under Symbol.iterator, and the host wrote a
  // `tls.ca` of three entries.
  // Rule: the copy keeps all three, whatever the plant.
  it('keeps every entry of a list of three', () => {
    Object.defineProperty(Object.prototype, Symbol.iterator, {
      value: function* (): Generator<number> {
        yield 1
      },
      configurable: true,
      writable: true
    })
    try {
      const copied = snapshotBlocks({
        connection: { host: 'h', tls: { ca: ['a', 'b', 'c'] } }
      } as never) as unknown as { connection: { tls: { ca: unknown[] } } }

      expect(copied.connection.tls.ca).toEqual(['a', 'b', 'c'])
    } finally {
      Reflect.deleteProperty(Object.prototype, Symbol.iterator)
    }
  })
})

describe('snapshotBlocks, with a setter planted on Array.prototype', () => {
  // Scenario: an accessor with a setter that stores nothing is planted under the index 0 of every array.
  // Rule: the copy creates each entry as a data property of its own, so the setter never runs and every
  // entry is kept.
  it('keeps every entry of a list of three as an own property', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, '0')
    Object.defineProperty(Array.prototype, '0', {
      configurable: true,
      set(): void {
        // stores nothing
      }
    })
    try {
      const copied = snapshotBlocks({
        connection: { host: 'h', tls: { ca: ['a', 'b', 'c'] } }
      } as never) as unknown as { connection: { tls: { ca: unknown[] } } }

      expect(Object.hasOwn(copied.connection.tls.ca, '0')).toBe(true)
      expect(copied.connection.tls.ca.length).toBe(3)
    } finally {
      Reflect.deleteProperty(Array.prototype, '0')
      if (original !== undefined) Object.defineProperty(Array.prototype, '0', original)
    }
  })
})
