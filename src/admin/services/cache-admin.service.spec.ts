import { CACHE_ERROR_CODES } from '../../server/errors/cache-error-codes'
import { CacheException } from '../../server/errors/cache.exception'
import { CacheAdminService } from './cache-admin.service'
import { resolveAdminOptions } from '../config/resolved-admin-options'

import type { CacheScope } from '../interfaces/cache-scope.interface'
import type {
  IRedisPipeline,
  IRedisReader,
  PipelineReply
} from '../interfaces/redis-reader.interface'

const SCOPES: readonly CacheScope[] = [
  { id: 'cache', label: 'Cache', pattern: 'app:*', isReadable: true, origin: 'the namespace' },
  {
    id: 'auth',
    label: 'Authentication',
    pattern: 'auth:*',
    isReadable: false,
    origin: 'written by nest-auth at Redis root; holds session records'
  }
]

/** One `SCAN` answer: the next cursor and the keys in that batch. */
type ScanStep = readonly [string, string[]]

/** Records what a pipeline was asked to queue, and answers with fixed replies. */
class FakePipeline implements IRedisPipeline {
  readonly queued: string[] = []
  constructor(private readonly replies: PipelineReply[]) {}
  type(key: string): IRedisPipeline {
    this.queued.push(`TYPE ${key}`)
    return this
  }
  ttl(key: string): IRedisPipeline {
    this.queued.push(`TTL ${key}`)
    return this
  }
  memory(subcommand: 'USAGE', key: string): IRedisPipeline {
    this.queued.push(`MEMORY ${subcommand} ${key}`)
    return this
  }
  async exec(): Promise<PipelineReply[] | null> {
    return this.replies
  }
}

/** A reader standing in for ioredis. `ioredis-mock` cannot be used here: it has
 * no `MEMORY USAGE`, no `memory` on its pipeline, and a broken
 * `zrange WITHSCORES` (all three measured). */
class FakeReader implements IRedisReader {
  readonly pipelines: FakePipeline[] = []
  readonly calls: string[][] = []
  private scanIndex = 0

  constructor(
    private readonly scans: readonly ScanStep[] = [['0', []]],
    private readonly replies: {
      type?: string
      ttl?: number
      get?: string | null
      hgetall?: Record<string, string>
      smembers?: string[]
      lrange?: string[]
      call?: unknown
      pipelineReplies?: PipelineReply[]
    } = {}
  ) {}

  async scan(): Promise<[string, string[]]> {
    const step = this.scans[Math.min(this.scanIndex, this.scans.length - 1)]
    this.scanIndex += 1
    return [step![0], step![1]]
  }
  pipeline(): IRedisPipeline {
    const pipe = new FakePipeline(this.replies.pipelineReplies ?? [])
    this.pipelines.push(pipe)
    return pipe
  }
  async type(): Promise<string> {
    return this.replies.type ?? 'string'
  }
  async ttl(): Promise<number> {
    return this.replies.ttl ?? -1
  }
  async get(): Promise<string | null> {
    return this.replies.get ?? null
  }
  async hgetall(): Promise<Record<string, string>> {
    return this.replies.hgetall ?? {}
  }
  async smembers(): Promise<string[]> {
    return this.replies.smembers ?? []
  }
  async lrange(): Promise<string[]> {
    return this.replies.lrange ?? []
  }
  async call(command: string, ...args: (string | number)[]): Promise<unknown> {
    this.calls.push([command, ...args.map(String)])
    return this.replies.call ?? []
  }
}

/** Builds the service over a fake reader. */
const build = (
  reader: IRedisReader,
  overrides: Partial<Parameters<typeof resolveAdminOptions>[0]> = {}
): CacheAdminService =>
  new CacheAdminService(
    { getClient: () => reader },
    resolveAdminOptions({ scopes: SCOPES, ...overrides })
  )

/** Builds `[TYPE, TTL]` pipeline replies for a run of keys. */
const describeReplies = (
  entries: readonly (readonly [string, number])[],
  sizes?: readonly (number | null)[]
): PipelineReply[] =>
  entries.flatMap((entry, index) => {
    const base: PipelineReply[] = [
      [null, entry[0]],
      [null, entry[1]]
    ]
    return sizes ? [...base, [null, sizes[index] ?? null] as PipelineReply] : base
  })

