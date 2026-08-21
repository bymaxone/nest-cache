import { parseInfoFields, readRedisStats } from './parse-info'

/** A fixed instant so every assertion on `readAt` is deterministic. */
const READ_AT = new Date('2026-08-21T12:00:00.000Z')

/** Builds `INFO`-shaped text from field pairs, with the CRLF Redis actually sends. */
const info = (lines: readonly string[]): string => `# Server\r\n${lines.join('\r\n')}\r\n`

describe('parseInfoFields', () => {
  // Section headers carry no field and must be dropped rather than parsed as one.
  it('drops section headers and blank lines', () => {
    const fields = parseInfoFields('# Server\r\n\r\nredis_version:8.10.0\r\n')
    expect([...fields.keys()]).toEqual(['redis_version'])
  })

  // A value containing a colon keeps everything after the FIRST separator.
  // `db0:keys=1,expires=0` is the common one; splitting on every occurrence
  // would truncate it.
  it('keeps everything after the first separator', () => {
    const fields = parseInfoFields('db0:keys=1,expires=0\r\n')
    expect(fields.get('db0')).toBe('keys=1,expires=0')
  })

  // A SECTION HEADER THAT CONTAINS A COLON must still be dropped. Without this
  // case, skipping headers is indistinguishable from not skipping them: real
  // headers carry no colon, so they fall out of the `indexOf` guard anyway and a
  // broken header check looks identical to a working one.
  it('drops a section header even when it contains a separator', () => {
    const fields = parseInfoFields('# Commandstats: none\r\nredis_version:8.10.0\r\n')
    expect([...fields.keys()]).toEqual(['redis_version'])
  })

  // A line with no separator is not a field.
  it('skips a line with no separator', () => {
    expect(parseInfoFields('garbage\r\n').size).toBe(0)
  })

  // A line STARTING with the separator has an empty name, which is not a field
  // any caller can ask for. `indexOf` returning 0 must be rejected, not accepted.
  it('skips a line whose separator is the first character', () => {
    expect(parseInfoFields(':orphan\r\n').size).toBe(0)
  })
})

