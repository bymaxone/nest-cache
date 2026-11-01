/**
 * Unit tests for how {@link PubSubService} retains a channel or pattern subscription.
 *
 * Layer: server. A caller is told it is subscribed only when the server accepted the
 * SUBSCRIBE / PSUBSCRIBE, so these cases drive a scripted subscriber whose commands
 * succeed or fail on demand: a failed first command must not leave a subscription that
 * later callers join without ever sending one, and callers that share an in-flight
 * command must all learn its outcome.
 */
import { applyDefaults } from '../config/default-options'
import { KeyBuilder } from '../utils/key-builder'
import { PubSubService } from './pubsub.service'

import type { ConnectionManager } from '../connection/connection.manager'

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

const deferred = (): Deferred => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A subscriber whose subscription commands are jest mocks; `on`/`off` are inert. */
const scriptedSubscriber = () => ({
  on: jest.fn(),
  off: jest.fn(),
  subscribe: jest.fn<Promise<void>, [string]>(async () => undefined),
  psubscribe: jest.fn<Promise<void>, [string]>(async () => undefined),
  unsubscribe: jest.fn<Promise<void>, [string]>(async () => undefined),
  punsubscribe: jest.fn<Promise<void>, [string]>(async () => undefined),
  quit: jest.fn(async () => 'OK'),
  disconnect: jest.fn()
})

describe('PubSubService subscription retention', () => {
  let subscriber: ReturnType<typeof scriptedSubscriber>
  let pubsub: PubSubService

  beforeEach(() => {
    subscriber = scriptedSubscriber()
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'ps' })
    const connection = {
      createSubscriberClient: () => subscriber,
      getClient: () => ({})
    } as unknown as ConnectionManager
    pubsub = new PubSubService(options, connection, new KeyBuilder(options))
  })

  describe.each([
    ['subscribe', 'subscribe', 'unsubscribe'],
    ['psubscribe', 'psubscribe', 'punsubscribe']
  ] as const)('%s', (method, command, release) => {
    const join = (): Promise<() => Promise<void>> => pubsub[method]('orders', () => undefined)

    // The first command fails: the caller is told so, and the target must not stay
    // registered, or the next caller would join it and send nothing.
    it('sends the command again after the first one failed', async () => {
      subscriber[command].mockRejectedValueOnce(new Error('LOADING'))

      await expect(join()).rejects.toThrow('LOADING')
      await expect(join()).resolves.toEqual(expect.any(Function))

      expect(subscriber[command]).toHaveBeenCalledTimes(2)
      expect(subscriber[command]).toHaveBeenNthCalledWith(2, 'ps:orders')
    })

    // A caller that arrives while the command is still in flight shares its outcome.
    it('rejects every caller that shared a failing in-flight command', async () => {
      const inFlight = deferred()
      subscriber[command].mockReturnValueOnce(inFlight.promise)

      const first = join()
      const second = join()
      inFlight.reject(new Error('LOADING'))

      await expect(first).rejects.toThrow('LOADING')
      await expect(second).rejects.toThrow('LOADING')
      expect(subscriber[command]).toHaveBeenCalledTimes(1)

      await expect(join()).resolves.toEqual(expect.any(Function))
      expect(subscriber[command]).toHaveBeenCalledTimes(2)
    })

    it('sends one command for callers that share a succeeding in-flight one', async () => {
      const inFlight = deferred()
      subscriber[command].mockReturnValueOnce(inFlight.promise)

      const first = join()
      const second = join()
      inFlight.resolve()
      const [offFirst, offSecond] = await Promise.all([first, second])

      expect(subscriber[command]).toHaveBeenCalledTimes(1)
      await offFirst()
      expect(subscriber[release]).not.toHaveBeenCalled()
      await offSecond()
      expect(subscriber[release]).toHaveBeenCalledTimes(1)
    })

    // A caller counts as a listener from the moment it joins, so the last listener
    // leaving while it waits must not release the subscription under it.
    it('keeps the subscription when the last other listener leaves while a join waits', async () => {
      const off = await join()

      const joining = join()
      await off()
      const offJoined = await joining

      expect(subscriber[release]).not.toHaveBeenCalled()
      await offJoined()
      expect(subscriber[release]).toHaveBeenCalledTimes(1)
    })
  })
})