describe('CacheAdminService.listScopes', () => {
  // The scope list must answer during an outage: it is what a surface reads to
  // decide what it may offer at all, and an operator whose cache is down is
  // exactly the person who needs to be told what the inspector covers.
  it('returns the declared scopes without touching the connection', () => {
    const service = new CacheAdminService(
      {
        getClient: () => {
          throw new Error('the connection must not be reached')
        }
      },
      resolveAdminOptions({ scopes: SCOPES })
    )
    expect(service.listScopes().map((scope) => scope.id)).toEqual(['cache', 'auth'])
  })
})

describe('CacheAdminService.listKeys', () => {
  // The happy path: one scan batch, described through a pipeline.
  it('lists the keys a scan returned with their type and ttl', async () => {
    const reader = new FakeReader([['0', ['app:a', 'app:b']]], {
      pipelineReplies: describeReplies([
        ['string', 60],
        ['hash', -1]
      ])
    })
    const page = await build(reader).listKeys('cache')
    expect(page.entries).toEqual([
      { key: 'app:a', type: 'string', ttl: { kind: 'expiring', seconds: 60 }, sizeBytes: null },
      { key: 'app:b', type: 'hash', ttl: { kind: 'persistent' }, sizeBytes: null }
    ])
    expect(page.sampledCount).toBe(2)
  })

  // `commandBatchLimit` caps the commands queued per Redis round-trip, and the
  // pipeline COUNT is the only thing that observes it: the entries `listKeys`
  // returns are identical however the keys are chunked, so a batching defect
  // cannot be seen in the result. Mutating `Math.max` to `Math.min` in the
  // chunk-size expression collapses the chunk to one key per pipeline — correct
  // output, five pipelines here instead of three, and visible only in that count.
  it('caps each pipeline at the configured command batch limit', async () => {
    const keys = ['app:a', 'app:b', 'app:c', 'app:d', 'app:e']
    const reader = new FakeReader([['0', keys]], {
      pipelineReplies: describeReplies(keys.map(() => ['string', -1] as const))
    })
    // 4 commands per round-trip over 2 commands per key is 2 keys per pipeline,
    // so five keys need three: two full and one holding the remainder.
    const page = await build(reader, { commandBatchLimit: 4 }).listKeys('cache')
    expect(reader.pipelines).toHaveLength(3)
    expect(reader.pipelines.map((pipeline) => pipeline.queued.length)).toEqual([4, 4, 2])
    expect(page.entries.map((entry) => entry.key)).toEqual(keys)
  })

  // A limit smaller than one key's own commands cannot honour itself. The floor of
  // one key per pipeline is deliberate: the alternative is a chunk of zero keys and
  // a loop that never advances.
  it('still sends one key per pipeline when the limit is below one key of commands', async () => {
    const keys = ['app:a', 'app:b']
    const reader = new FakeReader([['0', keys]], {
      pipelineReplies: describeReplies(keys.map(() => ['string', -1] as const))
    })
    const page = await build(reader, { commandBatchLimit: 1 }).listKeys('cache')
    expect(reader.pipelines).toHaveLength(2)
    expect(page.entries).toHaveLength(2)
  })

  // Sizing is OPT-IN. Redis is single-threaded, so the extra command per key is
  // paid by every other client waiting behind the batch.
  it('does not issue MEMORY USAGE unless sizing was requested', async () => {
    const reader = new FakeReader([['0', ['app:a']]], {
      pipelineReplies: describeReplies([['string', -1]])
    })
    await build(reader).listKeys('cache')
    expect(reader.pipelines[0]?.queued).toEqual(['TYPE app:a', 'TTL app:a'])
  })

  // When sizing IS requested the command must actually be issued and the sample
  // summed — the opt-in has to buy something.
  it('issues MEMORY USAGE and sums the sample when sizing is requested', async () => {
    const reader = new FakeReader([['0', ['app:a', 'app:b']]], {
      pipelineReplies: describeReplies(
        [
          ['string', -1],
          ['string', -1]
        ],
        [100, 250]
      )
    })
    const page = await build(reader).listKeys('cache', { includeSize: true })
    expect(reader.pipelines[0]?.queued).toContain('MEMORY USAGE app:a')
    expect(page.entries.map((entry) => entry.sizeBytes)).toEqual([100, 250])
    expect(page.sampledBytes).toBe(350)
  })

  // A server that declines to size one key must not zero it, and must not drag
  // the total down as though it had measured nothing.
  it('excludes an unmeasured key from the sampled total', async () => {
    const reader = new FakeReader([['0', ['app:a', 'app:b']]], {
      pipelineReplies: describeReplies(
        [
          ['string', -1],
          ['string', -1]
        ],
        [100, null]
      )
    })
    const page = await build(reader).listKeys('cache', { includeSize: true })
    expect(page.entries[1]?.sizeBytes).toBeNull()
    expect(page.sampledBytes).toBe(100)
  })

  // Without sizing, the total is null rather than 0 — nothing was measured, and
  // a zero would read as a measurement of emptiness.
  it('reports a null sampled total when sizing was not requested', async () => {
    const reader = new FakeReader([['0', ['app:a']]], {
      pipelineReplies: describeReplies([['string', -1]])
    })
    expect((await build(reader).listKeys('cache')).sampledBytes).toBeNull()
  })

  // The batch is bounded in COMMANDS, not keys. Four keys at two commands each
  // under a limit of 4 must arrive as two flushes.
  it('chunks the describe batch by command count, not key count', async () => {
    const keys = ['app:a', 'app:b', 'app:c', 'app:d']
    const reader = new FakeReader([['0', keys]], {
      pipelineReplies: describeReplies([
        ['string', -1],
        ['string', -1]
      ])
    })
    await build(reader, { commandBatchLimit: 4 }).listKeys('cache')
    expect(reader.pipelines).toHaveLength(2)
    expect(reader.pipelines[0]?.queued).toHaveLength(4)
  })

  // With sizing the per-key cost rises to three commands, so the same limit
  // must produce smaller key chunks — the point of bounding commands.
  it('shrinks the key chunk when sizing raises the per-key command cost', async () => {
    const keys = ['app:a', 'app:b', 'app:c', 'app:d']
    const reader = new FakeReader([['0', keys]], {
      pipelineReplies: describeReplies([['string', -1]], [1])
    })
    await build(reader, { commandBatchLimit: 4 }).listKeys('cache', { includeSize: true })
    expect(reader.pipelines).toHaveLength(4)
  })

  // A limit smaller than one key's command cost must still make progress rather
  // than dividing to a zero-sized chunk and looping forever.
  it('sends at least one key per batch even below the per-key cost', async () => {
    const reader = new FakeReader([['0', ['app:a', 'app:b']]], {
      pipelineReplies: describeReplies([['string', -1]])
    })
    await build(reader, { commandBatchLimit: 1 }).listKeys('cache')
    expect(reader.pipelines).toHaveLength(2)
  })

  // The scan follows the cursor across batches until the scope is exhausted.
  it('follows the cursor across scan batches', async () => {
    const reader = new FakeReader(
      [
        ['12', ['app:a']],
        ['0', ['app:b']]
      ],
      {
        pipelineReplies: describeReplies([
          ['string', -1],
          ['string', -1]
        ])
      }
    )
    const page = await build(reader).listKeys('cache')
    expect(page.entries.map((entry) => entry.key)).toEqual(['app:a', 'app:b'])
    expect(page.isComplete).toBe(true)
    expect(page.cursor).toBeNull()
  })

  // At the cap the scan stops and the page SAYS it stopped. The batch that
  // crossed the limit is kept whole: `SCAN` returns whole batches and the cursor
  // has already moved past them, so trimming to an exact page size would drop
  // keys no later page could reach — silent loss in the one screen whose job is
  // to report what is there.
  it('stops scanning at the limit without dropping the batch that crossed it', async () => {
    const reader = new FakeReader(
      [
        ['7', ['app:a', 'app:b', 'app:c']],
        ['0', []]
      ],
      { pipelineReplies: describeReplies([['string', -1]]) }
    )
    const page = await build(reader, { scanLimit: 2 }).listKeys('cache')
    expect(page.entries.map((entry) => entry.key)).toEqual(['app:a', 'app:b', 'app:c'])
    expect(page.sampledCount).toBe(3)
    expect(page.isComplete).toBe(false)
    expect(page.cursor).toBe('7')
    expect(page.scanLimit).toBe(2)
  })

  // Landing EXACTLY on the limit must stop the loop. This is the off-by-one that
  // separates `<` from `<=`: with the wrong comparison the scan takes one more
  // round trip and returns a different cursor, so a caller pages from the wrong
  // place and the extra batch is charged to a server nobody meant to ask twice.
  it('stops when the collected count lands exactly on the limit', async () => {
    const reader = new FakeReader(
      [
        ['7', ['app:a', 'app:b']],
        ['9', ['app:c']]
      ],
      { pipelineReplies: describeReplies([['string', -1]]) }
    )
    const page = await build(reader, { scanLimit: 2 }).listKeys('cache')
    expect(page.sampledCount).toBe(2)
    expect(page.cursor).toBe('7')
  })

  // The same overshoot on an EXHAUSTED scope is complete, and must not report a
  // cursor of '0' — a caller resuming from it would restart the scope from the
  // beginning and loop forever over the same keys.
  it('reports a null cursor when the scope is exhausted despite overshooting', async () => {
    const reader = new FakeReader([['0', ['app:a', 'app:b', 'app:c']]], {
      pipelineReplies: describeReplies([['string', -1]])
    })
    const page = await build(reader, { scanLimit: 2 }).listKeys('cache')
    expect(page.sampledCount).toBe(3)
    expect(page.isComplete).toBe(true)
    expect(page.cursor).toBeNull()
  })

  // An exhausted scope is complete even when it returned nothing — an empty
  // COMPLETE page is a measurement, unlike an empty incomplete one.
  it('reports an empty exhausted scope as complete', async () => {
    const page = await build(new FakeReader([['0', []]])).listKeys('cache')
    expect(page).toMatchObject({ sampledCount: 0, isComplete: true, cursor: null })
    expect(page.entries).toEqual([])
  })

  // A caller resumes from the cursor the previous page reported.
  it('resumes from a supplied cursor', async () => {
    const reader = new FakeReader([['0', ['app:z']]], {
      pipelineReplies: describeReplies([['string', -1]])
    })
    const page = await build(reader).listKeys('cache', { cursor: '7' })
    expect(page.entries[0]?.key).toBe('app:z')
  })

  // Listing an UNREADABLE scope must work in full. This is the load-bearing
  // split: only the value is withheld, never the listing. A surface that
  // rendered this region as empty would tell an operator it holds nothing when
  // it holds every session record.
  it('lists an unreadable scope with types, ttls and sizes intact', async () => {
    const reader = new FakeReader([['0', ['auth:sess:1']]], {
      pipelineReplies: describeReplies([['hash', 900]], [512])
    })
    const page = await build(reader).listKeys('auth', { includeSize: true })
    expect(page.entries).toEqual([
      {
        key: 'auth:sess:1',
        type: 'hash',
        ttl: { kind: 'expiring', seconds: 900 },
        sizeBytes: 512
      }
    ])
  })

  // A pipeline entry that errored is reported as an unknown reading rather than
  // dropping the key from the listing — the key exists, one fact about it does not.
  it('keeps a key whose pipeline entry errored', async () => {
    // The errored slot carries a REAL value alongside its error. If the error
    // were ignored, that value would be read and the type would come back
    // 'string'; reporting 'other' is what proves the error short-circuits.
    const reader = new FakeReader([['0', ['app:a']]], {
      pipelineReplies: [
        [new Error('boom'), 'string'],
        [null, -1]
      ]
    })
    const page = await build(reader).listKeys('cache')
    expect(page.entries[0]).toEqual({
      key: 'app:a',
      type: 'other',
      ttl: { kind: 'persistent' },
      sizeBytes: null
    })
  })

  // A pipeline that answers null at all is not a reason to invent readings.
  it('survives a pipeline that returns null', async () => {
    const reader = new FakeReader([['0', ['app:a']]], { pipelineReplies: [] })
    const page = await build(reader).listKeys('cache')
    expect(page.entries[0]).toEqual({
      key: 'app:a',
      type: 'other',
      ttl: { kind: 'missing' },
      sizeBytes: null
    })
  })

  // An undeclared scope must be refused rather than defaulted to the first one,
  // which would answer a question about a keyspace nobody named.
  it('rejects an unknown scope id', async () => {
    await expect(build(new FakeReader()).listKeys('nope')).rejects.toThrow(CacheException)
  })
})

