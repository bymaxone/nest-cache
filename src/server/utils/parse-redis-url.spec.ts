import { parseRedisUrl } from './parse-redis-url'

describe('parseRedisUrl', () => {
  // A bare host+port URL maps straight to host/port — the most common shape.
  it('extracts host and explicit port', () => {
    const result = parseRedisUrl('redis://redis.example.com:6380')

    expect(result.host).toBe('redis.example.com')
    expect(result.port).toBe(6380)
  })

  // When the port is omitted, the parser must apply the Redis default (6379) so
  // discrete-field fallbacks are not needed for the common case.
  it('defaults the port to 6379 when omitted', () => {
    const result = parseRedisUrl('redis://redis.example.com')

    expect(result.port).toBe(6379)
  })

  // Username and password must be lifted out of the authority section so ACL
  // auth works from a single URL.
  it('extracts username and password', () => {
    const result = parseRedisUrl('redis://default:secret@host:6379')

    expect(result.username).toBe('default')
    expect(result.password).toBe('secret')
  })

  // Percent-encoded credential characters must be decoded — otherwise a password
  // containing `@` or `!` would authenticate with the literal escape sequence.
  it('URL-decodes percent-encoded credentials', () => {
    const result = parseRedisUrl('redis://us%40er:p%21ss@host:6379')

    expect(result.username).toBe('us@er')
    expect(result.password).toBe('p!ss')
  })

  // A URL without credentials must leave username and password unset — the false
  // side of the `if (parsed.username)` / `if (parsed.password)` guards. Pins those
  // conditionals so an "always-true" mutant (which would set them to '') is caught.
  it('leaves username and password unset when the URL has no credentials', () => {
    const result = parseRedisUrl('redis://host:6379')

    expect(result.username).toBeUndefined()
    expect(result.password).toBeUndefined()
  })

  // A single-digit numeric pathname segment selects the logical database index.
  it('reads a single-digit db index from a numeric pathname', () => {
    const result = parseRedisUrl('redis://host:6379/3')

    expect(result.db).toBe(3)
  })

  // A multi-digit db index must be read in full — pins the `+` quantifier in
  // `/^\d+$/` (a `/^\d$/` mutant would match only the first digit and drop db).
  it('reads a multi-digit db index', () => {
    const result = parseRedisUrl('redis://host:6379/15')

    expect(result.db).toBe(15)
  })

  // A digit-prefixed but non-numeric segment must NOT set db — pins the `$` anchor
  // in `/^\d+$/` (a `/^\d+/` mutant would match the leading digits and set db).
  it('does not set db for a digit-prefixed alphanumeric segment', () => {
    const result = parseRedisUrl('redis://host:6379/2a')

    expect(result.db).toBeUndefined()
  })

  // A digit-suffixed but non-numeric segment must NOT set db — pins the `^` anchor
  // in `/^\d+$/` (a `/\d+$/` mutant would match the trailing digit and set db).
  it('does not set db for a digit-suffixed alphanumeric segment', () => {
    const result = parseRedisUrl('redis://host:6379/a2')

    expect(result.db).toBeUndefined()
  })

  // An empty pathname must leave `db` unset so the discrete `db` field (or the
  // ioredis default) wins — this exercises the left side of the `&&` guard.
  it('does not set db when the pathname is empty', () => {
    const result = parseRedisUrl('redis://host:6379')

    expect(result.db).toBeUndefined()
  })

  // A non-numeric pathname must also leave `db` unset — this exercises the right
  // side of the `&&` guard (segment present but failing the digit test).
  it('does not set db when the pathname is non-numeric', () => {
    const result = parseRedisUrl('redis://host:6379/abc')

    expect(result.db).toBeUndefined()
  })

  // The `rediss://` scheme must enable TLS by emitting an empty `tls` object,
  // which ioredis treats as "use TLS with defaults".
  it('enables TLS for the rediss:// scheme', () => {
    const result = parseRedisUrl('rediss://host:6379')

    expect(result.tls).toEqual({})
  })

  // A plain `redis://` URL must NOT set `tls`, proving TLS is opt-in per scheme.
  it('does not enable TLS for the redis:// scheme', () => {
    const result = parseRedisUrl('redis://host:6379')

    expect(result.tls).toBeUndefined()
  })

  // Any non-Redis protocol must throw — fail fast at config time rather than
  // attempting a connection with the wrong transport.
  it('throws on an unsupported protocol', () => {
    expect(() => parseRedisUrl('http://host:6379')).toThrow(/Unsupported Redis protocol/)
  })

  // A string that is not a valid URL must throw (the WHATWG URL constructor),
  // surfacing a misconfiguration immediately.
  it('throws on a malformed URL', () => {
    expect(() => parseRedisUrl('not-a-url')).toThrow()
  })

  // A valid-scheme URL that parses to an empty hostname (e.g. `redis:///0`) must
  // fail closed instead of building a hostless connection.
  it('throws when the host is missing', () => {
    expect(() => parseRedisUrl('redis:///0')).toThrow(/missing a host/)
  })
})
