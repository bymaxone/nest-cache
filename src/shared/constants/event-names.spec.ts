import type { CacheEventName } from '../types/cache-event.types'
import { CACHE_EVENT_NAMES } from './event-names'

describe('CACHE_EVENT_NAMES', () => {
  // Each symbolic key must map to its exact raw ioredis event name — these are
  // the wire-level strings the connection manager listens on, so a typo here
  // would silently drop a lifecycle event.
  it('maps every symbolic key to its raw event name', () => {
    expect(CACHE_EVENT_NAMES).toEqual({
      CONNECT: 'connect',
      READY: 'ready',
      ERROR: 'error',
      CLOSE: 'close',
      RECONNECTING: 'reconnecting',
      END: 'end'
    })
  })

  // The object must expose exactly the six lifecycle events — no more, no fewer
  // — so it stays in lock-step with the CacheEventName union.
  it('exposes exactly the six lifecycle keys', () => {
    expect(Object.keys(CACHE_EVENT_NAMES)).toHaveLength(6)
  })

  // Every value must be assignable to the CacheEventName union; this runtime
  // membership check protects the `satisfies Record<string, CacheEventName>`
  // contract from drifting if a value is ever changed to an off-union string.
  it('has values that all belong to the CacheEventName union', () => {
    const union: CacheEventName[] = ['connect', 'ready', 'error', 'close', 'reconnecting', 'end']
    for (const value of Object.values(CACHE_EVENT_NAMES)) {
      expect(union).toContain(value)
    }
  })
})
