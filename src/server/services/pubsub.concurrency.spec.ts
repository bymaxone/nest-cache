/**
 * Unit tests for the handler bounds of {@link PubSubService}.
 *
 * Layer: server. Over ioredis-mock: how many handler executions run at once, the order the waiting
 * ones start in, what a full queue drops and how that is reported, and what shutdown and an
 * unsubscribe do to the waiting ones.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { PubSubService } from './pubsub.service'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

// Swap real ioredis for the in-memory mock so the main client and the dedicated
// subscriber connection share a working pub/sub bus without a socket.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

/** A handler body that records when it starts and settles only when its `release` is called. */
function holdingHandler(): {
  starts: number[]
  running: () => number
  release: (index: number) => void
  handler: (message: number) => Promise<void>
} {
  const starts: number[] = []
  const releases = new Map<number, () => void>()
  let running = 0
  return {
    starts,
    running: () => running,
    release: (index) => releases.get(index)?.(),
    handler: (message) => {
      starts.push(message)
      running += 1
      return new Promise<void>((resolve) => {
        releases.set(message, () => {
          running -= 1
          resolve()
        })
      })
    }
  }
}

describe('PubSubService handler bounds', () => {
  const connections: ConnectionManager[] = []
  const services: PubSubService[] = []

  async function service(
    extra: Partial<BymaxCacheModuleOptions>,
    events?: { onEvent: jest.Mock }
  ): Promise<PubSubService> {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'cc', ...extra })
    const connection = new ConnectionManager(options)
    await connection.onModuleInit()
    connections.push(connection)
    const pubsub = new PubSubService(
      options,
      connection,
      new KeyBuilder(options),
      undefined,
      events
    )
    services.push(pubsub)
    return pubsub
  }

  afterEach(async () => {
    for (const pubsub of services.splice(0)) {
      await pubsub.onApplicationShutdown()
    }
    for (const connection of connections.splice(0)) {
      await connection.onApplicationShutdown()
    }
  })

  // Scenario: five messages reach a handler that holds each one, with two slots.
  // Rule: two run at once, and each slot freed starts the oldest waiting message.
  it('runs at most the configured number of handlers and starts the rest in arrival order', async () => {
    const pubsub = await service({ pubsubMaxConcurrentHandlers: 2 })
    const work = holdingHandler()
    await pubsub.subscribe<number>('bound', work.handler)

    for (let n = 0; n < 5; n += 1) {
      await pubsub.publish('bound', n)
    }
    await tick()
    expect([work.starts, work.running()]).toEqual([[0, 1], 2])

    work.release(1)
    await tick()
    expect(work.starts).toEqual([0, 1, 2])

    work.release(0)
    work.release(2)
    await tick()
    expect([work.starts, work.running()]).toEqual([[0, 1, 2, 3, 4], 2])
  })

  // Scenario: with no bound set, as before, every message starts its handler at once.
  // Rule: nothing waits.
  it('bounds nothing when no option is set', async () => {
    const pubsub = await service({})
    const work = holdingHandler()
    await pubsub.subscribe<number>('free', work.handler)

    for (let n = 0; n < 20; n += 1) {
      await pubsub.publish('free', n)
    }
    await tick()

    expect(work.running()).toBe(20)
  })

  // Scenario: an asynchronous validator whose answers are released by the test, the last message first.
  // Rule: with one slot the handlers still run one at a time in arrival order, because the slot covers
  // the validation too; with no bound the validator reorders them.
  it('keeps arrival order with one slot even when validation finishes out of order', async () => {
    const releases = new Map<number, () => void>()
    const validate = (value: unknown): Promise<{ value: number }> =>
      new Promise((resolve) => {
        releases.set(Number(value), () => resolve({ value: Number(value) }))
      })
    /** Lets the event loop run until `done` holds, so no wall-clock time decides the outcome. */
    const until = async (done: () => boolean): Promise<void> => {
      for (let i = 0; i < 200 && !done(); i += 1) {
        await tick()
      }
    }
    const handled: Record<string, number[]> = { bounded: [], free: [] }
    const bounded = await service({ pubsubMaxConcurrentHandlers: 1 })
    const free = await service({})
    for (const [name, pubsub] of [
      ['bounded', bounded],
      ['free', free]
    ] as const) {
      await pubsub.subscribe<number>(
        `ordered-${name}`,
        (message) => void handled[name]?.push(message),
        { validate: { '~standard': { version: 1, validate } } }
      )
    }

    for (let n = 0; n < 4; n += 1) {
      await bounded.publish('ordered-bounded', n)
    }
    for (let n = 0; n < 4; n += 1) {
      await until(() => releases.has(n))
      expect([n, [...releases.keys()].length]).toEqual([n, n + 1])
      releases.get(n)?.()
      await until(() => handled['bounded']?.length === n + 1)
    }
    releases.clear()
    for (let n = 0; n < 4; n += 1) {
      await free.publish('ordered-free', n)
    }
    await until(() => releases.size === 4)
    for (const n of [3, 2, 1, 0]) {
      releases.get(n)?.()
      await until(() => handled['free']?.length === 4 - n)
    }

    expect(handled).toEqual({ bounded: [0, 1, 2, 3], free: [3, 2, 1, 0] })
  })

  // Scenario: one channel's handlers hold every slot while another channel's message arrives.
  // Rule: the other channel waits behind them; the gate is one per subscriber.
  it('lets one channel hold the slots the other channel waits for', async () => {
    const pubsub = await service({ pubsubMaxConcurrentHandlers: 1 })
    const slow = holdingHandler()
    const fast: number[] = []
    await pubsub.subscribe<number>('slow', slow.handler)
    await pubsub.subscribe<number>('fast', (message) => void fast.push(message))

    await pubsub.publish('slow', 0)
    await pubsub.publish('fast', 1)
    await tick()
    expect(fast).toEqual([])

    slow.release(0)
    await tick()
    expect(fast).toEqual([1])
  })

  // Scenario: a handler throws, and another rejects, while messages wait behind them.
  // Rule: each frees its slot, the failure is reported as before, and the waiting message runs.
  it('frees the slot of a handler that fails and reports the failure as before', async () => {
    const onEvent = jest.fn()
    const pubsub = await service({ pubsubMaxConcurrentHandlers: 1 }, { onEvent })
    const seen: number[] = []
    await pubsub.subscribe<number>('failing', (message) => {
      seen.push(message)
      if (message === 0) {
        throw new Error('first failed')
      }
      return message === 1 ? Promise.reject(new Error('second failed')) : undefined
    })

    for (let n = 0; n < 3; n += 1) {
      await pubsub.publish('failing', n)
    }
    await tick()

    expect(seen).toEqual([0, 1, 2])
    expect(onEvent.mock.calls.map(([, data]) => data)).toEqual([
      { role: 'subscriber', reason: 'handler_error', channel: 'cc:failing', error: 'first failed' },
      { role: 'subscriber', reason: 'handler_error', channel: 'cc:failing', error: 'second failed' }
    ])
  })

  // Scenario: one slot, a handler held, and a message waiting for a handler that is then unsubscribed.
  // Rule: the waiting message is skipped, and the next one behind it starts.
  it('skips a waiting message whose subscription was removed', async () => {
    const pubsub = await service({ pubsubMaxConcurrentHandlers: 1 })
    const work = holdingHandler()
    const removed: number[] = []
    await pubsub.subscribe<number>('held', work.handler)
    const off = await pubsub.subscribe<number>('gone', (message) => void removed.push(message))
    const kept: number[] = []
    await pubsub.subscribe<number>('kept', (message) => void kept.push(message))

    await pubsub.publish('held', 0)
    await pubsub.publish('gone', 1)
    await pubsub.publish('kept', 2)
    await tick()
    await off()
    work.release(0)
    await tick()

    expect([removed, kept]).toEqual([[], [2]])
  })

  // Scenario: shutdown while messages wait for a slot.
  // Rule: none of them starts afterwards.
  it('starts nothing that waited when the service shuts down', async () => {
    const pubsub = await service({ pubsubMaxConcurrentHandlers: 1 })
    const work = holdingHandler()
    await pubsub.subscribe<number>('closing', work.handler)
    await pubsub.publish('closing', 0)
    await pubsub.publish('closing', 1)
    await tick()

    await pubsub.onApplicationShutdown()
    work.release(0)
    await tick()

    expect(work.starts).toEqual([0])
  })

  // Scenario: one slot and room for one waiting message, and four messages arrive.
  // Rule: the newest two are dropped, what was admitted runs in order, and the report names the
  // channel and carries no part of any payload.
  it('drops the newest messages when the queue is full and reports without the payload', async () => {
    const onEvent = jest.fn()
    const pubsub = await service(
      { pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: 1 },
      { onEvent }
    )
    const work = holdingHandler()
    await pubsub.subscribe<number>('full', work.handler)

    for (const n of [0, 1, 2, 3]) {
      await pubsub.publish('full', n)
    }
    await tick()
    work.release(0)
    await tick()
    work.release(1)
    await tick()

    expect(work.starts).toEqual([0, 1])
    expect(onEvent.mock.calls).toEqual([
      ['error', { role: 'subscriber', reason: 'handler_queue_full', channel: 'cc:full' }]
    ])
  })

  // Scenario: a queue of zero and a handler that is busy.
  // Rule: a message that finds no free slot is dropped at once.
  it('drops at once when the queue holds nothing', async () => {
    const pubsub = await service({
      pubsubMaxConcurrentHandlers: 1,
      pubsubMaxQueuedMessages: 0
    })
    const work = holdingHandler()
    await pubsub.subscribe<number>('none', work.handler)

    await pubsub.publish('none', 0)
    await pubsub.publish('none', 1)
    await tick()
    work.release(0)
    await tick()

    expect(work.starts).toEqual([0])
  })

  describe('drop report', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
    })
    afterEach(() => {
      jest.useRealTimers()
    })

    // Scenario: a thousand messages are dropped inside one ten-second window, then one more after it
    // (the summary counts the 999 that followed the first).
    // Rule: the first drop is reported at once, the rest of the window as one summary with the count
    // and the last channel, so a flood of drops is not a flood of events; a drop after a quiet
    // window is reported at once again.
    it('reports the first drop at once and the rest of a window as one summary', async () => {
      const onEvent = jest.fn()
      const pubsub = await service(
        { pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: 0 },
        { onEvent }
      )
      const work = holdingHandler()
      await pubsub.subscribe<number>('flood', work.handler)
      await pubsub.subscribe<number>('last', () => undefined)
      await pubsub.publish('flood', -1)
      await tick()

      for (let n = 0; n < 999; n += 1) {
        await pubsub.publish('flood', n)
      }
      await pubsub.publish('last', 0)
      await tick()
      expect(onEvent).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(10_000)
      expect(onEvent.mock.calls.map(([, data]) => data)).toEqual([
        { role: 'subscriber', reason: 'handler_queue_full', channel: 'cc:flood' },
        { role: 'subscriber', reason: 'handler_queue_full', channel: 'cc:last', dropped: 999 }
      ])

      await jest.advanceTimersByTimeAsync(10_000)
      expect(onEvent).toHaveBeenCalledTimes(2)

      await pubsub.publish('flood', 0)
      await tick()
      expect(onEvent).toHaveBeenCalledTimes(3)
    })

    // Scenario: shutdown while a drop window is open.
    // Rule: no timer is left running and nothing is reported afterwards.
    it('leaves no timer behind when the service shuts down in an open window', async () => {
      const onEvent = jest.fn()
      const pubsub = await service(
        { pubsubMaxConcurrentHandlers: 1, pubsubMaxQueuedMessages: 0 },
        { onEvent }
      )
      const work = holdingHandler()
      await pubsub.subscribe<number>('window', work.handler)
      for (let n = 0; n < 3; n += 1) {
        await pubsub.publish('window', n)
      }
      await tick()

      await pubsub.onApplicationShutdown()

      expect(jest.getTimerCount()).toBe(0)
      await jest.advanceTimersByTimeAsync(20_000)
      expect(onEvent).toHaveBeenCalledTimes(1)
    })
  })
})
