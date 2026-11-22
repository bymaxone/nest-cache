/**
 * The delay queue of a cluster client, sealed against a key planted on `Object.prototype` after the client was
 * built.
 *
 * Layer: server. ioredis's cluster retries a command after a redirect through a `DelayQueue` that finds a
 * bucket with a plain property read and calls `options.callback`; a string planted under a bucket name or under
 * `callback` throws in a timer and the process exits. The first rows pin the shape of the installed ioredis:
 * the seal is written against it, and they fail when a version changes it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Cluster } from 'ioredis'

import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import { sealDelayQueue } from './sealed-delay-queue'

interface IQueue {
  queues: object
  timeouts: object
  push: (bucket: string, item: () => void, options: object) => void
}

const BUCKETS = ['moved', 'tryagain', 'clusterdown', 'failover']
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

/** A cluster client that connects to nothing, and its delay queue. */
function cluster(): { client: Cluster; queue: IQueue } {
  const client = new Cluster([{ host: '127.0.0.1', port: 1 }], { lazyConnect: true })
  closers.push(() => client.disconnect())
  return { client, queue: (client as unknown as { delayQueue: IQueue }).delayQueue }
}

/** Plants `names` as enumerable strings, runs `run`, and takes them off with a delete. */
async function planted<T>(names: string[], run: () => Promise<T>): Promise<T> {
  for (const name of names) {
    Object.defineProperty(Object.prototype, name, {
      value: 'PLANTED',
      configurable: true,
      enumerable: true
    })
  }
  try {
    return await run()
  } finally {
    for (const name of names) Reflect.deleteProperty(Object.prototype, name)
  }
}

describe('the shape of the delay queue of the installed ioredis', () => {
  // Scenario: the seal is written against the DelayQueue and the callers of ioredis 6.
  // Rule: these rows fail when a version changes them, so the seal is reviewed instead of silently skipped.
  it('keeps its buckets in two tables, reads callback off the options, and has the four callers', () => {
    const root = join(__dirname, '../../../node_modules/ioredis/built/cluster')
    const queueSource = readFileSync(join(root, 'DelayQueue.js'), 'utf8')
    const callers = readFileSync(join(root, 'index.js'), 'utf8')

    expect(queueSource).toContain('this.queues = {}')
    expect(queueSource).toContain('this.timeouts = {}')
    expect(queueSource).toContain('const callback = options.callback || process.nextTick')
    for (const bucket of BUCKETS) {
      expect(callers).toContain(`this.delayQueue.push("${bucket}"`)
    }
  })

  it('is a field of the cluster client with the two tables and a push', () => {
    const { queue } = cluster()

    expect(typeof queue.push).toBe('function')
    expect(queue.queues).toEqual({})
    expect(queue.timeouts).toEqual({})
  })
})

describe('a cluster client whose delay queue is not sealed', () => {
  // Scenario: a string is planted under a bucket name after the client was built (the control).
  // Rule: the push throws, which is what the seal prevents.
  it('throws on a push when a bucket name is planted', async () => {
    const { queue } = cluster()

    const error = await planted(['tryagain'], async () => {
      try {
        queue.push('tryagain', () => undefined, { timeout: 1 })
        return undefined
      } catch (caught) {
        return caught
      }
    })

    expect((error as Error).name).toBe('TypeError')
  })
})

describe('a cluster client whose delay queue is sealed', () => {
  // Scenario: strings are planted under the bucket names and under callback after the client was built, then
  // the retries of ioredis are pushed the way its callers push them (moved and tryagain with only a timeout,
  // clusterdown and failover with a callback of their own).
  // Rule: every item runs once its timeout passed, through the callback of the push or the next tick, and
  // nothing throws.
  it.each(BUCKETS)('runs what is pushed to %s with every name planted', async (bucket) => {
    const { client, queue } = cluster()
    sealDelayQueue(client)
    const ran = jest.fn()
    const options =
      bucket === 'moved' || bucket === 'tryagain'
        ? { timeout: 1 }
        : { timeout: 1, callback: (next: () => void) => next() }

    await planted([...BUCKETS, 'callback', 'timeout'], async () => {
      queue.push(bucket, ran, options)
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(ran).toHaveBeenCalledTimes(1)
  })

  it('runs a push through the callback it was given, not the next tick', async () => {
    const { client, queue } = cluster()
    sealDelayQueue(client)
    const ran = jest.fn()
    const through = jest.fn((next: () => void) => next())

    queue.push('failover', ran, { timeout: 1, callback: through })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(through).toHaveBeenCalledTimes(1)
    expect(ran).toHaveBeenCalledTimes(1)
  })

  it('has two tables without a prototype', () => {
    const { client, queue } = cluster()
    sealDelayQueue(client)

    expect(Reflect.getPrototypeOf(queue.queues)).toBeNull()
    expect(Reflect.getPrototypeOf(queue.timeouts)).toBeNull()
  })

  it('leaves a client that has no delay queue as it is', () => {
    const client = {}

    expect(sealDelayQueue(client)).toBe(client)
  })
})

describe('the clients the manager builds in cluster mode', () => {
  it('have their delay queue sealed', () => {
    const manager = new ConnectionManager(
      resolveOptions({
        mode: 'cluster',
        cluster: { nodes: [{ host: '127.0.0.1', port: 1 }], options: { lazyConnect: true } }
      } as unknown as BymaxCacheModuleOptions)
    )
    const client = manager.getClient() as unknown as { delayQueue: IQueue; disconnect: () => void }
    closers.push(() => client.disconnect())

    expect(Reflect.getPrototypeOf(client.delayQueue.queues)).toBeNull()
  })
})