describe('readRedisStats', () => {
  // The reading is stamped with the reading host's clock, in ISO form.
  it('stamps the reading with the supplied instant', () => {
    expect(readRedisStats('', READ_AT).readAt).toBe('2026-08-21T12:00:00.000Z')
  })

  // A field this server does not publish is reported absent, never zeroed.
  it('reports every unpublished numeric field as null', () => {
    const stats = readRedisStats('', READ_AT)
    expect(stats.memory.usedBytes).toBeNull()
    expect(stats.stats.keyspaceHits).toBeNull()
    expect(stats.clients.connected).toBeNull()
    expect(stats.server.uptimeSeconds).toBeNull()
  })

  // A field PRESENT but empty must report absence too. `Number('')` is 0 and
  // `Number.isFinite(0)` is true, so the obvious implementation reports a
  // MEASURED zero for a field the server declined to fill in.
  it.each([[''], ['   ']])('reports the empty value %p as null, not zero', (raw) => {
    expect(readRedisStats(info([`used_memory:${raw}`]), READ_AT).memory.usedBytes).toBeNull()
  })

  // A field present but unparseable is absent, not zero.
  it('reports an unparseable numeric field as null', () => {
    expect(readRedisStats(info(['used_memory:abc']), READ_AT).memory.usedBytes).toBeNull()
  })

  // Hex is not an INFO number. Excluding it costs nothing and keeps the parser
  // from inventing a value out of a string Redis would never mean that way.
  it('reports a hex-looking value as null', () => {
    expect(readRedisStats(info(['used_memory:0x10']), READ_AT).memory.usedBytes).toBeNull()
  })

  // A value that is numerically shaped but overflows to Infinity is absent, not
  // a measurement. `Number('1e999')` is Infinity, and an Infinity in a payload
  // renders as a size or a count that cannot be true.
  it('reports a value that overflows to Infinity as null', () => {
    expect(readRedisStats(info(['used_memory:1e999']), READ_AT).memory.usedBytes).toBeNull()
  })

  // A NEGATIVE value parses. Redis publishes them — `rdb_last_bgsave_time:-1` is
  // the common one — so the leading sign in the numeric pattern is load-bearing.
  it('reads a negative value', () => {
    expect(readRedisStats(info(['used_memory:-1']), READ_AT).memory.usedBytes).toBe(-1)
  })

  // Exponent forms, each pinning a different piece of the numeric pattern: an
  // unsigned exponent, an explicitly signed one, and a multi-digit one. Redis
  // reports some counters in exponential form, and a pattern that accepted only
  // one of these shapes would silently report the others as "not measured".
  it.each([
    ['1e3', 1000],
    ['1e+3', 1000],
    ['1e-3', 0.001],
    ['1e10', 10000000000]
  ])('reads the exponent form %s', (raw, expected) => {
    expect(readRedisStats(info([`used_memory:${raw}`]), READ_AT).memory.usedBytes).toBe(expected)
  })

  // The value is trimmed before it is read. `INFO` puts no space after the colon,
  // but a server or proxy that did would otherwise turn every reading on the line
  // into "not reported" — and the parser must not depend on that formatting.
  it('trims a padded value before reading it', () => {
    expect(readRedisStats(info(['used_memory: 12']), READ_AT).memory.usedBytes).toBe(12)
  })

  // A real number parses.
  it('reads a published numeric field', () => {
    expect(readRedisStats(info(['used_memory:1150000']), READ_AT).memory.usedBytes).toBe(1150000)
  })

  // A fractional field parses — fragmentation ratio is not an integer.
  it('reads a fractional field', () => {
    expect(
      readRedisStats(info(['mem_fragmentation_ratio:9.07']), READ_AT).memory.fragmentationRatio
    ).toBe(9.07)
  })

  // `maxmemory:0` means UNBOUNDED. Read as a literal ceiling it makes a
  // saturation bar show full on the least constrained server there is.
  it('reads maxmemory:0 as unbounded', () => {
    expect(readRedisStats(info(['maxmemory:0']), READ_AT).memory.max).toEqual({
      kind: 'unbounded'
    })
  })

  // A configured ceiling carries its bytes.
  it('reads a configured maxmemory as limited', () => {
    expect(readRedisStats(info(['maxmemory:1073741824']), READ_AT).memory.max).toEqual({
      kind: 'limited',
      bytes: 1073741824
    })
  })

  // An ABSENT maxmemory is a third state, distinct from unbounded. Collapsing
  // the two into one null would leave a surface unable to say which it saw, and
  // they call for opposite actions.
  it('reads an absent maxmemory as unreported, distinctly from unbounded', () => {
    const absent = readRedisStats('', READ_AT).memory.max
    const unbounded = readRedisStats(info(['maxmemory:0']), READ_AT).memory.max
    expect(absent).toEqual({ kind: 'unreported' })
    expect(absent).not.toEqual(unbounded)
  })

  // An unparseable maxmemory is unreported, not unbounded — it is not a
  // measurement of zero.
  it('reads an unparseable maxmemory as unreported', () => {
    expect(readRedisStats(info(['maxmemory:abc']), READ_AT).memory.max).toEqual({
      kind: 'unreported'
    })
  })

  // `aof_enabled:1` is on, `:0` is off, and ABSENT is unknown. `false` for an
  // absent field would be a durability claim made without evidence.
  it.each([
    ['1', true],
    ['0', false]
  ])('reads aof_enabled:%s as %p', (raw, expected) => {
    expect(readRedisStats(info([`aof_enabled:${raw}`]), READ_AT).persistence.aofEnabled).toBe(
      expected
    )
  })

  // The durability claim guard: an absent field must not become `false`, which
  // would assert AOF is off on a server that never said so.
  it('reads an absent aof_enabled as null rather than false', () => {
    expect(readRedisStats('', READ_AT).persistence.aofEnabled).toBeNull()
  })

  // The bgsave status is narrowed to the two values Redis documents, so a
  // consumer branching on it cannot receive a third string it has no branch for.
  it.each([
    ['ok', 'ok'],
    ['err', 'err'],
    ['something-else', null]
  ])('narrows rdb_last_bgsave_status:%s to %p', (raw, expected) => {
    expect(
      readRedisStats(info([`rdb_last_bgsave_status:${raw}`]), READ_AT).persistence
        .rdbLastBgsaveStatus
    ).toBe(expected)
  })

  // An absent bgsave status is unknown, not a successful save — the optimistic
  // default would hide a server that never reported one.
  it('reads an absent bgsave status as null', () => {
    expect(readRedisStats('', READ_AT).persistence.rdbLastBgsaveStatus).toBeNull()
  })

  // The last save time is a Unix timestamp in seconds, surfaced as an instant.
  it('converts rdb_last_save_time seconds into an ISO instant', () => {
    expect(
      readRedisStats(info(['rdb_last_save_time:1755777600']), READ_AT).persistence.rdbLastSaveAt
    ).toBe(new Date(1755777600 * 1000).toISOString())
  })

  // An absent save time reports nothing rather than the epoch, which would render
  // as a real instant in 1970.
  it('reads an absent rdb_last_save_time as null', () => {
    expect(readRedisStats('', READ_AT).persistence.rdbLastSaveAt).toBeNull()
  })

  // `role:slave` is the wire spelling; the reading uses `replica`.
  it('maps role:slave to replica', () => {
    expect(readRedisStats(info(['role:slave']), READ_AT).replication.role).toBe('replica')
  })

  // The primary case must map explicitly, so the replica branch cannot be inverted
  // without a test noticing.
  it('maps role:master to master', () => {
    expect(readRedisStats(info(['role:master']), READ_AT).replication.role).toBe('master')
  })

  // The one place this parser substitutes rather than reporting null, and it is
  // documented: a server publishing no role is standalone, and standalone is a
  // primary. There is no third branch a surface could offer here.
  it('defaults an absent role to master', () => {
    expect(readRedisStats('', READ_AT).replication.role).toBe('master')
  })

  // Text fields pass through unnarrowed.
  it('reads the text fields', () => {
    const stats = readRedisStats(
      info(['redis_version:8.10.0', 'redis_mode:standalone', 'maxmemory_policy:noeviction']),
      READ_AT
    )
    expect(stats.server.redisVersion).toBe('8.10.0')
    expect(stats.server.mode).toBe('standalone')
    expect(stats.memory.evictionPolicy).toBe('noeviction')
  })

  // Text fields report absence too — the null-not-empty-string rule applies to
  // every reading, not only the numeric ones.
  it('reads absent text fields as null', () => {
    const stats = readRedisStats('', READ_AT)
    expect(stats.server.redisVersion).toBeNull()
    expect(stats.server.mode).toBeNull()
    expect(stats.memory.evictionPolicy).toBeNull()
  })

  // Every remaining counter is wired to its own INFO field name. A single test
  // pins them all so a transposed name cannot pass.
  it('maps each counter to its own INFO field', () => {
    const stats = readRedisStats(
      info([
        'keyspace_hits:1',
        'keyspace_misses:2',
        'expired_keys:3',
        'evicted_keys:4',
        'instantaneous_ops_per_sec:5',
        'total_commands_processed:6',
        'total_connections_received:7',
        'rejected_connections:8',
        'connected_clients:9',
        'blocked_clients:10',
        'uptime_in_seconds:11',
        'used_memory:12',
        'used_memory_peak:13',
        'rdb_changes_since_last_save:14',
        'connected_slaves:15'
      ]),
      READ_AT
    )
    expect(stats.stats).toEqual({
      keyspaceHits: 1,
      keyspaceMisses: 2,
      expiredKeys: 3,
      evictedKeys: 4,
      instantaneousOpsPerSec: 5,
      totalCommandsProcessed: 6,
      totalConnectionsReceived: 7,
      rejectedConnections: 8
    })
    expect(stats.clients).toEqual({ connected: 9, blocked: 10 })
    expect(stats.server.uptimeSeconds).toBe(11)
    expect(stats.memory.usedBytes).toBe(12)
    expect(stats.memory.peakBytes).toBe(13)
    expect(stats.persistence.rdbChangesSinceLastSave).toBe(14)
    expect(stats.replication.connectedReplicas).toBe(15)
  })
})