describe('CacheAdminService.describeKey', () => {
  // The base case for description: a key inside the scope reports its real type
  // and remaining life, with no value read.
  it('describes a key inside the scope', async () => {
    const reader = new FakeReader([], { type: 'string', ttl: 30 })
    const detail = await build(reader).describeKey('cache', 'app:a')
    expect(detail).toEqual({
      scopeId: 'cache',
      key: 'app:a',
      type: 'string',
      ttl: { kind: 'expiring', seconds: 30 },
      sizeBytes: null,
      isReadable: true
    })
  })

  // Describing a key in an UNREADABLE scope must succeed, and say that the value
  // is off limits — so a surface can disable the reveal without attempting it.
  it('describes a key in an unreadable scope and flags it unreadable', async () => {
    const reader = new FakeReader([], { type: 'hash', ttl: -1 })
    const detail = await build(reader).describeKey('auth', 'auth:sess:1')
    expect(detail).toMatchObject({ type: 'hash', isReadable: false })
  })

  // THE security property: a key from another keyspace must not be reachable by
  // naming a scope that does not contain it.
  it('refuses a key that does not belong to the named scope', async () => {
    const service = build(new FakeReader())
    // The details name the scope and the key: a refusal an operator cannot tie
    // back to what they asked for is an unexplained failure.
    await expect(service.describeKey('cache', 'auth:sess:1')).rejects.toMatchObject({
      code: CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE,
      details: { scopeId: 'cache', key: 'auth:sess:1' }
    })
  })

  // A key that merely contains the prefix is outside it.
  it('refuses a key that only contains the scope prefix', async () => {
    await expect(
      build(new FakeReader()).describeKey('auth', 'shadow-auth:sess:1')
    ).rejects.toMatchObject({ code: CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE })
  })

  // A key that no longer exists must report `missing` rather than being described
  // as a persistent key with an unknown type.
  it('reports a key that no longer exists as missing rather than absent', async () => {
    const reader = new FakeReader([], { type: 'none', ttl: -2 })
    const detail = await build(reader).describeKey('cache', 'app:gone')
    expect(detail).toMatchObject({ type: 'other', ttl: { kind: 'missing' } })
  })
})

