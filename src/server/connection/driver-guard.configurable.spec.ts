/**
 * The guard on `Object.prototype` against a standard property that became non-configurable after the library
 * was imported.
 *
 * Layer: server. The change is one way: a property made non-configurable cannot be put back, so this spec
 * holds one case and nothing after it. Jest gives each spec file its own realm, so the property it freezes
 * never reaches another file. The value, the accessors and the flags other than `configurable` stay what
 * they were when the library loaded, so only the comparison of that flag can see the change.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { assertDriverUnshadowed } from './driver-option-names'

type Thrown = { code?: string; details?: { count?: number } }

/** The error the guard throws now, or undefined. */
function guardThrows(): Thrown | undefined {
  try {
    assertDriverUnshadowed()
  } catch (error) {
    return error as Thrown
  }
  return undefined
}

describe('assertDriverUnshadowed — a standard property made non-configurable', () => {
  it('is counted as overwritten, and only that one', () => {
    // Arrange: a clean realm answers with no refusal
    expect(guardThrows()).toBeUndefined()

    // Act: `toString` keeps its value, its writability and its enumerability, and loses `configurable`
    Object.defineProperty(Object.prototype, 'toString', { configurable: false })

    // Assert
    const thrown = guardThrows()
    expect(thrown?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(thrown?.details?.count).toBe(1)
  })
})
