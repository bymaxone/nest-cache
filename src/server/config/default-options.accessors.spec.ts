/**
 * The credential accessors that `applyDefaults` puts on the resolved options.
 *
 * Layer: server. The three connection shapes carry the Redis credentials, and `applyDefaults` attaches them as
 * non-enumerable, non-configurable accessors and then freezes the object. Freezing alone makes every property
 * non-configurable, so these cases take the freeze away and assert the accessors themselves.
 */
import { applyDefaults } from './default-options'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

const KEYS = ['connection', 'sentinel', 'cluster'] as const

describe('applyDefaults — the credential accessors', () => {
  it('are non-enumerable and non-configurable even when Object.freeze does nothing', () => {
    // Arrange: a freeze that returns its argument, so only the accessors' own flags remain
    jest.spyOn(Object, 'freeze').mockImplementation((value) => value as never)

    // Act
    const resolved = applyDefaults({ connection: { host: 'h' } } as BymaxCacheModuleOptions)

    // Assert
    for (const key of KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(resolved, key)
      expect(descriptor?.enumerable).toBe(false)
      expect(descriptor?.configurable).toBe(false)
    }
  })
})