describe('CacheAdminService.revealValue', () => {
  // The whole point of the union: withheld is NOT missing and NOT empty.
  it('withholds the value on an unreadable scope, carrying the origin prose', async () => {
    const reader = new FakeReader([], { type: 'hash', hgetall: { token: 'secret' } })
    const result = await build(reader).revealValue('auth', 'auth:sess:1')
    expect(result).toEqual({
      status: 'withheld',
      key: 'auth:sess:1',
      scopeId: 'auth',
      origin: 'written by nest-auth at Redis root; holds session records'
    })
  })

  // The refusal must happen BEFORE any value is read, or the secret has already
  // been pulled into the process to be discarded.
  it('does not read the value at all when the scope withholds it', async () => {
    const reader = new FakeReader([], { type: 'hash', hgetall: { token: 'secret' } })
    const spy = jest.spyOn(reader, 'hgetall')
    await build(reader).revealValue('auth', 'auth:sess:1')
    expect(spy).not.toHaveBeenCalled()
  })

  // A string value round-trips whole when it is under the cap; truncation must not
  // be the default behaviour.
  it('reveals a string value', async () => {
    const reader = new FakeReader([], { type: 'string', get: 'hello' })
    expect(await build(reader).revealValue('cache', 'app:a')).toEqual({
      status: 'revealed',
      key: 'app:a',
      type: 'string',
      value: { kind: 'string', value: 'hello', isComplete: true }
    })
  })

  // A long value is truncated and SAYS so — a surface must not present a
  // truncated blob as the whole value.
  it('truncates a long string and reports it incomplete', async () => {
    const reader = new FakeReader([], { type: 'string', get: 'abcdefghij' })
    const result = await build(reader, { revealStringLimit: 4 }).revealValue('cache', 'app:a')
    expect(result).toMatchObject({
      value: { kind: 'string', value: 'abcd', isComplete: false }
    })
  })

  // A string key holding null is gone between the TYPE and the GET.
  it('reports a string that vanished between reads as missing', async () => {
    const reader = new FakeReader([], { type: 'string', get: null })
    expect(await build(reader).revealValue('cache', 'app:a')).toEqual({
      status: 'missing',
      key: 'app:a'
    })
  })

  // A hash is revealed as named fields rather than a positional array, so a caller
  // cannot mis-pair a field with the wrong value.
  //
  // The entry shape is pinned with `toEqual`, not `toMatchObject`: partial
  // matching would accept an extra alias alongside `field`, and re-introducing a
  // second name for one concept is exactly what this shape was corrected to stop.
  // Redis's own vocabulary is field/value (`HSET key field value`).
  it('reveals a hash as field/value entries and nothing else', async () => {
    const reader = new FakeReader([], { type: 'hash', hgetall: { a: '1', b: '2' } })
    const result = await build(reader).revealValue('cache', 'app:h')
    expect(result).toMatchObject({ value: { kind: 'hash', isComplete: true } })
    const value = result.status === 'revealed' ? result.value : null
    expect(value?.kind === 'hash' ? value.fields : null).toEqual([
      { field: 'a', value: '1' },
      { field: 'b', value: '2' }
    ])
  })

  // Truncation applies to hashes and SAYS so — a surface must not present a partial
  // hash as the whole record.
  it('truncates a wide hash and reports it incomplete', async () => {
    const reader = new FakeReader([], { type: 'hash', hgetall: { a: '1', b: '2', c: '3' } })
    expect(await build(reader, { revealLimit: 2 }).revealValue('cache', 'app:h')).toMatchObject({
      value: {
        fields: [
          { field: 'a', value: '1' },
          { field: 'b', value: '2' }
        ],
        isComplete: false
      }
    })
  })

  it.each([
    ['set', 'smembers'],
    ['list', 'lrange']
  ])('reveals a %s as members', async (type, method) => {
    const reader = new FakeReader([], { type, [method]: ['m1', 'm2'] })
    expect(await build(reader).revealValue('cache', 'app:c')).toMatchObject({
      type,
      value: { kind: 'members', members: ['m1', 'm2'], isComplete: true }
    })
  })

  // Truncation applies to sets on the same terms, so no collection type can quietly
  // return a partial page that reads as complete.
  it('truncates a large set and reports it incomplete', async () => {
    const reader = new FakeReader([], { type: 'set', smembers: ['m1', 'm2', 'm3'] })
    expect(await build(reader, { revealLimit: 2 }).revealValue('cache', 'app:s')).toMatchObject({
      value: { members: ['m1', 'm2'], isComplete: false }
    })
  })

  // A sorted set arrives as a flat member/score sequence and must be paired back
  // up; an odd trailing element is a reply this surface will not invent a score for.
  // The command sent through the `call` escape hatch is pinned by name and
  // arguments. It is the one Redis command in this subpath that is a string
  // rather than a method, so nothing else would catch it changing — including
  // the read-only gate, which allowlists exactly this name.
  it('sends ZRANGE with WITHSCORES and the configured limit', async () => {
    const reader = new FakeReader([], { type: 'zset', call: [] })
    await build(reader, { revealLimit: 25 }).revealValue('cache', 'app:z')
    expect(reader.calls[0]).toEqual(['ZRANGE', 'app:z', '0', '25', 'WITHSCORES'])
  })

  it('pairs a sorted set reply into members and scores', async () => {
    const reader = new FakeReader([], { type: 'zset', call: ['m1', '1', 'm2', '2'] })
    expect(await build(reader).revealValue('cache', 'app:z')).toMatchObject({
      value: {
        kind: 'scored',
        members: [
          { member: 'm1', score: '1' },
          { member: 'm2', score: '2' }
        ],
        isComplete: true
      }
    })
  })

  // A large sorted set truncates like every other collection, and says so.
  it('truncates a large sorted set and reports it incomplete', async () => {
    const reader = new FakeReader([], { type: 'zset', call: ['m1', '1', 'm2', '2', 'm3', '3'] })
    expect(await build(reader, { revealLimit: 2 }).revealValue('cache', 'app:z')).toMatchObject({
      value: {
        members: [
          { member: 'm1', score: '1' },
          { member: 'm2', score: '2' }
        ],
        isComplete: false
      }
    })
  })

  // The RESP3 shape, which is what ioredis 6 actually returns and what a real
  // server produced. The flat-only implementation passed every unit test and
  // then reported `member: "z1,1"` against Redis, because `String(['z1','1'])`
  // is `'z1,1'` — a defect no double would have surfaced.
  it('pairs a RESP3 sorted set reply of member/score tuples', async () => {
    const reader = new FakeReader([], {
      type: 'zset',
      call: [
        ['m1', '1'],
        ['m2', '2']
      ]
    })
    expect(await build(reader).revealValue('cache', 'app:z')).toMatchObject({
      value: {
        kind: 'scored',
        members: [
          { member: 'm1', score: '1' },
          { member: 'm2', score: '2' }
        ],
        isComplete: true
      }
    })
  })

  // Truncation applies to the RESP3 shape too.
  it('truncates a RESP3 sorted set reply', async () => {
    const reader = new FakeReader([], {
      type: 'zset',
      call: [
        ['m1', '1'],
        ['m2', '2']
      ]
    })
    expect(await build(reader, { revealLimit: 1 }).revealValue('cache', 'app:z')).toMatchObject({
      value: { members: [{ member: 'm1', score: '1' }], isComplete: false }
    })
  })

  // An odd trailing element is dropped rather than paired with an invented score;
  // a fabricated score is worse than a missing member.
  it('drops an unpaired trailing element from a sorted set reply', async () => {
    const reader = new FakeReader([], { type: 'zset', call: ['m1', '1', 'orphan'] })
    expect(await build(reader).revealValue('cache', 'app:z')).toMatchObject({
      value: { members: [{ member: 'm1', score: '1' }] }
    })
  })

  // A reply that is not a list at all yields no members rather than throwing — a
  // reveal route must not fail on an unexpected shape.
  it('ignores a sorted set reply that is not an array', async () => {
    const reader = new FakeReader([], { type: 'zset', call: 'nonsense' })
    expect(await build(reader).revealValue('cache', 'app:z')).toMatchObject({
      value: { kind: 'scored', members: [], isComplete: true }
    })
  })

  // A type this surface does not render says so, rather than returning an empty
  // value that reads as "this key holds nothing".
  it.each([['stream'], ['vectorset']])('reports the unsupported type %s', async (type) => {
    const reader = new FakeReader([], { type })
    expect(await build(reader).revealValue('cache', 'app:x')).toMatchObject({
      value: { kind: 'unsupported' }
    })
  })

  // The `missing` branch of the reveal union, distinct from `withheld`: nothing is
  // there, as opposed to something being refused.
  it('reports a missing key as missing', async () => {
    const reader = new FakeReader([], { type: 'none' })
    expect(await build(reader).revealValue('cache', 'app:gone')).toEqual({
      status: 'missing',
      key: 'app:gone'
    })
  })

  // The membership check applies to the reveal too — it is the route the check
  // exists for.
  it('refuses a key outside the named scope', async () => {
    await expect(build(new FakeReader()).revealValue('cache', 'auth:sess:1')).rejects.toMatchObject(
      { code: CACHE_ERROR_CODES.KEY_NOT_IN_SCOPE }
    )
  })
})
