/**
 * Unit tests for {@link callHook}.
 *
 * Layer: server. A host hook typed `=> void` may be async; what it throws, rejects with or hands
 * back as a thenable must never reach the caller or the process.
 */
import { callHook } from './call-hook'

describe('callHook', () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', record)
  })

  afterEach(() => {
    process.off('unhandledRejection', record)
  })

  /** Lets a rejected promise that nobody handles reach the process-level event. */
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  // A hook typed `=> void` may still be an async function; its rejection must not escape.
  it('swallows a rejected promise returned by the hook', async () => {
    callHook(() => Promise.reject(new Error('sink down')))
    await settle()

    expect(unhandled).toEqual([])
  })

  it('swallows a synchronous throw', () => {
    expect(() =>
      callHook(() => {
        throw new Error('sink down')
      })
    ).not.toThrow()
  })

  // A thenable that is not a promise is held to the same rule: its handlers must not escape either.
  it('swallows a thenable whose then throws', () => {
    const thenable = {
      then: (): never => {
        throw new Error('bad thenable')
      }
    }

    expect(() => callHook(() => thenable)).not.toThrow()
  })

  it('swallows a rejection delivered to a thenable', async () => {
    const calls: string[] = []
    const thenable = {
      then: (_ok: unknown, fail: (reason: unknown) => void): void => {
        calls.push('then')
        fail(new Error('rejected'))
      }
    }

    callHook(() => thenable)
    await settle()

    expect(calls).toEqual(['then'])
    expect(unhandled).toEqual([])
  })

  it('does not touch a plain return value', () => {
    const run = jest.fn(() => 42)

    callHook(run)

    expect(run).toHaveBeenCalledTimes(1)
  })
})
