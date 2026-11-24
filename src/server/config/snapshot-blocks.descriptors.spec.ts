/**
 * A copied list can be edited like an array literal: an entry can be assigned and removed.
 *
 * Layer: server. The copy is made with `Object.defineProperty`; what it creates must not be narrower than
 * what an assignment would have made.
 */
import { snapshotBlocks } from './snapshot-blocks'

describe('snapshotBlocks, the entries of a copied list', () => {
  // Scenario: a caller edits the copy it was handed.
  // Rule: an entry can be assigned, and removed, without a TypeError.
  it('can be assigned and deleted', () => {
    const copied = snapshotBlocks({
      connection: { host: 'h', tls: { ca: ['a', 'b'] } }
    } as never) as unknown as { connection: { tls: { ca: unknown[] } } }
    const list = copied.connection.tls.ca

    list[0] = 'z'
    const removed = Reflect.deleteProperty(list, 1)

    expect(list[0]).toBe('z')
    expect(removed).toBe(true)
  })
})
