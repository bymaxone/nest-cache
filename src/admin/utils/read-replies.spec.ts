import { readKeyTtl, readKeyType, readSizeBytes } from './read-replies'

describe('readKeyType', () => {
  // Every type this surface names round-trips.
  it.each([['string'], ['hash'], ['set'], ['list'], ['zset'], ['stream']])(
    'recognises %s',
    (reply) => {
      expect(readKeyType(reply)).toBe(reply)
    }
  )

  // A type this build has never heard of — a module type, or one a later server
  // adds — maps to `other` rather than widening the union with a raw string.
  it('maps an unrecognised type to other', () => {
    expect(readKeyType('vectorset')).toBe('other')
  })

  // `TYPE` on a missing key answers `none`, which is not one of the named types.
  it('maps the none reply to other', () => {
    expect(readKeyType('none')).toBe('other')
  })

  // A non-string reply cannot be a type name.
  it.each([[null], [undefined], [42], [{}]])('maps the non-string reply %p to other', (reply) => {
    expect(readKeyType(reply)).toBe('other')
  })
})

describe('readKeyTtl', () => {
  // A positive TTL is seconds remaining.
  it('reads a positive reply as expiring', () => {
    expect(readKeyTtl(120)).toEqual({ kind: 'expiring', seconds: 120 })
  })

  // `-1` means the key exists with NO expiry. Distinct from `-2`, and the
  // distinction is the whole reason this is a union.
  it('reads -1 as persistent', () => {
    expect(readKeyTtl(-1)).toEqual({ kind: 'persistent' })
  })

  // `-2` means the key does not exist — a key that expired between the scan and
  // this read. Reporting it as persistent would state the opposite of what
  // happened to it.
  it('reads -2 as missing', () => {
    expect(readKeyTtl(-2)).toEqual({ kind: 'missing' })
  })

  // Persistent and missing must never compare equal: a caller that cannot tell
  // them apart is the defect this type exists to prevent.
  it('keeps persistent and missing distinguishable', () => {
    expect(readKeyTtl(-1)).not.toEqual(readKeyTtl(-2))
  })

  // A reply that is not a number at all is not a TTL. Treated as missing, which
  // is the only honest reading: nothing said this key has a remaining life.
  it.each([[null], [undefined], ['120'], [Number.NaN]])(
    'reads the non-numeric reply %p as missing',
    (reply) => {
      expect(readKeyTtl(reply)).toEqual({ kind: 'missing' })
    }
  )

  // A small POSITIVE ttl must read as expiring. Pins that the sentinel checks
  // compare against the negative values Redis documents and never against their
  // positive counterparts, which are ordinary remaining lifetimes.
  it.each([[1], [2]])('reads the small positive reply %p as expiring', (reply) => {
    expect(readKeyTtl(reply)).toEqual({ kind: 'expiring', seconds: reply })
  })

  // Zero is a real TTL — a key in its final second.
  it('reads 0 as expiring', () => {
    expect(readKeyTtl(0)).toEqual({ kind: 'expiring', seconds: 0 })
  })

  // A negative value Redis does not document is not a measurement of remaining
  // life; it must not become a negative countdown on a screen.
  it('reads an undocumented negative reply as missing', () => {
    expect(readKeyTtl(-3)).toEqual({ kind: 'missing' })
  })
})

describe('readSizeBytes', () => {
  // The measured case: a real numeric reply passes through unchanged, so the
  // null-on-unusable rule below is a guard and not the only behaviour.
  it('reads a numeric reply as bytes', () => {
    expect(readSizeBytes(4096)).toBe(4096)
  })

  // `null` rather than `0` when the server declines to answer: a key whose size
  // is unknown and one occupying nothing render the same under a zero, and only
  // one of them is a measurement.
  it.each([[null], [undefined], ['4096'], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'reports the unusable reply %p as null',
    (reply) => {
      expect(readSizeBytes(reply)).toBeNull()
    }
  )
})
