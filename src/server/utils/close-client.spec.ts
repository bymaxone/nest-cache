/**
 * Unit tests for {@link closeClient}: a quit that is bounded by a deadline, a forced disconnect that
 * is signalled first, and a client that has ended being left alone.
 *
 * Layer: server.
 */
import { closeClient, type ClosableClient } from './close-client'

/** A client stub with the given status whose `quit` is `quit`. */
const client = (
  quit: () => Promise<unknown>,
  status = 'ready'
): ClosableClient & {
  disconnect: jest.Mock
} => ({ status, quit: jest.fn(quit), disconnect: jest.fn() })

describe('closeClient', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  // A quit that completes in time is the graceful path: nothing is forced, nothing is signalled and
  // the deadline timer does not outlive the call.
  it('leaves a client that quit in time alone and clears the deadline timer', async () => {
    jest.useFakeTimers()
    const stub = client(() => Promise.resolve('OK'))
    const onForced = jest.fn()

    await closeClient(stub, 1_000, onForced)

    expect(stub.disconnect).not.toHaveBeenCalled()
    expect(onForced).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  // The deadline is the bound: a quit that never settles is forced closed exactly at it, and the
  // teardown is signalled before the disconnect.
  it('forces a quit that never settles at the deadline, signalling first', async () => {
    jest.useFakeTimers()
    const stub = client(() => new Promise<never>(() => undefined))
    const order: string[] = []
    stub.disconnect.mockImplementation(() => order.push('disconnect'))

    const closing = closeClient(stub, 500, () => order.push('signal'))
    await jest.advanceTimersByTimeAsync(499)
    expect(order).toEqual([])
    await jest.advanceTimersByTimeAsync(1)
    await closing

    expect(order).toEqual(['signal', 'disconnect'])
    expect(jest.getTimerCount()).toBe(0)
  })

  // A quit that is refused is forced closed at once and the call resolves: the rejection is handled,
  // not left unhandled, even when the quit settles again after the deadline.
  it('forces a client whose quit rejects, without an unhandled rejection', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const stub = client(() => Promise.reject(new Error('quit refused')))
      const onForced = jest.fn()

      await expect(closeClient(stub, 500, onForced)).resolves.toBeUndefined()
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(onForced).toHaveBeenCalledTimes(1)
      expect(stub.disconnect).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  // A quit that rejects only after the deadline lost the race: it must not be reported twice or
  // surface as an unhandled rejection.
  it('handles a quit that rejects after the deadline already forced the client', async () => {
    jest.useFakeTimers()
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let rejectQuit: (error: Error) => void = () => undefined
      const stub = client(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectQuit = reject
          })
      )
      const onForced = jest.fn()

      const closing = closeClient(stub, 100, onForced)
      await jest.advanceTimersByTimeAsync(100)
      await closing
      rejectQuit(new Error('late'))
      await jest.advanceTimersByTimeAsync(10)

      expect(onForced).toHaveBeenCalledTimes(1)
      expect(stub.disconnect).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  // A client that has ended has no stream to quit or close: nothing is sent and nothing is signalled.
  it('does nothing for a client that has ended', async () => {
    const stub = client(() => Promise.resolve('OK'), 'end')
    const onForced = jest.fn()

    await closeClient(stub, 500, onForced)

    expect(stub.quit).not.toHaveBeenCalled()
    expect(stub.disconnect).not.toHaveBeenCalled()
    expect(onForced).not.toHaveBeenCalled()
  })

  // A client with no live socket has nothing to quit: the server is down and ioredis is between attempts
  // ('reconnecting', 'close'), or a lazy client never connected ('wait'), where a QUIT would first open a
  // connection just to say goodbye. It is disconnected to stop the retries, without a quit and without
  // reporting a forced teardown: nothing was forced.
  it.each(['reconnecting', 'close', 'wait'])(
    'disconnects a client in status %s without quitting or reporting a forced teardown',
    async (status) => {
      const stub = client(() => Promise.resolve('OK'), status)
      const onForced = jest.fn()

      await closeClient(stub, 500, onForced)

      expect(stub.quit).not.toHaveBeenCalled()
      expect(onForced).not.toHaveBeenCalled()
      expect(stub.disconnect).toHaveBeenCalledTimes(1)
    }
  )

  // The control: a live connection that refuses the quit is the case `forced_disconnect` is for.
  it('still reports a forced teardown for a ready client whose quit is refused', async () => {
    const stub = client(() => Promise.reject(new Error('quit refused')), 'ready')
    const onForced = jest.fn()

    await closeClient(stub, 500, onForced)

    expect(onForced).toHaveBeenCalledTimes(1)
    expect(stub.disconnect).toHaveBeenCalledTimes(1)
  })

  // A connect still in flight can take a QUIT (the offline queue may hold it): the client is quit, bounded
  // by the deadline, and forced when the quit is refused.
  it.each(['connecting', 'connect'])(
    'quits a client in status %s and forces it when the quit is refused',
    async (status) => {
      const stub = client(() => Promise.reject(new Error('quit refused')), status)
      const onForced = jest.fn()

      await closeClient(stub, 500, onForced)

      expect(stub.quit).toHaveBeenCalledTimes(1)
      expect(onForced).toHaveBeenCalledTimes(1)
    }
  )

  // A status this code does not know, such as a value a later ioredis adds, must not silently become
  // "down": it is quit, with the quit raced against the deadline, and forced when that fails.
  it('quits a client in a status it does not know', async () => {
    const stub = client(() => Promise.reject(new Error('quit refused')), 'a-future-status')
    const onForced = jest.fn()

    await closeClient(stub, 500, onForced)

    expect(stub.quit).toHaveBeenCalledTimes(1)
    expect(onForced).toHaveBeenCalledTimes(1)
  })
})
