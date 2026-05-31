/**
 * Unit tests for {@link resolveSerializer}.
 *
 * Layer: server. Pins the serializer priority order (explicit option → injected
 * token → default JSON) that every serializer-aware service relies on.
 */
import { applyDefaults } from '../config/default-options'
import { JsonSerializer } from './json-serializer'
import { resolveSerializer } from './resolve-serializer'

import type { ISerializer } from '../interfaces/serializer.interface'

/** A distinct, identity-comparable serializer used to prove which one wins. */
const makeSerializer = (): ISerializer => ({
  serialize<T>(value: T): string {
    return JSON.stringify(value)
  },
  deserialize<T>(raw: string): T {
    return JSON.parse(raw) as T
  }
})

describe('resolveSerializer', () => {
  // An explicit options.serializer must win over the injected token and default.
  it('returns options.serializer when set', () => {
    const explicit = makeSerializer()

    const resolved = resolveSerializer(
      applyDefaults({ connection: { host: 'h' }, serializer: explicit }),
      makeSerializer()
    )

    expect(resolved).toBe(explicit)
  })

  // With no option, the injected BYMAX_CACHE_SERIALIZER provider must be used.
  it('returns the injected serializer when no option is set', () => {
    const injected = makeSerializer()

    const resolved = resolveSerializer(applyDefaults({ connection: { host: 'h' } }), injected)

    expect(resolved).toBe(injected)
  })

  // With neither an option nor an injected provider, a fresh JsonSerializer is used.
  it('falls back to a JsonSerializer when neither is provided', () => {
    const resolved = resolveSerializer(applyDefaults({ connection: { host: 'h' } }))

    expect(resolved).toBeInstanceOf(JsonSerializer)
  })
})
