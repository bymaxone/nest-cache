/**
 * Fixtures shared by the {@link CacheAdminService} specs: the declared scopes, a fake reader
 * standing in for ioredis, and the builders around it.
 *
 * Layer: admin.
 */
import { resolveAdminOptions } from '../../config/resolved-admin-options'
import { CacheAdminService } from '../cache-admin.service'

import type { CacheScope } from '../../interfaces/cache-scope.interface'
import type {
  IRedisPipeline,
  IRedisReader,
  PipelineReply
} from '../../interfaces/redis-reader.interface'

/** The declared scopes: a readable one (`cache`) and a withheld one (`auth`, another package's). */
export const SCOPES: readonly CacheScope[] = [
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
export type ScanStep = readonly [string, string[]]

/** Records what a pipeline was asked to queue, and answers with fixed replies. */
export class FakePipeline implements IRedisPipeline {
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
export class FakeReader implements IRedisReader {
  readonly pipelines: FakePipeline[] = []
  readonly calls: string[][] = []
  private scanIndex = 0
  readonly scanCursors: string[] = [] // the cursor each SCAN was issued with

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

  async scan(cursor: string): Promise<[string, string[]]> {
    // A scan that never ends would starve the microtask queue instead of failing a test.
    if (this.scanIndex >= 1_000) {
      throw new Error('runaway scan')
    }
    this.scanCursors.push(cursor)
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
export const build = (
  reader: IRedisReader,
  overrides: Partial<Parameters<typeof resolveAdminOptions>[0]> = {}
): CacheAdminService =>
  new CacheAdminService(
    { getClient: () => reader },
    resolveAdminOptions({ scopes: SCOPES, ...overrides })
  )

/** Builds `[TYPE, TTL]` pipeline replies for a run of keys. */
export const describeReplies = (
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
