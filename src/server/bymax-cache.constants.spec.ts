import {
  BYMAX_CACHE_CONNECTION,
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_KEY_BUILDER,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SCRIPT_REGISTRY,
  BYMAX_CACHE_SERIALIZER
} from './bymax-cache.constants'

describe('cache injection tokens', () => {
  const tokens = [
    BYMAX_CACHE_OPTIONS,
    BYMAX_CACHE_CONNECTION,
    BYMAX_CACHE_SCRIPT_REGISTRY,
    BYMAX_CACHE_EVENTS,
    BYMAX_CACHE_SERIALIZER,
    BYMAX_CACHE_KEY_BUILDER
  ]

  // Tokens must be Symbols (not strings) so the DI graph cannot collide with a
  // host-app or sibling-lib token of the same name.
  it('are all symbols', () => {
    for (const token of tokens) {
      expect(typeof token).toBe('symbol')
    }
  })

  // Each token must be a distinct identity — a shared reference would make two
  // providers resolve to the same DI slot.
  it('are mutually distinct', () => {
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})
